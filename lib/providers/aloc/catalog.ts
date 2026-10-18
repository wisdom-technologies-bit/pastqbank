import "server-only";
import { getServerEnv } from "@/lib/env/server";
import { AlocRateLimitedError } from "./errors";
import { coolKey, markKeyExhausted, markKeyInvalid, selectKey, type DiscoveredKey } from "./keyPool";
import { parseYearCatalog } from "@/lib/imports/planner";

async function request(key: DiscoveredKey, year: number) {
  const response = await fetch(`${getServerEnv().ALOC_BASE_URL}/subjects/years/${year}`, { headers: { "X-API-Key": key.secret, Accept: "application/json", "User-Agent": "PastQBank/1.0" } });
  let body: unknown = null; try { body = await response.json(); } catch {}
  return { response, body };
}
export async function fetchYearCatalog(year: number) {
  const tried = new Set<string>();
  for (;;) {
    const key = await selectKey();
    tried.add(key.envVarName);
    const { response, body } = await request(key, year);
    if (response.status === 401) { await markKeyInvalid(key, "unauthorized key"); continue; }
    if (response.status === 403) { await markKeyExhausted(key, "catalog request rejected"); continue; }
    if (response.status === 404) return [];
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? 20);
      coolKey(key, Number.isFinite(retryAfter) ? retryAfter : 20);
      try {
        const next = await selectKey();
        if (!tried.has(next.envVarName)) continue;
      } catch {}
      throw new AlocRateLimitedError(Number.isFinite(retryAfter) ? retryAfter : 20, {
        httpStatus: 429,
        alocError: "rate_limited",
        attempts: 1,
        host: getServerEnv().ALOC_BASE_URL,
        snippet: "catalog request rate limited",
      });
    }
    if (!response.ok) throw new Error(`ALOC catalog request failed (${response.status})`);
    return parseYearCatalog(body, year);
  }
}
