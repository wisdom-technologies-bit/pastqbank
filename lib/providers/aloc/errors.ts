export class AlocRequestError extends Error { constructor(public status: number, public code: string, message: string) { super(`ALOC request failed (${status}, ${code}): ${message}`); this.name = "AlocRequestError"; } }
export class AlocRateLimitedError extends Error { constructor(public retryAfterSeconds: number) { super(`ALOC rate limited; retry after ${retryAfterSeconds} seconds`); this.name = "AlocRateLimitedError"; } }
export class AlocTransientError extends Error { constructor(message = "ALOC service temporarily unavailable") { super(message); this.name = "AlocTransientError"; } }
export class AllKeysUnavailableError extends Error { constructor(message: string) { super(message); this.name = "AllKeysUnavailableError"; } }
