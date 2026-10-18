import { test, expect } from "vitest";
import { buildPlan, estimateCredits, pageCost, planSummary, inCoverage, parseYearCatalog, type CatalogEntry } from "./planner";
const cat: CatalogEntry[] = [
  { subject: "mathematics", year: 2025, exam: "jamb", count: 40 }, { subject: "physics", year: 2025, exam: "jamb", count: 40 },
  { subject: "mathematics", year: 2024, exam: "waec", count: 30 }, { subject: "english-language", year: 2000, exam: "jamb", count: 98 },
  { subject: "biology", year: 2013, exam: "post_utme", count: 20 }, { subject: "biology", year: 2014, exam: "post_utme", count: 20 },
  { subject: "chemistry", year: 2014, exam: "neco", count: 50 }, { subject: "chemistry", year: 2020, exam: "neco", count: 50 }, { subject: "art", year: 2010, exam: "jamb", count: 0 },
];
test("page cost tiers", () => { expect(pageCost(1)).toBe(1); expect(pageCost(6)).toBe(1); expect(pageCost(7)).toBe(3); expect(pageCost(11)).toBe(3); expect(pageCost(12)).toBe(10); });
test("estimate credits", () => { expect(estimateCredits(90)).toBe(6); expect(estimateCredits(200)).toBe(51); });
test("subject split", () => { expect(5 * estimateCredits(40)).toBe(15); expect(estimateCredits(200)).toBe(51); });
test("coverage windows", () => { expect(inCoverage("waec", 2024)).toBe(false); expect(inCoverage("waec", 2021)).toBe(true); expect(inCoverage("neco", 2020)).toBe(false); expect(inCoverage("post_utme", 2013)).toBe(true); expect(inCoverage("jamb", 2025)).toBe(true); });
test("plan ordering and filtering", () => { expect(buildPlan(cat, () => 0, { startYear: 2025, endYear: 1990 }).map((u) => `${u.year}-${u.exam}-${u.subject}`)).toEqual(["2025-jamb-mathematics", "2025-jamb-physics", "2014-neco-chemistry", "2013-post_utme-biology", "2000-jamb-english-language"]); });
test("complete units skipped", () => { const plan = buildPlan(cat, (e, y) => y === 2025 ? 40 : 0, { startYear: 2025, endYear: 2000 }); const s = planSummary(plan); expect(plan.filter((u) => u.year === 2025).every((u) => !u.needed)).toBe(true); expect(s.skippedUnits).toBe(2); expect(s.neededUnits).toBe(3); });
test("partial unit needed", () => { expect(buildPlan(cat, () => 10, { startYear: 2025, endYear: 2025 })[0].needed).toBe(true); });
test("year and exam filter", () => { const plan = buildPlan(cat, () => 0, { startYear: 2013, endYear: 2013, exams: ["post_utme"] }); expect(plan).toHaveLength(1); expect(plan[0].subject).toBe("biology"); });
test("summary", () => { const s = planSummary(buildPlan(cat, () => 0, { startYear: 2025, endYear: 2025 })); expect(s.neededUnits).toBe(2); expect(s.expectedQuestions).toBe(80); expect(s.estimatedCredits).toBe(6); });
test("parse breakdown", () => { expect(parseYearCatalog({ data: [{ subject: "physics", questionCount: 40, byExam: { jamb: 40 } }] }, 2025)).toEqual([{ subject: "physics", year: 2025, exam: "jamb", count: 40 }]); });
test("parse flat rows", () => { const out = parseYearCatalog([{ slug: "chemistry", count: 40 }, { nothing: true }], 2025); expect(out).toHaveLength(1); expect(out[0].exam).toBe("jamb"); });
