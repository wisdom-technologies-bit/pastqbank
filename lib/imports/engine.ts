import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchQuestions } from "@/lib/providers/aloc/client";
import { saveQuestions } from "@/lib/bank/saveQuestions";
import { SupabaseQuestionStore } from "@/lib/bank/supabaseQuestionStore";
import { buildUnits, ImportScopeSchema } from "./plan";
import { AllKeysUnavailableError, AlocRateLimitedError, AlocTransientError, AlocRequestError } from "@/lib/providers/aloc/errors";

export type SliceSummary={idle:boolean;jobId:string|null;status:string|null;pagesFetched:number;requestsMade:number;creditsUsed:number;unitsCompleted:number;stoppedBecause:"budget"|"done"|"paused"|"no_keys"|"rate_limited"|"transient"|"cancelled"|"credit_cap"|"idle"};
const safe=(e:unknown)=>e instanceof Error?e.message:"Import failed";
const reportedCredits=(value:unknown)=>Number.isInteger(value)&&Number(value)>0?Number(value):1;
export async function runSlice(options:{budgetMs?:number;jobId?:string}={}):Promise<SliceSummary>{
 const db=getAdminSupabaseClient(); const budget=options.budgetMs??40000; const cutoff=new Date(Date.now()-120000).toISOString();
 let query=db.from("import_jobs").select("*").in("status",["queued","running"]).order("created_at",{ascending:true}).limit(1); if(options.jobId) query=db.from("import_jobs").select("*").eq("id",options.jobId).limit(1);
 const found=await query; const job=found.data?.[0] as any; if(!job)return idle(options.jobId??null);
 const claimed=await db.from("import_jobs").update({status:"running",started_at:job.started_at??new Date().toISOString()}).eq("id",job.id).or(`status.eq.queued,and(status.eq.running,updated_at.lt.${cutoff})`).select("id").maybeSingle(); if(claimed.error||!claimed.data)return idle(job.id,job.status);
 let scope; try{scope=ImportScopeSchema.parse(job.scope)}catch{await db.from("import_jobs").update({status:"failed",error_summary:"Invalid import scope"}).eq("id",job.id);return {...summary(job.id,"failed",0,0,0,0),stoppedBecause:"transient"};}
 let units=(await db.from("import_units").select("*").eq("job_id",job.id).order("exam_year",{ascending:false})).data as any[]??[]; if(!units.length){const rows=buildUnits(scope).map(u=>({...u,job_id:job.id,status:"pending",pages_fetched:0,questions_seen:0})); if(rows.length)await db.from("import_units").insert(rows); units=(await db.from("import_units").select("*").eq("job_id",job.id).order("exam_year",{ascending:false})).data as any[]??[];}
 let pages=0,requests=0,credits=0,lastRequest=0;
 const totals={discovered_count:job.discovered_count??0,inserted_count:job.inserted_count??0,updated_count:job.updated_count??0,skipped_count:job.skipped_count??0,quarantined_count:job.quarantined_count??0,rejected_count:job.rejected_count??0,requests_made:job.requests_made??0,credits_used:job.credits_used??0};
 const writeTotals=()=>db.from("import_jobs").update(totals).eq("id",job.id);
 while(Date.now()-lastRequest < budget*.85 || lastRequest===0){const fresh=(await db.from("import_jobs").select("status,credits_used").eq("id",job.id).single()).data as any;if(fresh?.status==="paused"||fresh?.status==="cancelled")return {...summary(job.id,fresh.status,pages,requests,credits,0),stoppedBecause:fresh.status};
  const unit=units.find(u=>u.status==="running")??units.find(u=>u.status==="pending"); if(!unit){await db.from("import_jobs").update({status:"completed",completed_at:new Date().toISOString(),...totals}).eq("id",job.id);return {...summary(job.id,"completed",pages,requests,credits,units.filter(u=>["done","empty","failed"].includes(u.status)).length),stoppedBecause:"done"};}
  if(lastRequest){const wait=Math.max(0,2200-(Date.now()-lastRequest));if(wait)await new Promise(r=>setTimeout(r,wait));} await db.from("import_units").update({status:"running"}).eq("id",unit.id); lastRequest=Date.now();
  try{const result=await fetchQuestions({examType:unit.exam_slug,year:unit.exam_year,cursor:unit.cursor,limit:15}); const requestCredits=reportedCredits(result.creditsUsed); requests++;credits+=requestCredits;totals.requests_made++;totals.credits_used+=requestCredits;
   if(result.empty&&unit.pages_fetched===0){await db.from("import_units").update({status:"empty",pages_fetched:0}).eq("id",unit.id);unit.status="empty";await writeTotals();continue;}
   const store=new SupabaseQuestionStore(); const saved=await saveQuestions(store,result.questions,{examType:unit.exam_slug,year:unit.exam_year,jobId:job.id}); const fetched=result.questions.length+result.invalid.length; totals.discovered_count+=fetched; totals.inserted_count+=saved.inserted; totals.updated_count+=saved.updated; totals.skipped_count+=saved.skipped; totals.rejected_count+=saved.rejected+result.invalid.length; totals.quarantined_count+=saved.quarantined; await writeTotals(); await db.from("import_units").update({cursor:result.pagination.nextCursor,pages_fetched:(unit.pages_fetched??0)+1,questions_seen:(unit.questions_seen??0)+fetched,status:result.pagination.hasMore?"running":"done",last_error:null}).eq("id",unit.id); unit.cursor=result.pagination.nextCursor;unit.pages_fetched++;unit.questions_seen+=fetched;if(!result.pagination.hasMore)unit.status="done";
   if(scope.maxCredits&&totals.credits_used>=scope.maxCredits){await db.from("import_jobs").update({status:"paused",error_summary:"Credit cap reached",...totals}).eq("id",job.id);return {...summary(job.id,"paused",pages+1,requests,credits,0),stoppedBecause:"credit_cap"};}
  }catch(e){const msg=safe(e);await db.from("import_errors").insert({job_id:job.id,unit_id:unit.id,error_code:"unit_fetch_failed",message:msg,payload:null});const count=(await db.from("import_errors").select("id",{count:"exact",head:true}).eq("unit_id",unit.id).eq("error_code","unit_fetch_failed")).count??0;if(count>=5){await db.from("import_units").update({status:"failed",last_error:msg}).eq("id",unit.id);unit.status="failed";}const why=e instanceof AllKeysUnavailableError?"no_keys":e instanceof AlocRateLimitedError?"rate_limited":e instanceof AlocTransientError||e instanceof AlocRequestError?"transient":"transient";if(why==="no_keys")await db.from("import_jobs").update({status:"paused",error_summary:"All ALOC API keys are exhausted or unavailable. Add credits or a key, then press Resume."}).eq("id",job.id);return {...summary(job.id,why==="no_keys"?"paused":"running",pages,requests,credits,0),stoppedBecause:why};}
  pages++;
 }
 return {...summary(job.id,"running",pages,requests,credits,0),stoppedBecause:"budget"};
}
function idle(jobId:string|null,status:string|null=null){return {idle:true,jobId,status,pagesFetched:0,requestsMade:0,creditsUsed:0,unitsCompleted:0,stoppedBecause:"idle" as const};}
function summary(jobId:string,status:string,pagesFetched:number,requestsMade:number,creditsUsed:number,unitsCompleted:number){return {idle:false,jobId,status,pagesFetched,requestsMade,creditsUsed,unitsCompleted,stoppedBecause:"budget" as const};}
export { reportedCredits };
