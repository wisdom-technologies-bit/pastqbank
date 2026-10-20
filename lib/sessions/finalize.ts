import { getAdminSupabaseClient } from '@/lib/supabase/admin'

async function computeResult(id: string) {
  const db = getAdminSupabaseClient()
  const { data: session } = await db.from('exam_sessions').select('id,status,mode,started_at,submitted_at,exam_slug,config').eq('id', id).maybeSingle()
  if (!session) return null
  const { data: rows } = await db.from('exam_session_questions').select('question_id,subject_slug').eq('session_id', id).order('position')
  const ids = (rows ?? []).map((r: any) => r.question_id)
  const [{ data: answers }, { data: questions }, { data: subjects }] = await Promise.all([
    db.from('exam_session_answers').select('question_id,selected_option').eq('session_id', id),
    db.from('questions').select('id,correct_option,correct_choice').in('id', ids),
    db.from('subjects').select('slug,name'),
  ])
  const answerMap = new Map((answers ?? []).map((a: any) => [a.question_id, a.selected_option]))
  const questionMap = new Map((questions ?? []).map((q: any) => [q.id, q]))
  const names = new Map((subjects ?? []).map((s: any) => [s.slug, s.name]))
  let answered = 0, correct = 0
  const bySubject = new Map<string, { slug: string; name: string; total: number; answered: number; correct: number; wrong: number; unanswered: number; percent: number; score_100?: number }>()
  for (const row of rows ?? []) {
    const subject = row.subject_slug ?? 'unknown'
    const item = bySubject.get(subject) ?? { slug: subject, name: names.get(subject) ?? subject, total: 0, answered: 0, correct: 0, wrong: 0, unanswered: 0, percent: 0 }
    item.total++
    const choice = answerMap.get(row.question_id)
    const hasAnswer = choice !== null && choice !== undefined
    if (hasAnswer) { answered++; item.answered++; const q = questionMap.get(row.question_id); if (choice === (q?.correct_option ?? q?.correct_choice)) { correct++; item.correct++ } else item.wrong++ } else item.unanswered++
    bySubject.set(subject, item)
  }
  const total = (rows ?? []).length, wrong = answered - correct, unanswered = total - answered
  const subjectsResult = [...bySubject.values()].map((item) => ({ ...item, percent: item.total ? Math.round(item.correct / item.total * 10000) / 100 : 0 }))
  const jamb = session.exam_slug === 'jamb' && subjectsResult.length === 4
  const score400 = jamb ? subjectsResult.reduce((sum, item) => { item.score_100 = Math.round(item.correct / item.total * 10000) / 100; return sum + item.score_100 }, 0) : null
  return { total, answered, correct, wrong, unanswered, percent: total ? Math.round(correct / total * 10000) / 100 : 0, time_used_seconds: Math.max(0, Math.round((Date.now() - new Date(session.started_at ?? Date.now()).getTime()) / 1000)), subjects: subjectsResult, score_400: score400 }
}

export async function finalizeSession(id: string, expired = false) {
  const db = getAdminSupabaseClient(); const { data: session } = await db.from('exam_sessions').select('status,config').eq('id', id).maybeSingle(); if (!session) return null
  const result = await computeResult(id); if (!result) return null
  if (session.status !== 'submitted' && session.status !== 'expired') await db.from('exam_sessions').update({ status: expired ? 'expired' : 'submitted', submitted_at: new Date().toISOString(), score: result.correct, max_score: result.total, config: { ...(session.config as any), result } }).eq('id', id)
  else if (JSON.stringify((session.config as any)?.result) !== JSON.stringify(result)) await db.from('exam_sessions').update({ score: result.correct, max_score: result.total, config: { ...(session.config as any), result } }).eq('id', id)
  return result
}

export async function resultFor(id: string) { return finalizeSession(id) }
