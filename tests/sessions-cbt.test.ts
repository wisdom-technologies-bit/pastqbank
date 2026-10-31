import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ client: null as any, context: null as any }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabaseClient: () => state.client }));
vi.mock("@/lib/catalog/service", () => ({ catalogContext: async () => state.context, envelope: (data: unknown) => ({ data, meta: { generatedAt: new Date().toISOString() } }) }));

import { createSession } from "@/lib/sessions/api";
import { finalizeSession } from "@/lib/sessions/finalize";
import { markAnswers } from "@/lib/sessions/mark";
import { cbtEligibility, requiredCount, subjectQualifies } from "@/lib/catalog/rules";
import { donorYearFor, subjectCounts } from "@/lib/catalog/donor";
import { makeDb } from "./support/fake-supabase";
import { GET as sessionDetail } from "@/app/api/v1/sessions/[id]/route";
import { POST as startSession } from "@/app/api/v1/sessions/[id]/start/route";
import { PUT as putAnswers } from "@/app/api/v1/sessions/[id]/answers/route";
import { POST as submitSession } from "@/app/api/v1/sessions/[id]/submit/route";
import { GET as cbtPlan } from "@/app/api/v1/exams/[exam]/years/[year]/cbt-plan/route";

const SETTINGS = { free_year_count: 2, min_questions_for_listing: 10, min_questions_for_practice: 5, qualify_ratio: 0.9 };
const SUBJECTS = ["english-language", "mathematics", "physics", "chemistry", "biology"];
const subjectRows = SUBJECTS.map((slug) => ({ id: `sub-${slug}`, slug }));
const jambProfile = { subjects_required: 4, compulsory_subject_slug: "english-language", default_question_count: 40, default_minutes: 120, shared_timer: true, total_minutes: 120, min_minutes: 5, max_minutes: 240, overrides: new Map([["english-language", { question_count: 60, minutes: null }]]) };

const JAMB: Record<number, Record<string, number>> = {
  2025: { "english-language": 60, mathematics: 40, physics: 40, chemistry: 40 },
  2024: { "english-language": 60, mathematics: 40, physics: 40, chemistry: 40 },
  2023: { mathematics: 40, physics: 40, chemistry: 40, biology: 40 },
  2022: { mathematics: 40, physics: 40, chemistry: 40, biology: 40 },
};

const catalogFor = (spec: Record<number, Record<string, number>>) => Object.entries(spec).flatMap(([year, subjects]) => Object.entries(subjects).map(([slug, count]) => ({ exam_year: Number(year), subject_slug: slug, published_count: count })));
const bankFor = (spec: Record<number, Record<string, number>>) => {
  const rows: any[] = [];
  for (const [year, subjects] of Object.entries(spec)) for (const [slug, count] of Object.entries(subjects)) for (let n = 1; n <= count; n++) rows.push({ id: `${slug}-${year}-${n}`, subject_id: `sub-${slug}`, exam_year: Number(year), question_number: n, passage_key: null, status: "published" });
  return rows;
};

function context({ client, spec = JAMB, profile = jambProfile as any, free }: { client: any; spec?: Record<number, Record<string, number>>; profile?: any; free?: number[] }) {
  const catalog = catalogFor(spec), years = [...new Set(catalog.map((r) => r.exam_year))].sort((a, b) => b - a);
  const totals = new Map<number, number>();
  for (const r of catalog) totals.set(r.exam_year, (totals.get(r.exam_year) ?? 0) + r.published_count);
  const listable = years.filter((y) => (totals.get(y) ?? 0) >= SETTINGS.min_questions_for_listing);
  const c: any = { db: client, exam: { slug: "jamb" }, profile, rawProfile: profile, overrides: [], settings: SETTINGS, catalog, years: listable, totals, free: new Set(free ?? listable.slice(0, SETTINGS.free_year_count)), requiredCount, subjectQualifies };
  c.cbt = (year: number) => cbtEligibility(profile, subjectCounts(c, year), SETTINGS);
  return c;
}

const createDb = (spec = JAMB) => makeDb({ rows: { exams: [{ id: "exam-1" }], subjects: subjectRows, questions: bankFor(spec) }, singles: { exams: { id: "exam-1" } } });
const cbtBody = (over: any = {}) => ({ user_ref: "u1", tier: "premium", mode: "cbt", exam: "jamb", year: 2025, subjects: [{ slug: "english-language" }, { slug: "mathematics" }, { slug: "physics" }, { slug: "chemistry" }], ...over });

async function create(db: ReturnType<typeof makeDb>, ctx: any, body: any) {
  state.client = db.client; state.context = ctx;
  const res = await createSession(body);
  return { status: res.status, json: await res.json(), calls: db.calls };
}

describe("POST /sessions CBT validation", () => {
  it("builds a complete CBT paper with fixed counts and one shared timer", async () => {
    const db = createDb();
    const { status, json, calls } = await create(db, context({ client: db.client }), cbtBody());
    expect(status).toBe(201);
    expect(json.data).toMatchObject({ status: "created", mode: "cbt", year: 2025, total_questions: 180, duration_seconds: 7200, feedback_mode: "end" });
    expect(json.data.subjects).toEqual([
      { slug: "english-language", name: "english-language", question_count: 60, borrowed_from_year: null },
      { slug: "mathematics", name: "mathematics", question_count: 40, borrowed_from_year: null },
      { slug: "physics", name: "physics", question_count: 40, borrowed_from_year: null },
      { slug: "chemistry", name: "chemistry", question_count: 40, borrowed_from_year: null },
    ]);
    const payload = calls.rpc[0].args;
    expect(payload.p_session).toMatchObject({ duration_seconds: 7200, total_questions: 180, feedback_mode: "end" });
    expect(payload.p_questions).toHaveLength(180);
    expect(payload.p_questions.every((q: any) => q.borrowed_from_year === null)).toBe(true);
    expect(payload.p_questions[0]).toMatchObject({ position: 1, subject_slug: "english-language", question_id: "english-language-2025-1", subject_number: 1 });
  });

  it("ignores client question counts", async () => {
    const db = createDb();
    const { json } = await create(db, context({ client: db.client }), cbtBody({ subjects: [{ slug: "english-language" }, { slug: "mathematics", question_count: 5 }, { slug: "physics" }, { slug: "chemistry", question_count: 1 }] }));
    expect(json.data.subjects.map((s: any) => s.question_count)).toEqual([60, 40, 40, 40]);
  });

  it("rejects a subject that does not qualify for the year", async () => {
    const db = createDb();
    const { status, json } = await create(db, context({ client: db.client }), cbtBody({ subjects: [{ slug: "english-language" }, { slug: "mathematics" }, { slug: "physics" }, { slug: "biology" }] }));
    expect(status).toBe(422);
    expect(json.error.code).toBe("invalid_config");
    expect(json.error.details.subjects).toEqual(["biology"]);
  });

  it("requires the compulsory subject when the year has it", async () => {
    const db = createDb();
    const { status, json } = await create(db, context({ client: db.client }), cbtBody({ subjects: [{ slug: "mathematics" }, { slug: "physics" }, { slug: "chemistry" }, { slug: "biology" }].map((s) => s) }));
    expect(status).toBe(422);
    expect(json.error.code).toBe("compulsory_subject_required");
  });

  it("enforces the subject count", async () => {
    const db = createDb();
    const { status, json } = await create(db, context({ client: db.client }), cbtBody({ subjects: [{ slug: "english-language" }, { slug: "mathematics" }, { slug: "physics" }] }));
    expect(status).toBe(422);
    expect(json.error.code).toBe("invalid_config");
    expect(json.error.details).toMatchObject({ minSubjects: 4, maxSubjects: 4, subjects: 3 });
  });

  it("needs a specific year", async () => {
    const db = createDb();
    const { status, json } = await create(db, context({ client: db.client }), cbtBody({ year: null }));
    expect(status).toBe(422);
    expect(json.error.details).toMatchObject({ reason: "year_required" });
  });

  it("clamps a count to what exists when the subject only just qualifies", async () => {
    const spec = { 2025: { "english-language": 60, mathematics: 40, physics: 40, chemistry: 36 } };
    const db = createDb(spec);
    const { status, json } = await create(db, context({ client: db.client, spec }), cbtBody());
    expect(status).toBe(201);
    expect(json.data.subjects[3]).toMatchObject({ slug: "chemistry", question_count: 36 });
    expect(json.data.total_questions).toBe(176);
  });

  it("clamps a client minutes value to the profile limits", async () => {
    const db = createDb();
    const over = await create(db, context({ client: db.client }), cbtBody({ minutes: 1000 }));
    expect(over.json.data.duration_seconds).toBe(240 * 60);
    const under = await create(db, context({ client: db.client }), cbtBody({ minutes: 1 }));
    expect(under.json.data.duration_seconds).toBe(5 * 60);
  });

  it("sums per-subject minutes when the exam has no shared timer", async () => {
    const spec = { 2025: { "english-language": 80, mathematics: 50 } };
    const profile = { subjects_required: 2, compulsory_subject_slug: null, default_question_count: 40, default_minutes: 60, shared_timer: false, total_minutes: null, min_minutes: 5, max_minutes: 240, overrides: new Map([["english-language", { question_count: 80, minutes: 45 }]]) };
    const db = createDb(spec);
    const { status, json } = await create(db, context({ client: db.client, spec, profile }), cbtBody({ exam: "waec", subjects: [{ slug: "english-language" }, { slug: "mathematics" }] }));
    expect(status).toBe(201);
    expect(json.data.duration_seconds).toBe((45 + 60) * 60);
    expect(json.data.total_questions).toBe(120);
  });

  it("keeps the original order unless shuffled is asked for", async () => {
    const db = createDb();
    await create(db, context({ client: db.client }), cbtBody());
    expect(db.calls.rpc[0].args.p_questions[1].question_id).toBe("english-language-2025-2");
    const shuffled = createDb();
    await create(shuffled, context({ client: shuffled.client }), cbtBody({ order: "shuffled" }));
    expect(shuffled.calls.rpc[0].args.p_questions).toHaveLength(180);
  });
});

describe("POST /sessions CBT missing compulsory subject", () => {
  it("skips it by default when the year has none", async () => {
    const db = createDb();
    const { status, json, calls } = await create(db, context({ client: db.client }), cbtBody({ year: 2022, subjects: [{ slug: "mathematics" }, { slug: "physics" }, { slug: "chemistry" }, { slug: "biology" }] }));
    expect(status).toBe(201);
    expect(json.data.total_questions).toBe(160);
    expect(json.data.subjects.every((s: any) => s.borrowed_from_year === null)).toBe(true);
    expect(calls.rpc[0].args.p_questions.every((q: any) => q.borrowed_from_year === null)).toBe(true);
  });

  it("refuses the compulsory subject in skip mode", async () => {
    const db = createDb();
    const { status, json } = await create(db, context({ client: db.client }), cbtBody({ year: 2022, missing_compulsory: "skip" }));
    expect(status).toBe(422);
    expect(json.error.code).toBe("invalid_config");
  });

  it("borrows the compulsory subject from the donor year", async () => {
    const db = createDb();
    const { status, json, calls } = await create(db, context({ client: db.client }), cbtBody({ year: 2022, missing_compulsory: "borrow" }));
    expect(status).toBe(201);
    expect(json.data.subjects[0]).toMatchObject({ slug: "english-language", question_count: 60, borrowed_from_year: 2024 });
    expect(json.data.subjects.slice(1).every((s: any) => s.borrowed_from_year === null)).toBe(true);
    const borrowed = calls.rpc[0].args.p_questions.filter((q: any) => q.subject_slug === "english-language");
    expect(borrowed).toHaveLength(60);
    expect(borrowed.every((q: any) => q.borrowed_from_year === 2024 && q.question_id.includes("-2024-"))).toBe(true);
    expect(calls.rpc[0].args.p_session.config.borrowed_from_year).toEqual({ "english-language": 2024 });
  });

  it("requires the compulsory subject when borrowing", async () => {
    const db = createDb();
    const { status, json } = await create(db, context({ client: db.client }), cbtBody({ year: 2022, missing_compulsory: "borrow", subjects: [{ slug: "mathematics" }, { slug: "physics" }, { slug: "chemistry" }, { slug: "biology" }] }));
    expect(status).toBe(422);
    expect(json.error.code).toBe("compulsory_subject_required");
  });

  it("reports a missing donor year", async () => {
    const spec = { 2025: { "english-language": 10, mathematics: 40, physics: 40, chemistry: 40 }, 2024: { mathematics: 40, physics: 40, chemistry: 40, biology: 40 }, 2022: { mathematics: 40, physics: 40, chemistry: 40, biology: 40 } };
    const db = createDb(spec);
    const { status, json } = await create(db, context({ client: db.client, spec }), cbtBody({ year: 2022, missing_compulsory: "borrow" }));
    expect(status).toBe(422);
    expect(json.error.code).toBe("compulsory_subject_missing");
  });

  it("blocks borrowing from a premium donor year for a free user", async () => {
    const db = createDb();
    const { status, json } = await create(db, context({ client: db.client, free: [2025, 2022] }), cbtBody({ year: 2022, tier: "free", missing_compulsory: "borrow" }));
    expect(status).toBe(403);
    expect(json.error.code).toBe("premium_required");
    expect(json.error.details).toMatchObject({ donor_year: 2024 });
  });
});

describe("CBT plan reuses the donor helper", () => {
  const plan = async (ctx: any, query: string) => {
    state.client = ctx.db; state.context = ctx;
    const res = await cbtPlan(new Request(`http://localhost/api/v1/exams/jamb/years/2022/cbt-plan${query}`, { headers: { authorization: "Bearer test-key" } }), { params: Promise.resolve({ exam: "jamb", year: "2022" }) });
    return await res.json();
  };

  beforeEach(() => { vi.stubEnv("BANK_SERVICE_KEY", "test-key"); });

  it("offers a free donor year and matches donorYearFor", async () => {
    const db = createDb();
    const ctx = context({ client: db.client });
    const json = await plan(ctx, "?tier=free");
    expect(json.data).toMatchObject({ compulsorySubject: "english-language", missing: true, minSubjects: 4, maxSubjects: 4 });
    expect(json.data.borrow).toEqual({ available: true, donorYear: 2024, requiresActivation: false });
    expect(donorYearFor(ctx, 2022, "english-language")).toBe(2024);
  });

  it("asks for activation when the donor year is premium", async () => {
    const db = createDb();
    const json = await plan(context({ client: db.client, free: [2025, 2022] }), "?tier=free");
    expect(json.data.borrow).toEqual({ available: false, donorYear: 2024, requiresActivation: true });
  });
});

describe("session timing payloads", () => {
  const baseSession = (over: any = {}) => ({
    id: "s1", user_ref: "u1", status: "in_progress", mode: "cbt", exam_slug: "jamb", exam_year: 2025, tier: "premium", total_questions: 3, duration_seconds: 7200, feedback_mode: "end",
    created_at: new Date().toISOString(), started_at: "2026-10-31T06:00:00.000Z", deadline_at: "2026-10-31T08:00:00.000Z", submitted_at: null, expires_at: "2026-11-01T06:00:00.000Z", config: {}, ...over,
  });
  const outline = [
    { position: 1, id: "r1", subject_slug: "english-language", subject_number: 1, passage_key: null },
    { position: 2, id: "r2", subject_slug: "english-language", subject_number: 2, passage_key: null },
    { position: 3, id: "r3", subject_slug: "mathematics", subject_number: 1, passage_key: null },
  ];

  beforeEach(() => { vi.stubEnv("BANK_SERVICE_KEY", "test-key"); });

  it("returns server_time, timing fields and subject tabs on GET /sessions/{id}", async () => {
    const db = makeDb({ session: baseSession(), rows: { exam_session_questions: outline, subjects: [{ slug: "english-language", name: "English Language" }, { slug: "mathematics", name: "Mathematics" }] } });
    state.client = db.client;
    const res = await sessionDetail(new Request("http://localhost/api/v1/sessions/s1", { headers: { authorization: "Bearer test-key", "x-user-ref": "u1" } }), { params: Promise.resolve({ id: "s1" }) });
    const json: any = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.server_time).toEqual(expect.any(String));
    expect(json.data.started_at).toBe("2026-10-31T06:00:00.000Z");
    expect(json.data.deadline_at).toBe("2026-10-31T08:00:00.000Z");
    expect(json.data.subjects).toEqual([
      { slug: "english-language", name: "English Language", question_count: 2, first_position: 1 },
      { slug: "mathematics", name: "Mathematics", question_count: 1, first_position: 3 },
    ]);
  });

  it("returns server_time when starting and when already started", async () => {
    const fresh = makeDb({ session: baseSession({ status: "created", started_at: null, deadline_at: null }), rows: { exam_session_questions: outline } });
    state.client = fresh.client;
    const started: any = await (await startSession(new Request("http://localhost/api/v1/sessions/s1/start", { method: "POST", headers: { authorization: "Bearer test-key", "x-user-ref": "u1" } }), { params: Promise.resolve({ id: "s1" }) })).json();
    expect(started.data.server_time).toEqual(expect.any(String));
    expect(started.data.status).toBe("in_progress");
    expect(started.data.started_at).toEqual(expect.any(String));
    expect(started.data.deadline_at).toEqual(expect.any(String));
    expect(fresh.calls.updates[0].payload).toMatchObject({ status: "in_progress" });

    const running = makeDb({ session: baseSession(), rows: { exam_session_questions: outline } });
    state.client = running.client;
    const again: any = await (await startSession(new Request("http://localhost/api/v1/sessions/s1/start", { method: "POST", headers: { authorization: "Bearer test-key", "x-user-ref": "u1" } }), { params: Promise.resolve({ id: "s1" }) })).json();
    expect(again.data.server_time).toEqual(expect.any(String));
    expect(again.data.started_at).toBe("2026-10-31T06:00:00.000Z");
    expect(running.calls.updates).toHaveLength(0);
  });
});

describe("result timing and JAMB scaling", () => {
  const fourSubjects = [
    { question_id: "q1", subject_slug: "english-language" },
    { question_id: "q2", subject_slug: "mathematics" },
    { question_id: "q3", subject_slug: "physics" },
    { question_id: "q4", subject_slug: "chemistry" },
  ];
  const questions = [1, 2, 3, 4].map((n) => ({ id: `q${n}`, options: { A: "a", B: "b" }, correct_answer: "A" }));
  const resultDb = (over: any = {}) => makeDb({
    session: { id: "s1", status: "in_progress", exam_slug: "jamb", started_at: new Date(Date.now() - 3600_000).toISOString(), deadline_at: new Date(Date.now() - 1200_000).toISOString(), duration_seconds: 7200, config: {}, result: null, ...over },
    rows: { exam_session_questions: fourSubjects, exam_session_answers: [1, 2, 3, 4].map((n) => ({ question_id: `q${n}`, selected_option: "A" })), questions, subjects: [{ slug: "english-language", name: "English Language" }, { slug: "mathematics", name: "Mathematics" }, { slug: "physics", name: "Physics" }, { slug: "chemistry", name: "Chemistry" }] },
  });

  it("uses the deadline, not the finalize time, for an expired session", async () => {
    const db = resultDb();
    state.client = db.client;
    const result: any = await finalizeSession("s1", true);
    expect(result.time_used_seconds).toBe(2400);
    expect(result.score_400).toBe(400);
    expect(result.subjects.map((s: any) => s.score_100)).toEqual([100, 100, 100, 100]);
  });

  it("caps the time used at the session duration", async () => {
    const db = resultDb({ deadline_at: null, started_at: new Date(Date.now() - 10_800_000).toISOString() });
    state.client = db.client;
    const result: any = await finalizeSession("s1");
    expect(result.time_used_seconds).toBe(7200);
  });

  it("omits score_100 and score_400 for non-JAMB exams", async () => {
    const db = resultDb({ exam_slug: "waec" });
    state.client = db.client;
    const result: any = await finalizeSession("s1", true);
    expect(result.score_400).toBeNull();
    expect(result.subjects.every((s: any) => !("score_100" in s))).toBe(true);
  });
});

describe("CBT answers until the deadline", () => {
  const session = (over: any = {}) => ({ id: "s1", user_ref: "u1", status: "in_progress", mode: "cbt", feedback_mode: "end", total_questions: 1, duration_seconds: 7200, deadline_at: new Date(Date.now() + 600_000).toISOString(), config: {}, ...over });
  const outline = [{ position: 1, id: "ref-1", subject_slug: "mathematics", subject_number: 1, passage_key: null, question_id: "q1" }];
  const mocks = (live: any, existing: any) => makeDb({ session: live, singles: { exam_session_answers: existing }, rows: { exam_session_questions: outline, questions: [{ id: "q1", options: { A: "a", B: "b", C: "c" }, correct_answer: "A" }] } });
  const put = async (db: ReturnType<typeof makeDb>, answers: any[]) => {
    state.client = db.client;
    const res = await putAnswers(new Request("http://localhost/api/v1/sessions/s1/answers", { method: "PUT", headers: { authorization: "Bearer test-key", "x-user-ref": "u1", "content-type": "application/json" }, body: JSON.stringify({ answers }) }), { params: Promise.resolve({ id: "s1" }) });
    return { status: res.status, json: await res.json() };
  };

  beforeEach(() => { vi.stubEnv("BANK_SERVICE_KEY", "test-key"); });

  it("lets a CBT student change and clear an answer", async () => {
    const db = mocks(session(), { selected_option: "B", revealed_at: null });
    const changed = await put(db, [{ ref: "ref-1", choice: "C" }]);
    expect(changed.status).toBe(200);
    expect(db.calls.upserts[0].payload).toMatchObject({ selected_option: "C" });
    const cleared = await put(db, [{ ref: "ref-1", choice: null }]);
    expect(cleared.status).toBe(200);
    expect(cleared.json.data).toEqual({ saved: 1 });
    expect(db.calls.upserts[1].payload).toMatchObject({ selected_option: null, answered_at: null, is_correct: false });
  });

  it("allows answers inside the 30 second grace after the deadline", async () => {
    const db = mocks(session({ deadline_at: new Date(Date.now() - 10_000).toISOString() }), null);
    expect((await put(db, [{ ref: "ref-1", choice: "B" }])).status).toBe(200);
  });

  it("closes the session after the grace window", async () => {
    const db = mocks(session({ deadline_at: new Date(Date.now() - 60_000).toISOString() }), null);
    const closed = await put(db, [{ ref: "ref-1", choice: "B" }]);
    expect(closed.status).toBe(409);
    expect(closed.json.error.code).toBe("session_closed");
  });

  it("still submits and scores after the deadline", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-31T09:00:00.000Z"));
    const db = makeDb({
      session: { id: "s1", user_ref: "u1", status: "in_progress", mode: "cbt", exam_slug: "waec", started_at: "2026-10-31T07:00:00.000Z", deadline_at: "2026-10-31T08:00:00.000Z", duration_seconds: 3600, total_questions: 1, config: {}, result: null },
      rows: { exam_session_questions: [{ question_id: "q1", subject_slug: "mathematics" }], exam_session_answers: [{ question_id: "q1", selected_option: "A" }], questions: [{ id: "q1", options: { A: "a", B: "b" }, correct_answer: "A" }], subjects: [{ slug: "mathematics", name: "Mathematics" }] },
    });
    state.client = db.client;
    const res = await submitSession(new Request("http://localhost/api/v1/sessions/s1/submit", { method: "POST", headers: { authorization: "Bearer test-key", "x-user-ref": "u1" } }), { params: Promise.resolve({ id: "s1" }) });
    const json: any = await res.json();
    vi.useRealTimers();
    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({ total: 1, answered: 1, correct: 1, time_used_seconds: 3600 });
    expect(db.calls.updates[0].payload).toMatchObject({ status: "expired" });
  });
});

describe("markAnswers in CBT mode", () => {
  it("allows changing and clearing an answer", async () => {
    const db = makeDb({ singles: { exam_session_answers: { selected_option: "B", revealed_at: null } }, rows: { exam_session_questions: [{ id: "ref-1", question_id: "q1" }], questions: [{ id: "q1", options: { A: "a", B: "b" }, correct_answer: "A" }] } });
    state.client = db.client;
    await markAnswers("s1", [{ ref: "ref-1", choice: "A", flagged: false }], "cbt", "end");
    expect(db.calls.upserts[0].payload).toMatchObject({ selected_option: "A", is_correct: true });
    await markAnswers("s1", [{ ref: "ref-1", choice: null, flagged: false }], "cbt", "end");
    expect(db.calls.upserts[1].payload).toMatchObject({ selected_option: null, is_correct: false });
  });
});
