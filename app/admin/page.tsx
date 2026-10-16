import { HealthCards } from "@/components/admin/health-cards";
import { checkHealth } from "@/lib/health/checkHealth";

export default async function AdminOverview() { return <section className="mx-auto flex max-w-5xl flex-col gap-8"><div><p className="text-sm font-medium text-primary">Overview</p><h1 className="mt-1 text-3xl font-bold tracking-tight">System health</h1><p className="mt-2 text-muted-foreground">A live view of the PastQ Bank foundation.</p></div><HealthCards initialHealth={await checkHealth()} /></section>; }
