import "server-only";
import { getServerEnv } from "@/lib/env/server";
import { markKeyExhausted, markKeyInvalid, selectKey, type DiscoveredKey } from "./keyPool";
import { parseYearCatalog } from "@/lib/imports/planner";

async function request(key: DiscoveredKey, year: number) {
  const response = await fetch(`${getServerEnv().ALOC_BASE_URL}/subjects/years/${year}`, { headers: { "X-API-Key": key.secret, Accept: "application/json", "User-Agent": "PastQBank/1.0" } });
  let body: unknown = null; try { body = await response.json(); } catch {}
  return { response, body };
}
export async function fetchYearCatalog(year: number) {
  const tried = new Set<string>();
  for (;;) {
    const key = await selectKey(); tried.add(key.envVarName);
    const { response, body } = await request(key, year);
    if (response.status === 401) { await markKeyInvalid(key, "unauthorized key"); continue; }
    if (response.status === 403) { await markKeyExhausted(key, "catalog request rejected"); continue; }
    if (response.status === 404) return [];
    if (!response.ok) throw new Error(`ALOC catalog request failed (${response.status})`);
    return parseYearCatalog(body, year);
  }
}
