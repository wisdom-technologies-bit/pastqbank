import { z } from "zod";

export const examTypes = ["jamb", "waec", "neco", "post_utme", "state"] as const;
export const ImportScopeSchema = z.object({ mode: z.enum(["year", "range"]), startYear: z.number().int().min(1980).max(2100), endYear: z.number().int().min(1980).max(2100), examTypes: z.array(z.enum(examTypes)).min(1), maxCredits: z.number().int().positive().optional() }).superRefine((value, ctx) => { if (value.startYear < value.endYear) ctx.addIssue({ code: "custom", message: "startYear must be greater than or equal to endYear", path: ["startYear"] }); if (value.mode === "year" && value.startYear !== value.endYear) ctx.addIssue({ code: "custom", message: "year mode requires equal years", path: ["endYear"] }); });
export type ImportScope = z.infer<typeof ImportScopeSchema>;
export function buildUnits(scope: ImportScope) { const selected = new Set(scope.examTypes); return Array.from({ length: scope.startYear - scope.endYear + 1 }, (_, i) => scope.startYear - i).flatMap((year) => examTypes.filter((exam) => selected.has(exam)).map((exam_slug) => ({ exam_slug, exam_year: year }))); }
export function estimateWork(scope: ImportScope) { const units = buildUnits(scope).length; return { units, minCredits: units, note: "Each page of 15 questions costs 1 credit; empty exam-years cost 1 credit to discover." }; }
