import { z } from 'zod'
import crypto from 'node:crypto'
import { getAdminSupabaseClient } from '@/lib/supabase/admin'
import { catalogContext } from '@/lib/catalog/service'
import { compulsoryMissing, donorYearFor } from '@/lib/catalog/donor'
import { json } from '@/lib/catalog/http'
import { selectQuestions } from './select'

export const sessionSchema=z.object({user_ref:z.string().min(1).max(128),tier:z.enum(['free','premium']),mode:z.enum(['practice','cbt']),exam:z.string().transform(v=>v==='post_utme'?'post-utme':v),year:z.number().int().nullable(),subjects:z.array(z.object({slug:z.string().min(1),question_count:z.number().int().positive().optional()})).min(1),minutes:z.number().int().positive().optional(),order:z.enum(['original','shuffled']).optional(),feedback:z.enum(['instant','end']).optional(),missing_compulsory:z.enum(['skip','borrow']).optional()})
export function bad(code:string,message:string,status:number,details?:unknown){return json({error:{code,message,...(details===undefined?{}:{details})}},status)}
export function owner(request:Request,user:string){return request.headers.get('x-user-ref')===user}
export async function sessionSummary(id:string,includeOutline=true){const db=getAdminSupabaseClient();const {data:s}=await db.from('exam_sessions').select('id,user_ref,status,mode,exam_slug,exam_year,tier,total_questions,duration_seconds,feedback_mode,created_at,started_at,deadline_at,submitted_at,expires_at,config').eq('id',id).maybeSingle();if(!s)return null;const {data:q}=includeOutline?await db.from('exam_session_questions').select('position,id,subject_slug,subject_number,passage_key').eq('session_id',id).order('position'): {data:null};return {...s,outline:(q??[]).map(x=>({position:x.position,ref:x.id,subject:x.subject_slug,subject_number:x.subject_number,passage_key:x.passage_key}))}}

export async function createSession(body:unknown){
  const parsed=sessionSchema.safeParse(body)
  if(!parsed.success)return bad('invalid_config','Invalid session configuration',400,parsed.error.flatten())
  const input=parsed.data,c=await catalogContext(input.exam)
  if(!c)return bad('not_found','Unknown exam',404)
  if(input.tier==='free'&&input.year!==null&&!c.free.has(input.year))return bad('premium_required',`Free access is limited to years ${[...c.free].sort((a,b)=>b-a).join(', ')}`,403)

  const profile=c.profile,subjects=input.subjects.map(s=>s.slug)
  if(new Set(subjects).size!==subjects.length)return bad('invalid_config','Duplicate subjects in the request',422,{subjects})
  const practiceCounts=Object.fromEntries(input.subjects.map(s=>[s.slug,s.question_count??c.requiredCount(profile,s.slug)]))

  // CBT plan: validate the paper against the catalog, fix counts, and note which
  // year each subject draws from (a borrowed compulsory subject draws from the donor year).
  const drawYear=new Map<string,number>(),borrowed=new Set<string>()
  let required=new Map<string,number>(),cbtMinutes:number|null=null
  if(input.mode==='cbt'){
    if(input.year===null)return bad('invalid_config','CBT sessions need a specific exam year',422,{reason:'year_required'})
    const year=input.year,compulsory=profile.compulsory_subject_slug,eligibility=c.cbt(year)
    const qualifying=new Set(eligibility.qualifyingSubjects??[])
    const minSubjects=eligibility.minSubjects??profile.subjects_required,maxSubjects=eligibility.maxSubjects??profile.subjects_required
    const missing=compulsory?compulsoryMissing(c,year):false,choice=input.missing_compulsory??'skip'
    for(const slug of subjects)drawYear.set(slug,year)
    if(missing&&compulsory){
      if(choice==='skip'&&subjects.includes(compulsory))return bad('invalid_config',`${year} has no ${compulsory} questions; leave it out or borrow it`,422,{compulsory_subject_slug:compulsory,missing_compulsory:'skip'})
      if(choice==='borrow'){
        if(!subjects.includes(compulsory))return bad('compulsory_subject_required',`${compulsory} must be included when borrowing it`,422,{compulsory_subject_slug:compulsory})
        const donor=donorYearFor(c,year,compulsory)
        if(donor===null)return bad('compulsory_subject_missing',`No year has enough ${compulsory} questions to borrow`,422,{compulsory_subject_slug:compulsory})
        if(input.tier==='free'&&!c.free.has(donor))return bad('premium_required',`Borrowing ${compulsory} from ${donor} needs a premium account`,403,{donor_year:donor})
        drawYear.set(compulsory,donor);borrowed.add(compulsory)
      }
    } else if(compulsory&&!subjects.includes(compulsory)){
      return bad('compulsory_subject_required',`${compulsory} is required for a ${year} CBT`,422,{compulsory_subject_slug:compulsory})
    }
    const allowed=new Set<string>([...qualifying,...borrowed]),unavailable=subjects.filter(slug=>!allowed.has(slug))
    if(unavailable.length)return bad('invalid_config',`Not enough questions for a CBT in ${year}`,422,{subjects:unavailable,qualifyingSubjects:[...qualifying]})
    if(subjects.length<minSubjects||subjects.length>maxSubjects)return bad('invalid_config',`A CBT needs ${minSubjects} to ${maxSubjects} subjects`,422,{minSubjects,maxSubjects,subjects:subjects.length})
    required=new Map(subjects.map(slug=>[slug,c.requiredCount(profile,slug)]))
    const minutes=input.minutes!==undefined?Math.min(Math.max(input.minutes,profile.min_minutes??1),profile.max_minutes??Number.MAX_SAFE_INTEGER):profile.shared_timer?(profile.total_minutes??profile.default_minutes):subjects.reduce((sum,slug)=>sum+(profile.overrides?.get(slug)?.minutes??profile.default_minutes),0)
    cbtMinutes=Math.max(1,minutes)
  }

  const db=c.db
  const {data:exam}=await db.from('exams').select('id').eq('slug',input.exam).maybeSingle()
  if(!exam)return bad('not_found','Unknown exam',404)
  const {data:subjectRows}=await db.from('subjects').select('id,slug').in('slug',subjects)
  const subjectIds=new Map((subjectRows??[]).map((s:any)=>[s.slug,s.id]))
  const unknown=subjects.find(s=>!subjectIds.has(s))
  if(unknown)return bad('invalid_config',`Unknown subject ${unknown}`,400)
  const years=input.mode==='cbt'?[...new Set(drawYear.values())]:input.year===null?c.years.filter(y=>input.tier==='premium'||c.free.has(y)):[input.year]
  const {data:bankQuestions}=await db.from('questions').select('id,subject_id,exam_year,question_number,passage_key,status').eq('exam_id',exam.id).eq('status','published').in('subject_id',[...subjectIds.values()]).in('exam_year',years).order('question_number')
  const available=(bankQuestions??[]).map((q:any)=>({...q,subject_slug:subjects.find(s=>subjectIds.get(s)===q.subject_id),exam_year:Number(q.exam_year)}))
  const candidates=input.mode==='cbt'?available.filter((q:any)=>drawYear.get(q.subject_slug)===q.exam_year):available
  const counts=input.mode==='cbt'?Object.fromEntries(subjects.map(slug=>[slug,Math.min(required.get(slug)??0,candidates.filter((q:any)=>q.subject_slug===slug).length)])):practiceCounts
  if(input.mode==='cbt')for(const slug of subjects)if((counts[slug]??0)<1)return bad('not_enough_questions',`Not enough questions for ${slug}`,422,{available:0,requested:required.get(slug)??0})
  if(input.mode!=='cbt')for(const s of subjects){const found=candidates.filter((q:any)=>q.subject_slug===s).length;if(found<counts[s])return bad('not_enough_questions',`Not enough questions for ${s}`,422,{available:found,requested:counts[s]})}
  const seed=Math.floor(Math.random()*2147483647),order=input.order??(input.mode==='cbt'?'original':input.year===null?'shuffled':'original'),selected=selectQuestions({subjects,counts,order,seed,candidates})
  const duration=input.mode==='cbt'?cbtMinutes!*60:input.minutes?input.minutes*60:null
  const questions=selected.questions.map((q:any,i:number)=>({ref:crypto.randomUUID(),position:i+1,question_id:q.id,subject_slug:q.subject_slug,subject_number:selected.questions.slice(0,i+1).filter((x:any)=>x.subject_slug===q.subject_slug).length,passage_key:q.passage_key,borrowed_from_year:borrowed.has(q.subject_slug)?drawYear.get(q.subject_slug)??null:null}))
  const payload={user_ref:input.user_ref,mode:input.mode,exam_slug:input.exam,exam_year:input.year??'',tier:input.tier,config:{...input,seed,borrowed_from_year:Object.fromEntries([...borrowed].map(slug=>[slug,drawYear.get(slug)??null]))},total_questions:questions.length,duration_seconds:duration,feedback_mode:input.feedback??(input.mode==='practice'?'instant':'end')}
  const {data:id,error}=await db.rpc('create_exam_session',{p_session:payload,p_questions:questions})
  if(error)return bad('invalid_config',error.message,400)
  return json({data:{id,status:'created',mode:input.mode,exam:input.exam,year:input.year,tier:input.tier,total_questions:questions.length,duration_seconds:duration,feedback_mode:payload.feedback_mode,subjects:subjects.map(slug=>({slug,name:slug,question_count:selected.questions.filter((q:any)=>q.subject_slug===slug).length,borrowed_from_year:borrowed.has(slug)?drawYear.get(slug)??null:null})),notices:selected.notices??[],outline:questions.map(q=>({position:q.position,subject:q.subject_slug,subject_number:q.subject_number,passage_key:q.passage_key}))},meta:{generatedAt:new Date().toISOString()}},201)
}
