// lib/imports/planner.ts
// Pure planning logic. No network, no DB. Turns the FREE ALOC catalog into work units.

export type ExamSlug = "jamb" | "waec" | "neco" | "post_utme";

export const EXAM_ORDER: ExamSlug[] = ["jamb", "waec", "neco", "post_utme"];

/** Observed real coverage. Years outside a window are skipped for free. */
export const COVERAGE: Record<ExamSlug, { from: number; to: number }> = {
  jamb: { from: 1978, to: 2100 },
  waec: { from: 1988, to: 2021 },
  neco: { from: 2012, to: 2019 },
  post_utme: { from: 2006, to: 2013 },
};

export function inCoverage(exam: ExamSlug, year: number): boolean {
  const w = COVERAGE[exam];
  return year >= w.from && year <= w.to;
}

/** One row of GET /subjects/{subject}/years or /subjects/years/{year}, normalised. */
export interface CatalogEntry {
  subject: string;
  year: number;
  exam: ExamSlug;
  count: number;
}

export interface PlanUnit {
  exam: ExamSlug;
  year: number;
  subject: string;
  expected: number;
  alreadyHave: number;
  needed: boolean;
}

/** ALOC pages are 15 questions. Pages 1-6 cost 1 credit, 7-11 cost 3, 12+ cost 10. */
export const PAGE_SIZE = 15;
export function pageCost(page: number): number {
  if (page <= 6) return 1;
  if (page <= 11) return 3;
  return 10;
}
export function estimateCredits(questionCount: number): number {
  const pages = Math.ceil(questionCount / PAGE_SIZE);
  let total = 0;
  for (let p = 1; p <= pages; p++) total += pageCost(p);
  return total;
}

/**
 * Build the ordered plan.
 * - newest year first, then exam order, then subject name
 * - drops out-of-coverage and empty entries
 * - marks units whose DB count already reaches the catalog count as not needed (zero cost)
 */
export function buildPlan(
  catalog: CatalogEntry[],
  have: (exam: ExamSlug, year: number, subject: string) => number,
  opts: { startYear: number; endYear: number; exams?: ExamSlug[] },
): PlanUnit[] {
  const exams = opts.exams ?? EXAM_ORDER;
  const out: PlanUnit[] = [];
  for (const e of catalog) {
    if (!exams.includes(e.exam)) continue;
    if (e.year > opts.startYear || e.year < opts.endYear) continue;
    if (e.count <= 0) continue;
    if (!inCoverage(e.exam, e.year)) continue;
    const got = have(e.exam, e.year, e.subject);
    out.push({ exam: e.exam, year: e.year, subject: e.subject, expected: e.count, alreadyHave: got, needed: got < e.count });
  }
  out.sort((a, b) => b.year - a.year || EXAM_ORDER.indexOf(a.exam) - EXAM_ORDER.indexOf(b.exam) || a.subject.localeCompare(b.subject));
  return out;
}

export function planSummary(units: PlanUnit[]) {
  const needed = units.filter((u) => u.needed);
  return {
    totalUnits: units.length,
    neededUnits: needed.length,
    skippedUnits: units.length - needed.length,
    expectedQuestions: needed.reduce((s, u) => s + (u.expected - u.alreadyHave), 0),
    estimatedCredits: needed.reduce((s, u) => s + estimateCredits(u.expected), 0),
  };
}

/** Parse the free catalog payloads defensively (shapes seen in the Termux tests). */
export function parseYearCatalog(payload: unknown, year: number): CatalogEntry[] {
  const rows = extractRows(payload);
  const out: CatalogEntry[] = [];
  for (const r of rows) {
    const subject = str(r.subject ?? r.slug ?? r.name);
    if (!subject) continue;
    const by = r.byExam ?? r.exams ?? r.examTypes ?? r.breakdown;
    if (by && typeof by === "object") {
      for (const [k, v] of Object.entries(by as Record<string, unknown>)) {
        const exam = toExam(k);
        const count = Number(typeof v === "object" && v ? (v as any).count ?? (v as any).questionCount : v);
        if (exam && Number.isFinite(count)) out.push({ subject, year, exam, count });
      }
    } else {
      const exam = toExam(str(r.examType ?? r.exam) ?? "jamb");
      const count = Number(r.questionCount ?? r.count ?? r.total);
      if (exam && Number.isFinite(count)) out.push({ subject, year, exam, count });
    }
  }
  return out;
}

function extractRows(p: unknown): any[] {
  if (Array.isArray(p)) return p;
  if (p && typeof p === "object") {
    const o = p as any;
    for (const k of ["data", "subjects", "years", "items", "results"]) {
      if (Array.isArray(o[k])) return o[k];
      if (o[k] && typeof o[k] === "object") {
        const inner = extractRows(o[k]);
        if (inner.length) return inner;
      }
    }
  }
  return [];
}
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function toExam(v: string | null): ExamSlug | null {
  if (!v) return null;
  const s = v.toLowerCase().replace(/[-\s]/g, "_");
  return (EXAM_ORDER as string[]).includes(s) ? (s as ExamSlug) : null;
}
