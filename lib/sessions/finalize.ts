import { getAdminSupabaseClient } from '@/lib/supabase/admin'
export async function finalizeSession(id:string, expired=false) {
  const db=getAdminSupabaseClient(); const {data:s}=await db.from('exam_sessions').select('id,status,mode,started_at,submitted_at').eq('id',id).maybeSingle(); if(!s) return null
  if(s.status==='submitted'||s.status==='expired') return await resultFor(id)
  const {data:rows}=await db.from('exam_session_questions').select('question_id,subject_slug').eq('session_id',id)
  const {data:answers}=await db.from('exam_session_answers').select('question_id,selected_option').eq('session_id',id)
  const ids=(rows??[]).map((r:any)=>r.question_id); const {data:qs}=await db.from('questions').select('id,correct_option,subject_id').in('id',ids)
  const amap=new Map((answers??[]).map((a:any)=>[a.question_id,a.selected_option])); const qmap=new Map((qs??[]).map((q:any)=>[q.id,q])); let correct=0,answered=0
  for(const r of rows??[]){const c=amap.get(r.question_id); if(c!==null&&c!==undefined){answered++; if(c===qmap.get(r.question_id)?.correct_option)correct++}}
  const total=(rows??[]).length, wrong=Math.max(0,answered-correct), unanswered=total-answered, started=s.started_at?new Date(s.started_at).getTime():Date.now(), time_used_seconds=Math.max(0,Math.round((Date.now()-started)/1000)), percent=total?Math.round(correct/total*10000)/100:0
  const result={total,answered,correct,wrong,unanswered,percent,time_used_seconds,subjects:[] as any[]}
  await db.from('exam_sessions').update({status:expired?'expired':'submitted',submitted_at:new Date().toISOString(),score:correct,max_score:total,config:{...(s as any).config,result}}).eq('id',id)
  return result
}
export async function resultFor(id:string){const db=getAdminSupabaseClient();const {data:s}=await db.from('exam_sessions').select('config').eq('id',id).maybeSingle(); return (s as any)?.config?.result ?? null}
