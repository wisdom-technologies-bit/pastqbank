import "server-only";

import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env/server";

export type HealthResult = {
  status: "ok" | "degraded";
  time: string;
  checks: {
    env: { ok: boolean; missing: string[] };
    database: { ok: boolean; latencyMs: number; error?: string };
  };
};

const requiredEnv = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "BANK_SERVICE_API_KEY"] as const;

export async function checkHealth(client = getAdminSupabaseClient()) : Promise<HealthResult> {
  const time = new Date().toISOString();
  let missing: string[] = [];
  try { getServerEnv(); } catch {
    missing = requiredEnv.filter((name) => !process.env[name]);
  }
  const started = performance.now();
  const { error } = await client.from("bank_admins").select("user_id", { count: "exact", head: true });
  const latencyMs = Math.round(performance.now() - started);
  const database = error ? { ok: false, latencyMs, error: "Database unavailable" } : { ok: true, latencyMs };
  return { status: missing.length || !database.ok ? "degraded" : "ok", time, checks: { env: { ok: missing.length === 0, missing }, database } };
}
