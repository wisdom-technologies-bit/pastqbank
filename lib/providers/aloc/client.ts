import "server-only";
import { getServerEnv } from "@/lib/env/server";
import { AllKeysUnavailableError, AlocRateLimitedError, AlocRequestError, AlocTransientError } from "./errors";
import { AlocResponseSchema, type AlocExamType, type AlocQuestion, type AlocPagination } from "./types";
import { coolKey, markKeyExhausted, markKeyInvalid, markKeyUsed, selectKey, type DiscoveredKey } from "./keyPool";

type Input = { examType?: AlocExamType; year?: number; subject?: string; cursor?: string; limit?: number };
let learnedLimit = 15;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchQuestions(input: Input) {
  if (!input.subject && !input.examType && input.year === undefined) throw new Error("At least one of subject, examType, or year is required");
  const tried = new Set<string>();
  let key = await selectKey();
  const limit = Math.min(input.limit ?? learnedLimit, 15);
  for (;;) {
    tried.add(key.envVarName);
    const result = await requestWithRetries(key, { ...input, limit });
    if (result.status === 404) return emptyResult(key.label);
    if (result.status === 401) { await markKeyInvalid(key, "unauthorized key"); key = await nextKey(tried); continue; }
    if (result.status === 403 && result.body?.error === "quota_exceeded") { await markKeyExhausted(key, "ALOC quota exceeded"); key = await nextKey(tried); continue; }
    if (result.status === 403 && result.body?.error === "email_verification_required") { await markKeyInvalid(key, "ALOC account email must be verified"); key = await nextKey(tried); continue; }
    if (result.status === 429) {
      const seconds = Number(result.headers.get("retry-after") ?? 20);
      coolKey(key, seconds);
      try { key = await nextKey(tried); continue; } catch {
        if (seconds <= 8) { await sleep(seconds * 1000); tried.delete(key.envVarName); key = await selectKey(); continue; }
        throw new AlocRateLimitedError(seconds, diagnostics(result, key, 1));
      }
    }
    if (!result.ok) throw new AlocRequestError(result.status, String(result.body?.error ?? "request_failed"), String(result.body?.message ?? "ALOC request rejected"), diagnostics(result, key, result.attempts));
    const parsed = AlocResponseSchema.parse(result.body);
    const credits = parsed.meta.creditsRemaining ?? Number(result.headers.get("x-credits-remaining") ?? 0);
    await markKeyUsed(key, credits);
    applyRateLimitCooling(result, key);
    return { questions: parsed.data, pagination: parsed.pagination, creditsUsed: parsed.meta.creditsUsed, creditsRemaining: credits, keyLabel: key.label, empty: false, requestId: parsed.meta.requestId };
  }
}

async function requestWithRetries(key: DiscoveredKey, input: Input) {
  let last: { status: number; body: any; headers: Headers; attempts: number; ok: boolean } | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { const result = await request(key, input); last = { ...result, attempts: attempt }; if (result.status < 500) return last; if (attempt < 3) await sleep(2 ** (attempt - 1) * 500 + Math.floor(Math.random() * 100)); }
    catch (error) { if (attempt === 3) throw new AlocTransientError("ALOC service temporarily unavailable", { attempts: attempt, snippet: error instanceof Error ? `${error.name} ${error.name === "AbortError" ? "timeout" : "fetch failed"}` : "fetch failed", host: getServerEnv().ALOC_BASE_URL }); await sleep(2 ** (attempt - 1) * 500 + Math.floor(Math.random() * 100)); }
  }
  throw new AlocTransientError("ALOC service temporarily unavailable", { httpStatus: last?.status ?? null, attempts: 3, alocError: last?.body?.error ?? null, snippet: JSON.stringify(last?.body ?? "server error"), host: getServerEnv().ALOC_BASE_URL });
}

async function request(key: DiscoveredKey, input: Input) {
  const env = getServerEnv(); const params = new URLSearchParams(); Object.entries(input).forEach(([k, v]) => v !== undefined && params.set(k, String(v)));
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 25000);
  try { const response = await fetch(`${env.ALOC_BASE_URL}/questions?${params}`, { headers: { "X-API-Key": key.secret, Accept: "application/json", "User-Agent": "PastQBank/1.0" }, signal: controller.signal }); let body: any = null; try { body = await response.json(); } catch { body = null; } return { ok: response.ok, status: response.status, body, headers: response.headers }; } finally { clearTimeout(timer); }
}
function diagnostics(result: { status: number; body: any; headers: Headers }, key: DiscoveredKey, attempts: number) { return { httpStatus: result.status, alocError: result.body?.error ?? null, attempts, host: getServerEnv().ALOC_BASE_URL, snippet: JSON.stringify(result.body ?? "") }; }
function applyRateLimitCooling(result: { headers: Headers }, key: DiscoveredKey) { const remaining = Number(result.headers.get("x-ratelimit-remaining")); const reset = result.headers.get("x-ratelimit-reset"); if ((remaining === 0 || remaining === 1) && reset) coolKey(key, Math.max(0, Number(reset) - Math.floor(Date.now() / 1000))); }
async function nextKey(tried: Set<string>) { const key = await selectKey(); if (tried.has(key.envVarName)) throw new AllKeysUnavailableError("all other ALOC keys are unavailable"); return key; }
function emptyResult(keyLabel: string) { const pagination: AlocPagination = { nextCursor: null, prevCursor: null, hasMore: false }; return { questions: [] as AlocQuestion[], pagination, creditsUsed: 0, creditsRemaining: 0, keyLabel, empty: true, requestId: "" }; }
