import { guard, json } from '@/lib/catalog/http'
import { owner, sessionSummary, bad } from '@/lib/sessions/api'
import { getAdminSupabaseClient } from '@/lib/supabase/admin'
import { presentQuestion } from '@/lib/sessions/present'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(request); if (denied) return denied
  const id = (await params).id, s = await sessionSummary(id)
  if (!s || !owner(request, s.user_ref)) return bad('not_found', 'Session not found', 404)
  if (s.status === 'created') return bad('not_started', 'Session has not started', 409)
  if (s.status === 'submitted' || s.status === 'expired') return bad('session_finished', 'Session has finished', 410)
  const u = new URL(request.url), from = Math.max(1, Number(u.searchParams.get('from') ?? 1)), limit = Math.min(60, Math.max(1, Number(u.searchParams.get('limit') ?? 30)))
  const db = getAdminSupabaseClient()
  const { data: refs } = await db.from('exam_session_questions').select('id,position,subject_slug,subject_number,passage_key,question_id').eq('session_id', id).gte('position', from).lt('position', from + limit).order('position')
  const qids = (refs ?? []).map(x => x.question_id)
  const [{ data: qs }, { data: answers }] = await Promise.all([
    db.from('questions').select('id,text,options,image_url,section,has_passage,question_number,passage_key').in('id', qids),
    db.from('exam_session_answers').select('question_id,is_flagged,revealed_at').eq('session_id', id).in('question_id', qids),
  ])
  const flags = new Map((answers ?? []).map(a => [a.question_id, Boolean(a.is_flagged)]))
  const reveals = new Map((answers ?? []).map(a => [a.question_id, Boolean(a.revealed_at)]))
  const items = (refs ?? []).map(r => {
    const q = (qs ?? []).find(x => x.id === r.question_id); if (!q) return null
    return { ...presentQuestion({ ...q, ref: r.id, position: r.position, subject_slug: r.subject_slug, subject_number: r.subject_number }, !(refs ?? []).some(x => x.position < r.position && x.passage_key && x.passage_key === r.passage_key)), flagged: flags.get(r.question_id) ?? false, revealed: reveals.get(r.question_id) ?? false }
  }).filter(Boolean)
  return json({ data: items, meta: { from, limit, generatedAt: new Date().toISOString() } })
}
