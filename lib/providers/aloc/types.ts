import { z } from "zod";

export const AlocExamTypeSchema = z.enum(["waec", "neco", "jamb", "post_utme", "state"]);
export type AlocExamType = z.infer<typeof AlocExamTypeSchema>;

const nullableString = z.string().nullish();
const nullableNumber = z.number().nullish();
const nullableBoolean = z.boolean().nullish();

const provenanceSchema = z.object({
  contentSource: nullableString, licenseType: nullableString, isLicensed: nullableBoolean,
  validationScore: nullableNumber, generatorVersion: nullableString, batchRequestId: nullableString,
  reviewStatus: nullableString, curriculumMapping: nullableString, isGapFill: nullableBoolean,
}).passthrough().nullish();
const metadataSchema = z.object({
  topic: nullableString, subtopic: nullableString, difficultyScore: nullableNumber,
  estimatedTime: nullableNumber, tags: z.array(z.string()).nullish(), learningObjectives: z.array(z.string()).nullish(),
  curriculumAlignment: nullableString, classificationConfidence: nullableNumber, needsReview: nullableBoolean,
}).passthrough().nullish();
const optionsSchema = z.record(z.string(), z.string()).nullish();

export const AlocQuestionSchema = z.object({
  id: z.string(), text: z.string(), options: optionsSchema, correctAnswer: nullableString,
  examType: AlocExamTypeSchema.nullish(), subject: nullableString, year: z.number().int().nullish(),
  educationLevel: nullableString, classLevel: nullableString, section: nullableString, imageUrl: nullableString,
  questionNumber: z.number().int().nullish(), country: nullableString, category: nullableString,
  institution: nullableString, state: nullableString, hasPassage: nullableBoolean,
  provenance: provenanceSchema, metadata: metadataSchema,
}).passthrough();
export const AlocPaginationSchema = z.object({ nextCursor: z.string().nullish(), prevCursor: z.string().nullish(), hasMore: z.boolean() }).passthrough();
export const AlocMetaSchema = z.object({ creditsUsed: z.number(), creditsRemaining: z.number(), tier: z.string().nullish(), requestId: z.string().nullish() }).passthrough();
export const AlocResponseSchema = z.object({ data: z.array(z.unknown()), pagination: AlocPaginationSchema, meta: AlocMetaSchema }).passthrough();
export type AlocQuestion = z.infer<typeof AlocQuestionSchema>;
export type AlocPagination = z.infer<typeof AlocPaginationSchema>;
export type AlocMeta = z.infer<typeof AlocMetaSchema>;
export type AlocResponse = z.infer<typeof AlocResponseSchema>;
