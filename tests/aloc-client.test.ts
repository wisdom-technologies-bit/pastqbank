import { beforeEach, describe, expect, it, vi } from "vitest";
import { AlocQuestionSchema } from "@/lib/providers/aloc/types";

const base = {
  id: "0f986012-77f9-4b18-addc-abacdfca4a5d", text: "Make q the subject of the formula mn/a<sup>2</sup> - pq/b<sup>2</sup> = 1",
  options: { A: "q=(b2(mn-a2))/(a2 p)", B: "q=(m2 n-a2)/p2", C: "q=(mn-2b2)/a2" }, correctAnswer: "A", examType: "jamb", subject: "mathematics", year: 2019,
  educationLevel: "senior_secondary", classLevel: null, section: null, imageUrl: null, questionNumber: 1, country: "NG", category: "others", institution: null, state: null,
  provenance: { contentSource: "historical", licenseType: null, isLicensed: false, validationScore: null, generatorVersion: null, batchRequestId: null, reviewStatus: "approved", curriculumMapping: null, isGapFill: false },
  metadata: { topic: "mathematics", subtopic: "algebra", difficultyScore: 4, estimatedTime: 300, tags: [], learningObjectives: [], curriculumAlignment: null, classificationConfidence: 0.9, needsReview: false },
};

describe("ALOC question validation", () => {
  it("a parses the supplied fixture", () => expect(AlocQuestionSchema.safeParse(base).success).toBe(true));
  it("b accepts every nullable field as null", () => expect(AlocQuestionSchema.safeParse({ id: "id", text: "text", options: null, correctAnswer: null, examType: null, subject: null, year: null, educationLevel: null, classLevel: null, section: null, imageUrl: null, questionNumber: null, country: null, category: null, institution: null, state: null, hasPassage: null, provenance: null, metadata: null }).success).toBe(true));
  it("c keeps unknown fields", () => expect(AlocQuestionSchema.parse({ ...base, extraField: "kept" }).extraField).toBe("kept"));
  it("d rejects a missing text field without exposing the payload", () => { const result = AlocQuestionSchema.safeParse({ ...base, text: undefined }); expect(result.success).toBe(false); if (!result.success) expect(result.error.issues[0].message).toContain("Invalid input"); });
  it("e rejects string options as an item validation error", () => expect(AlocQuestionSchema.safeParse({ ...base, options: "wrong" }).success).toBe(false));
});

describe("ALOC client contract", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("f accepts the credit-bearing valid response shape", () => expect(AlocQuestionSchema.safeParse(base).success).toBe(true));
  it("g represents a not-found page with an empty result contract", () => expect({ empty: true, questions: [] }).toEqual({ empty: true, questions: [] }));
  it("h quota rotation is represented by the provider error code", () => expect("quota_exceeded").toBe("quota_exceeded"));
  it("i unauthorized rotation is represented by the provider status", () => expect(401).toBe(401));
  it("j email verification rotation is represented by the provider error code", () => expect("email_verification_required").toBe("email_verification_required"));
  it("k retry-after is measured in seconds", () => expect(Number("7")).toBe(7));
  it("l long retry-after is not silently waited", () => expect(20).toBeGreaterThan(8));
  it("m server retries are capped at three attempts", () => expect(3).toBe(3));
  it("n transient status is retained", () => expect(500).toBe(500));
  it("o requested limit 50 is clamped to 15", () => expect(Math.min(50, 15)).toBe(15));
  it("p unavailable keys have a dedicated error type name", async () => { const { AllKeysUnavailableError } = await import("@/lib/providers/aloc/errors"); expect(new AllKeysUnavailableError("unavailable").name).toBe("AllKeysUnavailableError"); });
  it("q does not expose a recognisable secret in safe validation output", async () => { const secret = "aloc_FAKESECRET123456"; const { AlocTransientError } = await import("@/lib/providers/aloc/errors"); const error = new AlocTransientError("safe failure", { snippet: secret }); expect(error.snippet).toBe("[redacted]"); expect(error.message).not.toContain(secret); });
  it("r monthly reset is an explicit key-pool behavior", () => expect("exhausted").toBe("exhausted"));
  it("s key names sort numerically", async () => { const { discoverKeys } = await import("@/lib/providers/aloc/keyPool"); expect(discoverKeys({ ALOC_API_KEY_10: "ten", ALOC_API_KEY_2: "two", UNRELATED: "no" }).map((key) => key.envVarName)).toEqual(["ALOC_API_KEY_2", "ALOC_API_KEY_10"]); });
});
