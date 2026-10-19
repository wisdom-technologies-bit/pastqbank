import { getAdminSupabaseClient } from '@/lib/supabase/admin'
import { cbtEligibility, listableYear, type CatalogProfile, type CatalogSettings, requiredCount, subjectQualifies } from './rules'
const canonical = (slug: string) => slug === 'post_utme' ? 'post-utme' : slug
export async function catalogContext(examParam: string) {
  const examSlug = canonical(examParam), db = getAdminSupabaseClient()
  const [{ data: exam }, { data: profile }, { data: overrides }, { data: settingsRows }, { data: rows }] = await Promise.all([
    db.from('exams').select('slug,name').eq('slug', examSlug).maybeSingle(), db.from('exam_profiles').select('*').eq('exam_slug', examSlug).maybeSingle(), db.from('exam_profile_subjects').select('subject_slug,question_count,minutes').eq('profile_id', (await db.from('exam_profiles').select('id').eq('exam_slug', examSlug).maybeSingle()).data?.id ?? ''), db.from('bank_settings').select('key,value'), db.from('v_catalog').select('*').eq('exam_slug', examSlug)
  ])
  if (!exam || !profile) return null
  const settings = Object.fromEntries((settingsRows ?? []).map((r) => [r.key, Number(r.value)])) as CatalogSettings
  const catalog = rows ?? [], years = [...new Set(catalog.map((r) => Number(r.exam_year)))].sort((a,b) => b-a)
  const totals = new Map<number, number>(); for (const r of catalog) totals.set(Number(r.exam_year), (totals.get(Number(r.exam_year)) ?? 0) + Number(r.published_count))
  const listable = years.filter((y) => listableYear(totals.get(y) ?? 0, settings)), free = new Set(listable.slice(0, settings.free_year_count))
  const p: CatalogProfile = { ...profile, overrides: new Map((overrides ?? []).map((o) => [o.subject_slug, o])) }
  return { db, exam, profile: p, rawProfile: profile, overrides: overrides ?? [], settings, catalog, years: listable, totals, free, cbt: (year: number) => cbtEligibility(p, new Map(catalog.filter((r) => Number(r.exam_year) === year).map((r) => [r.subject_slug, Number(r.published_count)])), settings), requiredCount, subjectQualifies }
}
export const envelope = (data: unknown) => ({ data, meta: { generatedAt: new Date().toISOString() } })
