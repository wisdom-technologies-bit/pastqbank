import { requiredCount, subjectQualifies, type CatalogProfile, type CatalogSettings } from './rules'

/** The slice of a catalog context the donor search needs. */
export interface DonorCatalog {
  catalog: Array<{ exam_year: number | string; subject_slug: string; published_count: number | string }>
  years: number[]
  profile: CatalogProfile
  settings: CatalogSettings
}

/** Published question count per subject slug for one year. */
export function subjectCounts(c: DonorCatalog, year: number) {
  const counts = new Map<string, number>()
  for (const row of c.catalog) if (Number(row.exam_year) === year) counts.set(row.subject_slug, Number(row.published_count))
  return counts
}

/** True when the profile has a compulsory subject that the year has no questions for. */
export function compulsoryMissing(c: DonorCatalog, year: number) {
  const compulsory = c.profile.compulsory_subject_slug
  return Boolean(compulsory && !subjectCounts(c, year).has(compulsory))
}

/**
 * The nearest listable year (other than `year`, closest first) that has enough
 * questions for `subject` to qualify. Returns null when no year can donate.
 */
export function donorYearFor(c: DonorCatalog, year: number, subject: string): number | null {
  const required = requiredCount(c.profile, subject)
  for (const candidate of c.years.filter((y) => y !== year).sort((a, b) => Math.abs(a - year) - Math.abs(b - year) || b - a)) {
    if (subjectQualifies(subjectCounts(c, candidate).get(subject) ?? 0, required, c.settings.qualify_ratio)) return candidate
  }
  return null
}
