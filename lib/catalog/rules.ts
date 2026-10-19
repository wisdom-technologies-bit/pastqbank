export interface CatalogSettings { free_year_count: number; min_questions_for_listing: number; min_questions_for_practice: number; qualify_ratio: number }
export interface CatalogProfile { subjects_required: number; compulsory_subject_slug: string | null; default_question_count: number; default_minutes: number; overrides?: Map<string, { question_count: number; minutes: number | null }> }
export function listableYear(totalPublished: number, settings: CatalogSettings) { return totalPublished >= settings.min_questions_for_listing }
export function freeYears(listableYearsDescending: number[], settings: CatalogSettings) { return listableYearsDescending.slice(0, settings.free_year_count) }
export function requiredCount(profile: CatalogProfile, subjectSlug: string) { return profile.overrides?.get(subjectSlug)?.question_count ?? profile.default_question_count }
export function subjectQualifies(publishedCount: number, required: number, ratio: number) { return publishedCount >= Math.ceil(required * ratio) }
export function cbtEligibility(profile: CatalogProfile, subjectCountsForYear: Map<string, number>, settings: CatalogSettings) {
  const qualifyingSubjects = [...subjectCountsForYear.entries()].filter(([slug, count]) => subjectQualifies(count, requiredCount(profile, slug), settings.qualify_ratio)).map(([slug]) => slug)
  if (profile.compulsory_subject_slug) {
    const count = subjectCountsForYear.get(profile.compulsory_subject_slug) ?? 0
    const needed = Math.ceil(requiredCount(profile, profile.compulsory_subject_slug) * settings.qualify_ratio)
    if (count < needed) return { eligible: false, qualifyingSubjects, reason: `${profile.compulsory_subject_slug === 'english-language' ? 'English Language' : profile.compulsory_subject_slug} has ${count} questions, ${needed} needed` }
  }
  const eligible = qualifyingSubjects.length >= profile.subjects_required
  return { eligible, qualifyingSubjects, reason: eligible ? undefined : `${qualifyingSubjects.length} qualifying subjects, ${profile.subjects_required} needed` }
}
