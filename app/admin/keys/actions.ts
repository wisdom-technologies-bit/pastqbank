"use server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { syncKeysToDatabase } from "@/lib/providers/aloc/keyPool";
export async function syncAlocKeys() { const admin = await requireAdmin(); await syncKeysToDatabase(); await audit(admin.id, "sync_provider_keys", null, {}); }
export async function resetAlocKey(id: string) { const admin = await requireAdmin(); const db = getAdminSupabaseClient(); await db.from("provider_keys").update({ status: "active", last_error: null, exhausted_at: null }).eq("id", id).eq("provider_id", (await db.from("providers").select("id").eq("code", "aloc").single()).data?.id); await audit(admin.id, "reset_provider_key", id, {}); }
async function audit(adminId: string, action: string, entityId: string | null, details: Record<string, unknown>) { await getAdminSupabaseClient().from("admin_audit_logs").insert({ admin_user_id: adminId, action, entity: "provider_key", entity_id: entityId, details }); }
