import { getAdminSupabaseClient } from '@/lib/supabase/admin'
import { normalizeChoice, questionContent } from '@/lib/sessions/present'

export async function check_rate_limit(_key: string, _limit = 120) { return true }

export async function markAnswers(sessionId: string, answers: Array<{ ref: string; choice: string | null; flagged?: boolean }>, mode: string, feedback: string) {
  const db = getAdminSupabaseClient()
  const { data: refs } = await db.from('exam_session_questions').select('id,question_id').eq('session_id', sessionId).in('id', answers.map((a) => a.ref))
  const ids = new Map((refs ?? []).map((r: any) => [r.id, r.question_id]))
  const { data: questions } = await db.from('questions').select('*').in('id', [...ids.values()])
  const questionMap = new Map((questions ?? []).map((q: any) => [q.id, q]))
  const output: any[] = []
  for (const answer of answers) {
    const questionId = ids.get(answer.ref)
    if (!questionId) throw new Error('invalid_question_ref')
    const q = questionMap.get(questionId)
    const correct = questionContent(q).correctChoice
    const flagOnly = !Object.prototype.hasOwnProperty.call(answer, 'choice')
    if (flagOnly) {
      const { error } = await db.from('exam_session_answers').upsert({ session_id: sessionId, question_id: questionId, is_flagged: Boolean(answer.flagged), updated_at: new Date().toISOString() }, { onConflict: 'session_id,question_id' })
      if (error) throw error
      continue
    }
    const choice = answer.choice === null ? null : normalizeChoice(answer.choice, q?.options ?? q?.raw_payload?.options)
    const { data: existing } = await db.from('exam_session_answers').select('selected_option').eq('session_id', sessionId).eq('question_id', questionId).maybeSingle()
    if (mode !== 'cbt' && existing?.selected_option !== null && existing?.selected_option !== undefined) throw new Error('already_answered')
    const isCorrect = choice !== null && correct !== null && choice === correct
    const payload = { session_id: sessionId, question_id: questionId, selected_option: choice, is_correct: isCorrect, is_flagged: Boolean(answer.flagged), answered_at: choice === null ? null : new Date().toISOString(), updated_at: new Date().toISOString() }
    const { error } = await db.from('exam_session_answers').upsert(payload, { onConflict: 'session_id,question_id' })
    if (error) throw error
    if (mode !== 'cbt' && feedback !== 'end') output.push({ ref: answer.ref, is_correct: isCorrect, correct_choice: correct })
  }
  return output
}
