import { requireAdmin } from "@/lib/auth/requireAdmin";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  return <AdminShell email={user.email ?? "Admin"}>{children}</AdminShell>;
}
