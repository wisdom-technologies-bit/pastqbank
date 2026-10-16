const SECRET_PATTERN = /aloc_[A-Za-z0-9]+|ALOC-[A-Za-z0-9]+|alc_live_[A-Za-z0-9]+/g;
export type AlocDiagnostics = { httpStatus: number | null; alocError: string | null; attempts: number; host: string; snippet: string };
function safeSnippet(value: string) { return value.slice(0, 200).replace(SECRET_PATTERN, "[redacted]"); }
function safeHost(value: string) { try { return new URL(value).hostname; } catch { return value.replace(/[^a-zA-Z0-9.-]/g, ""); } }
function diagnostics(d: Partial<AlocDiagnostics>, defaults: AlocDiagnostics): AlocDiagnostics { return { ...defaults, ...d, alocError: d.alocError == null ? defaults.alocError : safeSnippet(String(d.alocError)), host: safeHost(d.host ?? defaults.host), snippet: safeSnippet(d.snippet ?? defaults.snippet) }; }
export class AlocRequestError extends Error {
  readonly httpStatus!: number | null; readonly alocError!: string | null; readonly attempts!: number; readonly host!: string; readonly snippet!: string;
  constructor(public status: number, public code: string, message: string, d: Partial<AlocDiagnostics> = {}) { super(`ALOC request failed (${status}, ${code}): ${message}`); this.name = "AlocRequestError"; Object.assign(this, diagnostics(d, { httpStatus: status, alocError: code || null, attempts: 1, host: "", snippet: message })); }
}
export class AlocRateLimitedError extends Error {
  readonly httpStatus!: number | null; readonly alocError!: string | null; readonly attempts!: number; readonly host!: string; readonly snippet!: string;
  constructor(public retryAfterSeconds: number, d: Partial<AlocDiagnostics> = {}) { super(`ALOC rate limited; retry after ${retryAfterSeconds} seconds`); this.name = "AlocRateLimitedError"; Object.assign(this, diagnostics(d, { httpStatus: 429, alocError: "rate_limited", attempts: 1, host: "", snippet: "" })); }
}
export class AlocTransientError extends Error {
  readonly httpStatus!: number | null; readonly alocError!: string | null; readonly attempts!: number; readonly host!: string; readonly snippet!: string;
  constructor(message = "ALOC service temporarily unavailable", d: Partial<AlocDiagnostics> = {}) { super(message); this.name = "AlocTransientError"; Object.assign(this, diagnostics(d, { httpStatus: null, alocError: null, attempts: 3, host: "", snippet: message })); }
}
export class AllKeysUnavailableError extends Error { constructor(message: string) { super(message); this.name = "AllKeysUnavailableError"; } }
