import { catalogContext, envelope } from '@/lib/catalog/service'
import { error, guard, json } from '@/lib/catalog/http'
export async function GET(request: Request, { params }: { params: Promise<{ exam: string }> }) {
  const denied = guard(request); if (denied) return denied
  const c = await catalogContext((await params).exam); if (!c) return error('not_found', 'Unknown exam', 404)
  const data = c.years.map((year) => {
    const rows = c.catalog.filter((x) => Number(x.exam_year) === year)
    const cbt = c.cbt(year)
    return { year, published_count: c.totals.get(year) ?? 0, subject_count: new Set(rows.map((x) => x.subject_slug)).size, access: c.free.has(year) ? 'free' : 'premium', practice_ready: true, cbt: { ...cbt, missingCompulsory: (cbt as any).missingCompulsory ?? null } }
  })
  return json(envelope(data))
}
