import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabaseClient: () => state.client }));

import { finalizeSession } from "@/lib/sessions/finalize";
import { markAnswers } from "@/lib/sessions/mark";
import { POST as reveal } from "@/app/api/v1/sessions/[id]/reveal/route";
import { GET as listQuestions } from "@/app/api/v1/sessions/[id]/questions/route";
import { GET as reviewSession } from "@/app/api/v1/sessions/[id]/review/route";

type Tables = { rows?: Record<string, any[]>; singles?: Record<string, any>; session?: any };

function makeDb({ rows = {}, singles = {}, session }: Tables = {}) {
  const calls: { upserts: any[]; updates: any[] } = { upserts: [], updates: [] };
  const single: Record<string, any> = { ...singles, ...(session === undefined ? {} : { exam_sessions: session }) };
  const client = {
    from(table: string) {
      const result = () => ({ data: rows[table] ?? [], error: null });
      const chain: any = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.not = () => chain;
      chain.gte = () => chain;
      chain.lt = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = async () => ({ data: single[table] ?? null, error: null });
      chain.update = (payload: any) => { calls.updates.push({ table, payload }); return chain };
      chain.upsert = (payload: any) => { calls.upserts.push({ table, payload }); return Promise.resolve({ error: null }) };
      chain.insert = (payload: any) => { calls.upserts.push({ table, payload }); return Promise.resolve({ error: null }) };
      chain.then = (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject);
      return chain;
    },
  };
  return { client, calls };
}

const question = (id: string, correct = "A") => ({ id, text: `${id} text`, options: { A: "one", B: "two", C: "three", D: "four" }, correct_answer: correct, explanation: `${id} because` });

describe("revealed questions are unanswered", () => {
  it("counts a revealed question as unanswered, not wrong", async () => {
    const { client } = makeDb({
      session: { id: "s1", status: "in_progress", started_at: new Date().toISOString(), exam_slug: "waec", config: {}, result: null },
      rows: {
        exam_session_questions: [
          { question_id: "q1", subject_slug: "mathematics" },
          { question_id: "q2", subject_slug: "mathematics" },
          { question_id: "q3", subject_slug: "mathematics" },
        ],
        exam_session_answers: [
          { question_id: "q1", selected_option: "A" },
          { question_id: "q2", selected_option: null, revealed_at: "2026-10-30T10:00:00.000Z" },
        ],
        questions: [question("q1", "A"), question("q2", "B"), question("q3", "C")],
        subjects: [{ slug: "mathematics", name: "Mathematics" }],
      },
    });
    state.client = client;
    const result: any = await finalizeSession("s1");
    expect(result.total).toBe(3);
    expect(result.answered).toBe(1);
    expect(result.correct).toBe(1);
    expect(result.wrong).toBe(0);
    expect(result.unanswered).toBe(2);
    expect(result.subjects[0]).toMatchObject({ total: 3, answered: 1, correct: 1, wrong: 0, unanswered: 2 });
  });
});

describe("markAnswers against a revealed question", () => {
  const tables = (answersSingle: any) => makeDb({
    singles: { exam_session_answers: answersSingle },
    rows: { exam_session_questions: [{ id: "ref-1", question_id: "q1" }], questions: [question("q1", "B")] },
  });

  it("refuses to answer a revealed question", async () => {
    const { client } = tables({ selected_option: null, revealed_at: "2026-10-30T10:00:00.000Z" });
    state.client = client;
    await expect(markAnswers("s1", [{ ref: "ref-1", choice: "B", flagged: false }], "practice", "instant")).rejects.toThrow("already_revealed");
  });

  it("still answers an untouched question", async () => {
    const { client, calls } = tables({ selected_option: null, revealed_at: null });
    state.client = client;
    const output = await markAnswers("s1", [{ ref: "ref-1", choice: "B", flagged: false }], "practice", "instant");
    expect(output).toEqual([{ ref: "ref-1", is_correct: true, correct_choice: "B" }]);
    expect(calls.upserts[0].payload).toMatchObject({ selected_option: "B", is_correct: true });
  });

  it("keeps revealed_at when a flag-only update touches the row", async () => {
    const { client, calls } = tables({ selected_option: null, revealed_at: "2026-10-30T10:00:00.000Z" });
    state.client = client;
    await markAnswers("s1", [{ ref: "ref-1", flagged: true } as any], "practice", "instant");
    expect(calls.upserts[0].payload).toEqual({ session_id: "s1", question_id: "q1", is_flagged: true, updated_at: expect.any(String) });
    expect(calls.upserts[0].payload).not.toHaveProperty("revealed_at");
  });
});

describe("POST /sessions/{id}/reveal", () => {
  const session = (over: any = {}) => ({ id: "s1", user_ref: "u1", status: "in_progress", mode: "practice", feedback_mode: "instant", total_questions: 1, ...over });
  const call = async (db: ReturnType<typeof makeDb>, body: any = { ref: "ref-1" }) => {
    state.client = db.client;
    const res = await reveal(new Request("http://localhost/api/v1/sessions/s1/reveal", { method: "POST", headers: { authorization: "Bearer test-key", "x-user-ref": "u1", "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "s1" }) });
    return { status: res.status, json: await res.json() };
  };
  const outline = [{ position: 1, id: "ref-1", subject_slug: "mathematics", subject_number: 1, passage_key: null }];

  beforeEach(() => { vi.stubEnv("BANK_SERVICE_KEY", "test-key"); });

  it("reveals an unanswered practice question and keeps its flag", async () => {
    const db = makeDb({
      session: session(),
      singles: { exam_session_answers: { selected_option: null, is_flagged: true, revealed_at: null }, exam_session_questions: { question_id: "q1" }, questions: question("q1", "C") },
      rows: { exam_session_questions: outline },
    });
    const { status, json } = await call(db);
    expect(status).toBe(200);
    expect(json.data).toEqual({ ref: "ref-1", correct_choice: "C", explanation: "q1 because", revealed: true });
    expect(json.meta.generatedAt).toEqual(expect.any(String));
    expect(db.calls.upserts[0].payload).toMatchObject({ session_id: "s1", question_id: "q1", selected_option: null, is_correct: false, is_flagged: true, answered_at: null, revealed_at: expect.any(String) });
  });

  it("does not touch an already answered question and reports its correctness", async () => {
    const db = makeDb({
      session: session(),
      singles: { exam_session_answers: { selected_option: "B", is_correct: true, revealed_at: null }, exam_session_questions: { question_id: "q1" }, questions: question("q1", "C") },
      rows: { exam_session_questions: outline },
    });
    const { status, json } = await call(db);
    expect(status).toBe(200);
    expect(json.data).toMatchObject({ ref: "ref-1", correct_choice: "C", is_correct: true, revealed: false });
    expect(db.calls.upserts).toHaveLength(0);
  });

  it("rejects a CBT session", async () => {
    const db = makeDb({ session: session({ mode: "cbt", feedback_mode: "end" }), singles: { exam_session_questions: { question_id: "q1" }, questions: question("q1", "C") }, rows: { exam_session_questions: outline } });
    const { status, json } = await call(db, { ref: "ref-1" });
    expect(status).toBe(409);
    expect(json.error.code).toBe("reveal_not_allowed");
  });

  it("rejects a question outside the session", async () => {
    const db = makeDb({ session: session(), rows: { exam_session_questions: outline } });
    const { status, json } = await call(db, { ref: "nope" });
    expect(status).toBe(422);
    expect(json.error.code).toBe("invalid_question_ref");
  });
});

describe("revealed flag in the read endpoints", () => {
  const row = { id: "ref-1", position: 1, subject_slug: "mathematics", subject_number: 1, passage_key: null, question_id: "q1" };
  const bank = (over: any = {}) => ({ ...question("q1", "C"), section: null, has_passage: false, question_number: null, passage_key: null, image_url: null, ...over });
  const get = (route: any, table: string, db: ReturnType<typeof makeDb>, query = "") => {
    state.client = db.client;
    return route(new Request(`http://localhost/api/v1/sessions/s1/${table}${query}`, { headers: { authorization: "Bearer test-key", "x-user-ref": "u1" } }), { params: Promise.resolve({ id: "s1" }) });
  };

  beforeEach(() => { vi.stubEnv("BANK_SERVICE_KEY", "test-key"); });

  it("marks a revealed question in GET /questions without leaking the answer", async () => {
    const db = makeDb({
      session: { id: "s1", user_ref: "u1", status: "in_progress", mode: "practice", feedback_mode: "instant", total_questions: 1 },
      rows: { exam_session_questions: [row], questions: [bank()], exam_session_answers: [{ question_id: "q1", is_flagged: false, revealed_at: "2026-10-30T10:00:00.000Z" }] },
    });
    const json: any = await (await get(listQuestions, "questions", db)).json();
    const item = json.data[0];
    expect(item).toMatchObject({ ref: "ref-1", number: 1, text: "q1 text", image_url: null, revealed: true, flagged: false });
    expect(item).not.toHaveProperty("correct_choice");
    expect(item).not.toHaveProperty("explanation");
    expect(item).not.toHaveProperty("question");
  });

  it("marks a revealed question in GET /review and adds its explanation", async () => {
    const db = makeDb({
      session: { id: "s1", user_ref: "u1", status: "submitted", started_at: new Date().toISOString(), exam_slug: "waec", config: {}, result: null },
      rows: { exam_session_questions: [row], questions: [bank()], exam_session_answers: [{ question_id: "q1", selected_option: null, is_flagged: false, revealed_at: "2026-10-30T10:00:00.000Z" }], subjects: [{ slug: "mathematics", name: "Mathematics" }] },
    });
    const json: any = await (await get(reviewSession, "review", db)).json();
    expect(json.data[0]).toMatchObject({ ref: "ref-1", your_choice: null, correct_choice: "C", is_correct: false, revealed: true, explanation: "q1 because", question: { text: "q1 text", image_url: null } });
  });
});
