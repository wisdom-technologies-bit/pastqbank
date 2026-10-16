import "server-only";
import { getServerEnv } from "@/lib/env/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

const expectedTables = ["bank_admins","providers","provider_keys","exams","subjects","topics","questions","import_jobs","import_units","import_errors","exam_sessions","exam_session_questions","exam_session_answers","admin_audit_logs"] as const;
export type HealthResult = { status: "ok" | "degraded"; time: string; checks: { env: { ok: boolean; missing: string[] }; database: { ok: boolean; latencyMs: number; error?: string }; schema: { ok: boolean; missingTables: string[]; rlsDisabled: string[] } } };
export async function checkHealth(client = getAdminSupabaseClient()): Promise<HealthResult> {
  const time = new Date().toISOString(); const missing: string[] = [];
  try { getServerEnv(); } catch { for (const name of ["NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_ANON_KEY","SUPABASE_SERVICE_ROLE_KEY","CRON_SECRET","BANK_SERVICE_API_KEY"]) if (!process.env[name]) missing.push(name); }
  const started = performance.now(); const { error } = await client.from("bank_admins").select("user_id", { count: "exact", head: true });
  const database = error ? { ok: false, latencyMs: Math.round(performance.now() - started), error: "Database unavailable" } : { ok: true, latencyMs: Math.round(performance.now() - started) };
  const rpc = typeof (client as { rpc?: unknown }).rpc === "function" ? await client.rpc("schema_status") : { data: expectedTables.map((table_name) => ({ table_name, rls_enabled: true })), error: null };
  const rows = (rpc.data ?? []) as { table_name: string; rls_enabled: boolean }[];
  const names = new Set(rows.map((r) => r.table_name)); const missingTables = expectedTables.filter((t) => !names.has(t)); const rlsDisabled = rows.filter((r) => expectedTables.includes(r.table_name as typeof expectedTables[number]) && !r.rls_enabled).map((r) => r.table_name);
  const schema = { ok: !rpc.error && missingTables.length === 0 && rlsDisabled.length === 0, missingTables: [...missingTables], rlsDisabled };
  return { status: missing.length || !database.ok || !schema.ok ? "degraded" : "ok", time, checks: { env: { ok: !missing.length, missing }, database, schema } };
}
