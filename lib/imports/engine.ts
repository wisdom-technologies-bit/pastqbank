import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchQuestions as realFetchQuestions } from "@/lib/providers/aloc/client";
import { fetchYearCatalog as realFetchYearCatalog } from "@/lib/providers/aloc/catalog";
import { saveQuestions as realSaveQuestions } from "@/lib/bank/saveQuestions";
import { buildPlan, planSummary, type CatalogEntry, type ExamSlug } from "./planner";
import { SupabaseQuestionStore } from "@/lib/bank/supabaseQuestionStore";
import { AllKeysUnavailableError, AlocRateLimitedError } from "@/lib/providers/aloc/errors";
import { ImportScopeSchema } from "./plan";

export type PageSummary = { exam: string; year: number; pageNumber: number; questions: number; creditsUsed: number; attempts: number; creditsRemaining: number | null; keyLabel: string | null; empty: boolean };
export type SliceSummary = { jobId: string | null; stoppedBecause: string | null; pages: PageSummary[]; keysUsed: string[]; discovered: number; inserted: number; updated: number; quarantined: number; requestsMade: number; creditsUsed: number; skipped?: number; rejected?: number };
export type ImportDeps = { db: any; fetchQuestions: typeof realFetchQuestions; fetchYearCatalog: typeof realFetchYearCatalog; saveQuestions: typeof realSaveQuestions; createStore: (db: any) => any; now: () => number; sleep: (ms: number) => Promise<void> };

const STALE_MS = 120_000;
const HEADROOM_MS = 9_000;
const PACE_MS = 2_200;
const FINISHED = ["done", "empty", "failed", "skipped"];
const ORDER = ["jamb", "waec", "neco", "post_utme"] as const;
const KEYS_MESSAGE = "All ALOC API keys are exhausted or unavailable. Add credits or a key, then press Resume.";

export const reportedCredits = (value: number | undefined | null) => (Number.isInteger(value as number) && Number(value) > 0 ? Number(value) : 1);

const defaults = (): ImportDeps => ({ db: getAdminSupabaseClient(), fetchQuestions: realFetchQuestions, fetchYearCatalog: realFetchYearCatalog, saveQuestions: realSaveQuestions, createStore: (db) => new SupabaseQuestionStore(db), now: Date.now, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) });
const get = async (db: any, table: string, id: string) => { const r = await db.from(table).select("*").eq("id", id).maybeSingle(); if (r.error) throw r.error; return r.data; };
const update = async (db: any, table: string, id: string, values: any) => { const r = await db.from(table).update(values).eq("id", id); if (r.error) throw r.error; };
const safeMessage = (error: unknown) => { const raw = error instanceof Error ? error.message : "Import step failed"; return raw.replace(/aloc_[A-Za-z0-9]+|ALOC-[A-Za-z0-9]+|alc_live_[A-Za-z0-9]+/g, "[redacted]").slice(0, 300); };
function sortUnits(units: any[]) { return [...units].sort((a, b) => (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1) || b.exam_year - a.exam_year || ORDER.indexOf(a.exam_slug) - ORDER.indexOf(b.exam_slug)); }
function emptySummary(jobId: string | null): SliceSummary { return { jobId, stoppedBecause: null, pages: [], keysUsed: [], discovered: 0, inserted: 0, updated: 0, quarantined: 0, requestsMade: 0, creditsUsed: 0, skipped: 0, rejected: 0 }; }

export async function runSlice(options: { jobId?: string; budgetMs?: number } = {}, injected?: Partial<ImportDeps>): Promise<SliceSummary> {
  const deps: ImportDeps = { ...defaults(), ...injected }; const db = deps.db; const budgetMs = options.budgetMs ?? 40000; const sliceStart = deps.now(); const iso = () => new Date(deps.now()).toISOString();
  let candidate: any = null;
  if (options.jobId) candidate = await get(db, "import_jobs", options.jobId); else { const r = await db.from("import_jobs").select("*").in("status", ["queued", "running"]).order("created_at", { ascending: true }).limit(5); if (r.error) throw r.error; candidate = (r.data ?? []).find((j: any) => j.status === "queued" || deps.now() - new Date(j.updated_at).getTime() > STALE_MS) ?? null; }
  if (!candidate) return emptySummary(options.jobId ?? null);
  const staleCutoff = new Date(deps.now() - STALE_MS).toISOString(); const claim = await db.from("import_jobs").update({ status: "running", started_at: candidate.started_at ?? iso() }).eq("id", candidate.id).or(`status.eq.queued,and(status.eq.running,updated_at.lt.${staleCutoff})`).select("*").maybeSingle();
  if (claim.error || !claim.data) return emptySummary(candidate.id); const job: any = claim.data; const summary = emptySummary(job.id);
  const setIfRunning = async (patch: Record<string, unknown>) => { const r = await db.from("import_jobs").update(patch).eq("id", job.id).eq("status", "running"); if (r.error) throw r.error; };
  const parsedScope = ImportScopeSchema.safeParse(job.scope); if (!parsedScope.success) { await setIfRunning({ status: "failed", error_summary: "Invalid import scope", completed_at: iso() }); summary.stoppedBecause = "failed"; return summary; }
  const cap = parsedScope.data.maxCredits ?? null; const loadUnits = async () => { const r = await db.from("import_units").select("*").eq("job_id", job.id); if (r.error) throw r.error; return (r.data ?? []) as any[]; }; let units = await loadUnits();
  const nextPlanYear = job.plan_cursor_year == null ? parsedScope.data.startYear : job.plan_cursor_year;
  const planningFinished = nextPlanYear < parsedScope.data.endYear;
  if (!planningFinished) {
    const exams = parsedScope.data.examTypes.filter((e): e is ExamSlug => e !== "state");
    let cursorYear: number = nextPlanYear; let plannedThisSlice = 0;
    while (cursorYear >= parsedScope.data.endYear && plannedThisSlice < 8) {
      if (plannedThisSlice > 0) await deps.sleep(PACE_MS);
      if (deps.now() - sliceStart + HEADROOM_MS >= budgetMs) break;
      let catalog: CatalogEntry[];
      try { catalog = await deps.fetchYearCatalog(cursorYear); }
      catch (error) {
        if (error instanceof AlocRateLimitedError) { await setIfRunning({ status: "queued" }); summary.stoppedBecause = "rate_limited"; return summary; }
        throw error;
      }
      const haveMap = new Map<string, number>();
      for (let from = 0; ; from += 1000) {
        const r = await db.from("questions").select("exam_year, exams!inner(slug), subjects!inner(slug)").eq("exam_year", cursorYear).range(from, from + 999);
        if (r.error) throw r.error;
        for (const row of r.data ?? []) { const e = row.exams?.slug; const s = row.subjects?.slug; if (e && s) { const k = `${e}:${row.exam_year}:${s}`; haveMap.set(k, (haveMap.get(k) ?? 0) + 1); } }
        if ((r.data ?? []).length < 1000) break;
      }
      const plan = buildPlan(catalog, (exam, year, subject) => haveMap.get(`${exam}:${year}:${subject}`) ?? 0, { startYear: cursorYear, endYear: cursorYear, exams });
      const rows = plan.map((u) => ({ job_id: job.id, exam_slug: u.exam, exam_year: u.year, subject_slug: u.subject, status: u.needed ? "queued" : "skipped" }));
      if (rows.length) { const ins = await db.from("import_units").insert(rows); if (ins.error) throw ins.error; }
      cursorYear -= 1; plannedThisSlice += 1;
      await update(db, "import_jobs", job.id, { plan_cursor_year: cursorYear });
    }
    await setIfRunning({ status: "queued" }); summary.stoppedBecause = "planning"; return summary;
  }
  if (!units.length) units = await loadUnits();
  const totals = { discovered_count: job.discovered_count ?? 0, inserted_count: job.inserted_count ?? 0, updated_count: job.updated_count ?? 0, skipped_count: job.skipped_count ?? 0, quarantined_count: job.quarantined_count ?? 0, rejected_count: job.rejected_count ?? 0, requests_made: job.requests_made ?? 0, credits_used: job.credits_used ?? 0 }; const writeTotals = () => update(db, "import_jobs", job.id, totals); const store = deps.createStore(db); let lastRequestAt = 0;
  for (const unit of sortUnits(units.filter((u) => !FINISHED.includes(u.status)))) {
    while (!FINISHED.includes(unit.status)) {
      if (lastRequestAt > 0) { const wait = PACE_MS - (deps.now() - lastRequestAt); if (wait > 0) await deps.sleep(wait); }
      if (deps.now() - sliceStart + HEADROOM_MS >= budgetMs) { await setIfRunning({ status: "queued" }); summary.stoppedBecause = "budget"; return summary; }
      const fresh = await get(db, "import_jobs", job.id); if (!fresh || fresh.status !== "running") { summary.stoppedBecause = fresh?.status === "cancelled" ? "cancelled" : "paused"; return summary; }
      lastRequestAt = deps.now(); const pageNumber = (unit.pages_fetched ?? 0) + 1;
      try {
        const result: any = await deps.fetchQuestions({ subject: unit.subject_slug, examType: unit.exam_slug, year: unit.exam_year, cursor: unit.cursor ?? undefined, limit: 15 }); const questions: any[] = result.questions ?? []; const invalid: any[] = result.invalid ?? []; const fetched = questions.length + invalid.length; const pagination = result.pagination ?? {}; const nextCursor: string | null = pagination.nextCursor ?? result.nextCursor ?? null; const more = Boolean(pagination.hasMore ?? result.hasMore ?? nextCursor) && Boolean(nextCursor); const before = typeof result.creditsRemainingBefore === "number" ? result.creditsRemainingBefore : null; const after = typeof result.creditsRemainingAfter === "number" ? result.creditsRemainingAfter : typeof result.creditsRemaining === "number" ? result.creditsRemaining : null; const drop = before !== null && after !== null && before >= after ? before - after : null; const credits = reportedCredits(result.creditsUsed ?? (drop && drop > 0 ? drop : undefined)); const attempts = reportedCredits(result.attempts); const page: PageSummary = { exam: unit.exam_slug, year: unit.exam_year, pageNumber, questions: questions.length, creditsUsed: credits, attempts, creditsRemaining: after, keyLabel: result.keyLabel ?? null, empty: Boolean(result.empty) || fetched === 0 };
        if (summary.pages.length < 60) summary.pages.push(page); summary.requestsMade += 1; summary.creditsUsed += credits; if (page.keyLabel && !summary.keysUsed.includes(page.keyLabel)) summary.keysUsed.push(page.keyLabel); totals.requests_made += 1; totals.credits_used += credits; console.log(JSON.stringify({ ...page, jobId: job.id, creditsRemainingBefore: before })); if (attempts > 1 || credits > 1) await db.from("import_errors").insert({ job_id: job.id, unit_id: unit.id, error_code: "extra_credit_charge", message: `${unit.exam_slug} ${unit.exam_year} page ${pageNumber}: attempts ${attempts}, credits ${credits}` });
        const saved: any = questions.length ? await deps.saveQuestions(store, questions, { examType: unit.exam_slug, year: unit.exam_year, jobId: job.id }) : { inserted: 0, updated: 0, skipped: 0, quarantined: 0, rejected: 0, failed: 0 }; if ((saved.failed ?? 0) > 0) throw new Error(`saving page ${pageNumber} failed for ${saved.failed} question(s)`);
        totals.discovered_count += fetched; totals.inserted_count += saved.inserted ?? 0; totals.updated_count += saved.updated ?? 0; totals.skipped_count += saved.skipped ?? 0; totals.quarantined_count += saved.quarantined ?? 0; totals.rejected_count += (saved.rejected ?? 0) + invalid.length; summary.discovered += fetched; summary.inserted += saved.inserted ?? 0; summary.updated += saved.updated ?? 0; summary.quarantined += saved.quarantined ?? 0; summary.skipped = (summary.skipped ?? 0) + (saved.skipped ?? 0); summary.rejected = (summary.rejected ?? 0) + (saved.rejected ?? 0) + invalid.length;
        const nextStatus = more ? "running" : pageNumber === 1 && fetched === 0 ? "empty" : "done"; await update(db, "import_units", unit.id, { cursor: more ? nextCursor : null, pages_fetched: pageNumber, questions_seen: (unit.questions_seen ?? 0) + fetched, status: nextStatus, last_error: null }); unit.cursor = more ? nextCursor : null; unit.pages_fetched = pageNumber; unit.questions_seen = (unit.questions_seen ?? 0) + fetched; unit.status = nextStatus; await writeTotals();
        if (cap !== null && totals.credits_used >= cap) { await setIfRunning({ status: "paused", error_summary: "Credit cap reached" }); summary.stoppedBecause = "credit_cap"; return summary; }
      } catch (error) { if (error instanceof AllKeysUnavailableError) { await setIfRunning({ status: "paused", error_summary: KEYS_MESSAGE }); summary.stoppedBecause = "no_keys"; return summary; } if (error instanceof AlocRateLimitedError) { await setIfRunning({ status: "queued" }); summary.stoppedBecause = "rate_limited"; return summary; } await db.from("import_errors").insert({ job_id: job.id, unit_id: unit.id, error_code: "unit_fetch_failed", message: safeMessage(error) }); const counted = await db.from("import_errors").select("id", { count: "exact", head: true }).eq("unit_id", unit.id).eq("error_code", "unit_fetch_failed"); if ((counted.count ?? 0) >= 5) { await update(db, "import_units", unit.id, { status: "failed", last_error: safeMessage(error) }); unit.status = "failed"; break; } await update(db, "import_units", unit.id, { last_error: safeMessage(error) }); await setIfRunning({ status: "queued" }); summary.stoppedBecause = "transient"; return summary; }
    }
  }
  const allFinished = units.every((u) => FINISHED.includes(u.status)); if (!allFinished) { await setIfRunning({ status: "queued" }); summary.stoppedBecause = summary.stoppedBecause ?? "budget"; return summary; } const allFailed = units.length > 0 && units.every((u) => u.status === "failed"); await setIfRunning({ status: allFailed ? "failed" : "completed", completed_at: iso(), ...(allFailed ? { error_summary: "Every import unit failed" } : {}) }); summary.stoppedBecause = "done"; return summary;
}
