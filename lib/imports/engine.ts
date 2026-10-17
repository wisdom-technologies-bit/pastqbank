import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { fetchQuestions as realFetchQuestions } from "@/lib/providers/aloc/client";
import { saveQuestions as realSaveQuestions } from "@/lib/bank/saveQuestions";
import { SupabaseQuestionStore } from "@/lib/bank/supabaseQuestionStore";
import { AllKeysUnavailableError, AlocRateLimitedError } from "@/lib/providers/aloc/errors";
import { COVERAGE } from "./coverage";

export type PageSummary = { exam:string; year:number; pageNumber:number; questions:number; creditsUsed:number; attempts:number; creditsRemaining:number|null; keyLabel:string|null; empty:boolean };
export type SliceSummary = { jobId:string|null; stoppedBecause:string|null; pages:PageSummary[]; keysUsed:string[]; discovered:number; inserted:number; updated:number; quarantined:number; requestsMade:number; creditsUsed:number };
export type ImportDeps = { db:any; fetchQuestions:typeof realFetchQuestions; saveQuestions:typeof realSaveQuestions; createStore:(db:any)=>any; now:()=>number; sleep:(ms:number)=>Promise<void> };
export const reportedCredits = (value:number|undefined|null) => value ?? 1;
const ORDER = ["jamb","waec","neco","post_utme"] as const;
const defaults = ():ImportDeps => ({ db:getAdminSupabaseClient(), fetchQuestions:realFetchQuestions, saveQuestions:realSaveQuestions, createStore:(db)=>new SupabaseQuestionStore(db), now:Date.now, sleep:(ms)=>new Promise(resolve=>setTimeout(resolve,ms)) });
const get = async (db:any, table:string, id:string) => { const r=await db.from(table).select("*").eq("id",id).maybeSingle(); if(r.error) throw r.error; return r.data; };
const update = async (db:any, table:string, id:string, values:any) => { const r=await db.from(table).update(values).eq("id",id); if(r.error) throw r.error; };
function sortUnits(units:any[]) { return [...units].sort((a,b)=> (a.status==="running"?0:1)-(b.status==="running"?0:1) || b.exam_year-a.exam_year || ORDER.indexOf(a.exam_slug)-ORDER.indexOf(b.exam_slug)); }
function emptySummary(jobId:string|null):SliceSummary { return {jobId,stoppedBecause:null,pages:[],keysUsed:[],discovered:0,inserted:0,updated:0,quarantined:0,requestsMade:0,creditsUsed:0}; }
export async function runSlice(options:{jobId?:string; budgetMs?:number}, injected?:Partial<ImportDeps>):Promise<SliceSummary> {
 const deps={...defaults(),...injected}; const budgetMs=options.budgetMs??40000; const sliceStart=deps.now();
 let jobs=options.jobId?[await get(deps.db,"import_jobs",options.jobId)]:((await deps.db.from("import_jobs").select("*").in("status",["queued","running"]).order("updated_at",{ascending:true}).limit(20)).data??[]).filter((j:any)=>j.status==="queued"||deps.now()-new Date(j.updated_at).getTime()>120000);
 const job=jobs[0]; if(!job)return emptySummary(null); if(job.status!=="running") await update(deps.db,"import_jobs",job.id,{status:"running",started_at:job.started_at??new Date(deps.now()).toISOString(),updated_at:new Date(deps.now()).toISOString()});
 const summary=emptySummary(job.id); const units=((await deps.db.from("import_units").select("*").eq("job_id",job.id)).data??[]); const store=deps.createStore(deps.db);
 const release=async(reason:string)=>{ summary.stoppedBecause=reason; if(["budget","rate_limited","transient"].includes(reason)) await update(deps.db,"import_jobs",job.id,{status:"queued",updated_at:new Date(deps.now()).toISOString()}); };
 for(const unit of sortUnits(units.filter((u:any)=>!["done","empty","failed"].includes(u.status)))) {
   const window=(COVERAGE as any)[unit.exam_slug]; if(!window||unit.exam_year<window.from||unit.exam_year>window.to){ unit.status="empty"; await update(deps.db,"import_units",unit.id,{status:"empty",last_error:"outside known coverage window",updated_at:new Date(deps.now()).toISOString()}); continue; }
   while((deps.now()-sliceStart)+9000<budgetMs) {
    const pageNumber=(unit.pages_fetched??0)+1;
    try {
      const result:any=await deps.fetchQuestions({examType:unit.exam_slug,year:unit.exam_year,cursor:unit.cursor??undefined,limit:15});
      const questions=result.questions??[]; const meta=result.meta??result; const credits=reportedCredits(meta.creditsUsed ?? (meta.creditsRemainingBefore!=null&&meta.creditsRemainingAfter!=null?Math.max(0,meta.creditsRemainingBefore-meta.creditsRemainingAfter):undefined));
      const page:PageSummary={exam:unit.exam_slug,year:unit.exam_year,pageNumber,questions:questions.length,creditsUsed:credits,attempts:result.attempts??1,creditsRemaining:meta.creditsRemainingAfter??result.creditsRemainingAfter??null,keyLabel:result.keyLabel??null,empty:questions.length===0}; summary.pages.push(page); summary.requestsMade++; summary.creditsUsed+=credits; summary.discovered+=questions.length; if(page.keyLabel&&!summary.keysUsed.includes(page.keyLabel))summary.keysUsed.push(page.keyLabel); console.log(JSON.stringify({...page,jobId:job.id}));
      if(page.attempts>1||page.creditsUsed>1) await deps.db.from("import_errors").insert({job_id:job.id,unit_id:unit.id,error_code:"extra_credit_charge",message:`${unit.exam_slug} ${unit.exam_year} page ${pageNumber}: attempts ${page.attempts}, credits ${page.creditsUsed}`});
      const saved=questions.length?await deps.saveQuestions(store,questions,{examType:unit.exam_slug,year:unit.exam_year,jobId:job.id}):{inserted:0,updated:0,quarantined:0};
      const nextCursor=result.nextCursor??result.cursor??null; const nextStatus=questions.length===0||!nextCursor?"empty":"running"; unit.status=nextStatus;
      await update(deps.db,"import_units",unit.id,{cursor:nextCursor,pages_fetched:pageNumber,status:nextStatus,updated_at:new Date(deps.now()).toISOString(),last_error:null});
      await update(deps.db,"import_jobs",job.id,{discovered_count:(job.discovered_count??0)+summary.discovered,inserted_count:(job.inserted_count??0)+(saved.inserted??0),updated_count:(job.updated_count??0)+(saved.updated??0),quarantined_count:(job.quarantined_count??0)+(saved.quarantined??0),requests_made:(job.requests_made??0)+summary.requestsMade,credits_used:(job.credits_used??0)+summary.creditsUsed,updated_at:new Date(deps.now()).toISOString()});
      summary.inserted+=saved.inserted??0; summary.updated+=saved.updated??0; summary.quarantined+=saved.quarantined??0; Object.assign(job,{discovered_count:(job.discovered_count??0)+summary.discovered,requests_made:(job.requests_made??0)+summary.requestsMade,credits_used:(job.credits_used??0)+summary.creditsUsed});
      if(nextStatus!=="running")break;
      if(job.max_credits!=null&&(job.credits_used??0)>=job.max_credits){await update(deps.db,"import_jobs",job.id,{status:"paused",error_summary:"Credit cap reached",updated_at:new Date(deps.now()).toISOString()});summary.stoppedBecause="credit_cap";return summary;}
    } catch(error) {
      if(error instanceof AllKeysUnavailableError){await update(deps.db,"import_jobs",job.id,{status:"paused",error_summary:"All ALOC API keys are exhausted or unavailable. Add credits or a key, then press Resume.",updated_at:new Date(deps.now()).toISOString()});summary.stoppedBecause="no_keys";return summary;}
      if(error instanceof AlocRateLimitedError){await release("rate_limited");return summary;}
      const transient=(error as any)?.name==="AlocTransientError"; if(transient){await release("transient");return summary;}
      const failures=(unit.consecutive_failures??0)+1; await deps.db.from("import_errors").insert({job_id:job.id,unit_id:unit.id,error_code:"unit_fetch_failed",message:`${unit.exam_slug} ${unit.exam_year} page ${pageNumber} failed`}); await update(deps.db,"import_units",unit.id,{consecutive_failures:failures,status:failures>=5?"failed":"running",last_error:"unit fetch failed"}); if(failures>=5)break;
    }
   }
   if(summary.stoppedBecause)return summary;
   if(deps.now()-sliceStart+9000>=budgetMs){await release("budget");return summary;}
 }
 const remaining=units.some((u:any)=>!["done","empty","failed"].includes(u.status)); await update(deps.db,"import_jobs",job.id,{status:remaining?"queued":"completed",updated_at:new Date(deps.now()).toISOString()}); return summary;
}
