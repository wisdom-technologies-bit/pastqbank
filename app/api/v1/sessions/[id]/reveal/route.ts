import { guard, json } from '@/lib/catalog/http'
import { owner, sessionSummary, bad } from '@/lib/sessions/api'
import { check_rate_limit } from '@/lib/sessions/mark'
import { questionContent } from '@/lib/sessions/present'
import { getAdminSupabaseClient } from '@/lib/supabase/admin'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(request); if (denied) return denied
  const id = (await params).id, s = await sessionSummary(id)
  if (!s || !owner(request, s.user_ref)) return bad('not_found', 'Session not found', 404)
  if (!(await check_rate_limit(`reveal:${s.user_ref}`, 120))) return bad('rate_limited', 'Too many requests', 429)
  if (s.status !== 'in_progress' || s.mode !== 'practice' || s.feedback_mode !== 'instant') return bad('reveal_not_allowed', 'Reveal is only available in instant-feedback practice sessions', 409)
  const body = await request.json().catch(() => null), ref = body?.ref
  if (typeof ref !== 'string' || !s.outline.some((q: any) => q.ref === ref)) return bad('invalid_question_ref', 'Question is not in this session', 422)
  const db = getAdminSupabaseClient()
  const { data: sessionQuestion, error: questionError } = await db.from('exam_session_questions').select('question_id').eq('session_id', id).eq('id', ref).maybeSingle()
  if (questionError || !sessionQuestion) return bad('invalid_question_ref', 'Question is not in this session', 422)
  const questionId = sessionQuestion.question_id
  const [{ data: q }, { data: existing }] = await Promise.all([
    db.from('questions').select('*').eq('id', questionId).maybeSingle(),
    db.from('exam_session_answers').select('selected_option,is_correct,is_flagged,revealed_at').eq('session_id', id).eq('question_id', questionId).maybeSingle(),
  ])
  if (!q) return bad('not_found', 'Question not found', 404)
  const content = questionContent(q)
  if (existing && existing.selected_option !== null && existing.selected_option !== undefined) {
    return json({ data: { ref, correct_choice: content.correctChoice, explanation: q.explanation || null, is_correct: Boolean(existing.is_correct), revealed: false }, meta: { generatedAt: new Date().toISOString() } })
  }
  const now = new Date().toISOString()
  const { error } = await db.from('exam_session_answers').upsert({ session_id: id, question_id: questionId, selected_option: null, is_correct: false, is_flagged: Boolean(existing?.is_flagged), answered_at: null, revealed_at: now, updated_at: now }, { onConflict: 'session_id,question_id' })
  if (error) {
    console.error('[reveal] unable to save reveal', { sessionId: id, userRef: s.user_ref, questionRef: ref, error })
    return bad('reveal_failed', 'Unable to reveal answer', 500)
  }
  return json({ data: { ref, correct_choice: content.correctChoice, explanation: q.explanation || null, revealed: true }, meta: { generatedAt: new Date().toISOString() } })
}
