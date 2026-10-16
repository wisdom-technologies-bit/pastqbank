import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { discoverKeys, maskKey } from "@/lib/providers/aloc/keyPool";
import { syncAlocKeys, resetAlocKey } from "./actions";
import { KeysClient } from "@/components/admin/keys-client";
export default async function KeysPage() { await requireAdmin(); const db = getAdminSupabaseClient(); const provider = await db.from("providers").select("id").eq("code", "aloc").maybeSingle(); const { data: rows } = provider.data ? await db.from("provider_keys").select("*").eq("provider_id", provider.data.id).order("env_var_name") : { data: [] }; const envKeys = new Map(discoverKeys().map(key => [key.envVarName, maskKey(key.secret)])); const keys = (rows ?? []).map(row => ({ ...row, masked: envKeys.get(row.env_var_name) ?? "not set" })); return <KeysClient keys={keys} onSync={syncAlocKeys} onReset={resetAlocKey} />; }
