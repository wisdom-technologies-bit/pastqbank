import { getAdminSupabaseClient } from '@/lib/supabase/admin'

export async function check_rate_limit(_key: string, _limit = 120) { return true }

export async function markAnswers(sessionId: string, answers: Array<{ ref: string; choice: string | null; flagged?: boolean }>, mode: string, feedback: string) {
  const db = getAdminSupabaseClient()
  const { data: refs } = await db.from('exam_session_questions').select('id,question_id').eq('session_id', sessionId).in('id', answers.map((a) => a.ref))
  const ids = new Map((refs ?? []).map((r: any) => [r.id, r.question_id]))
  const { data: questions } = await db.from('questions').select('id,correct_option,correct_choice').in('id', [...ids.values()])
  const correct = new Map((questions ?? []).map((q: any) => [q.id, q.correct_option ?? q.correct_choice]))
  const output: any[] = []
  for (const answer of answers) {
    const questionId = ids.get(answer.ref)
    if (!questionId) throw new Error('invalid_question_ref')
    const { data: existing } = await db.from('exam_session_answers').select('selected_option').eq('session_id', sessionId).eq('question_id', questionId).maybeSingle()
    if (mode !== 'cbt' && existing?.selected_option !== null && existing?.selected_option !== undefined) throw new Error('already_answered')
    const payload = { session_id: sessionId, question_id: questionId, selected_option: answer.choice, is_correct: answer.choice !== null && answer.choice === correct.get(questionId), is_flagged: Boolean(answer.flagged), answered_at: answer.choice === null ? null : new Date().toISOString(), updated_at: new Date().toISOString() }
    const { error } = await db.from('exam_session_answers').upsert(payload, { onConflict: 'session_id,question_id' })
    if (error) throw error
    if (mode !== 'cbt' && feedback !== 'end') output.push({ ref: answer.ref, is_correct: answer.choice !== null && answer.choice === correct.get(questionId), correct_choice: correct.get(questionId) ?? null })
  }
  return output
}
