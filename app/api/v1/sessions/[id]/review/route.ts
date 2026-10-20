import { guard, json } from '@/lib/catalog/http'
import { owner, sessionSummary, bad } from '@/lib/sessions/api'
import { getAdminSupabaseClient } from '@/lib/supabase/admin'
import { passageFor } from '@/lib/sessions/present'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(request); if (denied) return denied
  const id = (await params).id, session = await sessionSummary(id)
  if (!session || !owner(request, session.user_ref)) return bad('not_found', 'Session not found', 404)
  if (session.status !== 'submitted' && session.status !== 'expired') return bad('not_submitted', 'Session has not been submitted', 409)
  const url = new URL(request.url), from = Math.max(1, Number(url.searchParams.get('from') || 1)), limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit') || 30))), db = getAdminSupabaseClient()
  const { data: rows } = await db.from('exam_session_questions').select('id,position,question_id,subject_slug').eq('session_id', id).gte('position', from).order('position').limit(limit)
  const ids = (rows ?? []).map((r: any) => r.question_id)
  const [{ data: questions }, { data: answers }] = await Promise.all([
    db.from('questions').select('id,question_number,question,options,correct_option,correct_choice,section,has_passage,image_url').in('id', ids),
    db.from('exam_session_answers').select('question_id,selected_option,is_flagged').eq('session_id', id).in('question_id', ids),
  ])
  const qm = new Map((questions ?? []).map((q: any) => [q.id, q])), am = new Map((answers ?? []).map((a: any) => [a.question_id, a]))
  return json({ data: (rows ?? []).map((row: any) => { const q = qm.get(row.question_id), a = am.get(row.question_id), choice = a?.selected_option ?? null, correct = q?.correct_option ?? q?.correct_choice ?? null; return { ref: row.id, number: q?.question_number ?? row.position, subject: row.subject_slug, passage: q?.has_passage ? passageFor(q.section, q.question_number) : null, question: { text: q?.question ?? '', ...(q?.image_url ? { image_url: q.image_url } : {}) }, options: Array.isArray(q?.options) ? q.options.map((text: any, index: number) => ({ key: String.fromCharCode(65 + index), text })) : [], your_choice: choice, correct_choice: correct, is_correct: choice !== null && choice === correct, flagged: Boolean(a?.is_flagged) } }), meta: { from, limit, generatedAt: new Date().toISOString() } })
}
