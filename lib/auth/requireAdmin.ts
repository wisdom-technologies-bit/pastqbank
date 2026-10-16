import "server-only";

import { redirect } from "next/navigation";
import { adminSupabase } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function requireAdmin() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: admin, error } = await adminSupabase
    .from("bank_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !admin) {
    await supabase.auth.signOut();
    redirect("/login?error=not-admin");
  }
  return user;
}
