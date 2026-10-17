import "server-only";
import { getServerEnv } from "@/lib/env/server";
import { AllKeysUnavailableError, AlocRateLimitedError, AlocRequestError, AlocTransientError } from "./errors";
import { AlocMetaSchema, AlocPaginationSchema, AlocQuestionSchema, type AlocExamType, type AlocQuestion, type AlocPagination } from "./types";
import { coolKey, markKeyExhausted, markKeyInvalid, markKeyUsed, selectKey, type DiscoveredKey } from "./keyPool";

type Input = { examType?: AlocExamType; year?: number; subject?: string; cursor?: string; limit?: number };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const redact = (value: string) => value.slice(0, 200).replace(/aloc_[A-Za-z0-9]+|ALOC-[A-Za-z0-9]+|alc_live_[A-Za-z0-9]+/g, "[redacted]");

export async function fetchQuestions(input: Input) {
  if (!input.subject && !input.examType && input.year === undefined) throw new Error("At least one of subject, examType, or year is required");
  const tried = new Set<string>(); let key = await selectKey(); let attemptsTotal = 0; let creditsBefore: number | null = null;
  const limit = Math.min(input.limit ?? 15, 15);
  for (;;) {
    tried.add(key.envVarName);
    const result = await requestWithRetries(key, { ...input, limit });
    attemptsTotal += result.attempts;
    const responseCredits = result.body?.meta?.creditsRemaining ?? Number(result.headers.get("x-credits-remaining"));
    if (creditsBefore === null && Number.isFinite(responseCredits)) creditsBefore = responseCredits + Number(result.body?.meta?.creditsUsed ?? 1);
    if (result.status === 404) return emptyResult(key.label);
    if (result.status === 401) { await markKeyInvalid(key, "unauthorized key"); key = await nextKey(tried); continue; }
    if (result.status === 403 && result.body?.error === "quota_exceeded") { await markKeyExhausted(key, "ALOC quota exceeded"); key = await nextKey(tried); continue; }
    if (result.status === 403 && result.body?.error === "email_verification_required") { await markKeyInvalid(key, "ALOC account email must be verified"); key = await nextKey(tried); continue; }
    if (result.status === 429) {
      const seconds = Number(result.headers.get("retry-after") ?? 20); coolKey(key, seconds);
      try { key = await nextKey(tried); continue; } catch { if (seconds <= 8) { await sleep(seconds * 1000); tried.delete(key.envVarName); key = await selectKey(); continue; } throw new AlocRateLimitedError(seconds, diagnostics(result, key, result.attempts)); }
    }
    if (!result.ok) throw new AlocRequestError(result.status, String(result.body?.error ?? "request_failed"), String(result.body?.message ?? "ALOC request rejected"), diagnostics(result, key, result.attempts));
    const envelope = parseEnvelope(result.body);
    const questions: AlocQuestion[] = []; const invalid: { index: number; id: string | null; issues: string[] }[] = [];
    envelope.data.forEach((item, index) => { const parsed = AlocQuestionSchema.safeParse(item); if (parsed.success) questions.push(parsed.data); else { const value = item as { id?: unknown }; invalid.push({ index, id: typeof value?.id === "string" ? value.id : null, issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "question"}: ${issue.message}`) }); } });
    const credits = envelope.meta.creditsRemaining ?? Number(result.headers.get("x-credits-remaining") ?? 0); await markKeyUsed(key, credits); applyRateLimitCooling(result, key);
    return { questions, invalid, pagination: envelope.pagination, creditsUsed: envelope.meta.creditsUsed, creditsRemainingBefore: creditsBefore, creditsRemainingAfter: credits, creditsRemaining: credits, attempts: attemptsTotal, keyLabel: key.label, empty: false, requestId: envelope.meta.requestId ?? "" };
  }
}
function parseEnvelope(body: unknown) { if (!body || typeof body !== "object") throw new AlocRequestError(200, "validation_error", "ALOC response envelope is invalid"); const value = body as Record<string, unknown>; if (!Array.isArray(value.data)) throw new AlocRequestError(200, "validation_error", "ALOC response data is invalid"); const pagination = AlocPaginationSchema.safeParse(value.pagination); const meta = AlocMetaSchema.safeParse(value.meta); if (!pagination.success || !meta.success) throw new AlocRequestError(200, "validation_error", "ALOC response envelope is invalid"); return { data: value.data, pagination: pagination.data, meta: meta.data }; }
async function requestWithRetries(key: DiscoveredKey, input: Input) { let last: any = null; for (let attempt = 1; attempt <= 2; attempt++) { try { const result = await request(key, input); last = { ...result, attempts: attempt }; if (result.status < 500 || attempt === 2) return last; } catch (error) { if (attempt === 3) throw new AlocTransientError("ALOC service temporarily unavailable", { attempts: attempt, snippet: error instanceof Error ? `${error.name} ${error.name === "AbortError" ? "timeout" : "fetch failed"}` : "fetch failed", host: getServerEnv().ALOC_BASE_URL }); } await sleep(2 ** (attempt - 1) * 500 + Math.floor(Math.random() * 100)); } throw new AlocTransientError(); }
async function request(key: DiscoveredKey, input: Input) { const env = getServerEnv(); const params = new URLSearchParams(); Object.entries(input).forEach(([k, v]) => v !== undefined && params.set(k, String(v))); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 25000); try { const response = await fetch(`${env.ALOC_BASE_URL}/questions?${params}`, { headers: { "X-API-Key": key.secret, Accept: "application/json", "User-Agent": "PastQBank/1.0" }, signal: controller.signal }); let body: any = null; try { body = await response.json(); } catch {} return { ok: response.ok, status: response.status, body, headers: response.headers }; } finally { clearTimeout(timer); } }
function diagnostics(result: { status: number; body: any }, key: DiscoveredKey, attempts: number) { return { httpStatus: result.status, alocError: result.body?.error ?? null, attempts, host: getServerEnv().ALOC_BASE_URL, snippet: redact(JSON.stringify(result.body ?? "")) }; }
function applyRateLimitCooling(result: { headers: Headers }, key: DiscoveredKey) { const remaining = Number(result.headers.get("x-ratelimit-remaining")); const reset = result.headers.get("x-ratelimit-reset"); if ((remaining === 0 || remaining === 1) && reset) coolKey(key, Math.max(0, Number(reset) - Math.floor(Date.now() / 1000))); }
async function nextKey(tried: Set<string>) { const key = await selectKey(); if (tried.has(key.envVarName)) throw new AllKeysUnavailableError("all other ALOC keys are unavailable"); return key; }
function emptyResult(keyLabel: string) { const pagination: AlocPagination = { nextCursor: null, prevCursor: null, hasMore: false }; return { questions: [] as AlocQuestion[], invalid: [], pagination, creditsUsed: 1, creditsRemainingBefore: null, creditsRemainingAfter: null, creditsRemaining: null, attempts: 1, keyLabel, empty: true, requestId: "" }; }
