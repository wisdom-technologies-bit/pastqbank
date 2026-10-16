import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { fetchQuestions } from "@/lib/providers/aloc/client";
import type { AlocDiagnostics } from "@/lib/providers/aloc/errors";

export const maxDuration = 60;

export async function POST() {
  try {
    await requireAdmin();
    const result = await fetchQuestions({ examType: "jamb", year: 2019, limit: 1 });
    const first = result.questions[0];
    return NextResponse.json({ ok: true, keyLabel: result.keyLabel, creditsRemaining: result.creditsRemaining, creditsUsed: result.creditsUsed, questionCount: result.questions.length, firstQuestionId: first?.id ?? null, optionKeys: first?.options ? Object.keys(first.options) : [], hasCorrectAnswer: Boolean(first?.correctAnswer), requestId: result.requestId });
  } catch (error) {
    const diagnostics = error as Partial<AlocDiagnostics>;
    const safe = { httpStatus: diagnostics.httpStatus ?? null, alocError: diagnostics.alocError ?? null, attempts: diagnostics.attempts ?? 0, host: diagnostics.host ?? "", snippet: diagnostics.snippet ?? (error instanceof Error ? error.name : "ALOC test failed") };
    const payload = { ok: false, error: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : "ALOC test failed", ...safe };
    console.error(JSON.stringify(payload));
    return NextResponse.json(payload, { status: payload.message.includes("not authorized") ? 403 : 500 });
  }
}
