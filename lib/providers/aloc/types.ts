import { z } from "zod";

export const AlocExamTypeSchema = z.enum(["waec", "neco", "jamb", "post_utme", "state"]);
export type AlocExamType = z.infer<typeof AlocExamTypeSchema>;
const optionsSchema = z.record(z.string(), z.string()).optional();
const questionSchema = z.object({
  id: z.string().uuid(), text: z.string(), options: optionsSchema, correctAnswer: z.string().optional(),
  examType: AlocExamTypeSchema.optional(), subject: z.string().optional(), year: z.number().int().optional(),
  educationLevel: z.string().optional(), classLevel: z.string().optional(), section: z.string().nullable().optional(),
  imageUrl: z.string().url().optional(), questionNumber: z.number().int().optional(), country: z.string().optional(),
  category: z.string().optional(), institution: z.string().optional(), state: z.string().optional(), hasPassage: z.boolean().optional(),
  provenance: z.record(z.string(), z.unknown()).optional(), metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
export const AlocQuestionSchema = questionSchema;
export const AlocPaginationSchema = z.object({ nextCursor: z.string().nullable(), prevCursor: z.string().nullable(), hasMore: z.boolean() }).passthrough();
export const AlocMetaSchema = z.object({ creditsUsed: z.number(), creditsRemaining: z.number(), tier: z.string(), requestId: z.string() }).passthrough();
export const AlocResponseSchema = z.object({ data: z.array(questionSchema), pagination: AlocPaginationSchema, meta: AlocMetaSchema }).passthrough();
export type AlocQuestion = z.infer<typeof questionSchema>;
export type AlocPagination = z.infer<typeof AlocPaginationSchema>;
export type AlocMeta = z.infer<typeof AlocMetaSchema>;
export type AlocResponse = z.infer<typeof AlocResponseSchema>;
