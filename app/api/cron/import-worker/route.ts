import { NextResponse } from "next/server";
import { verifyCron } from "@/lib/security/verifyCron";
import { runSlice } from "@/lib/imports/engine";
import { autoResumeIfKeysAvailable, bootstrapAutoImport, retryFailedUnits } from "@/lib/imports/jobs";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
export const maxDuration=60;
export async function POST(request:Request){if(!verifyCron(request))return NextResponse.json({error:"Unauthorized"},{status:401});await bootstrapAutoImport();await autoResumeIfKeysAvailable();const db=getAdminSupabaseClient();const latest=(await db.from("import_jobs").select("id,status").order("updated_at",{ascending:false}).limit(1)).data?.[0];if(latest?.status==="completed"){const failed=(await db.from("import_units").select("id").eq("job_id",latest.id).eq("status","failed").limit(1)).data?.length??0;const rounds=(await db.from("admin_audit_logs").select("id").eq("action","auto_retry_failed").eq("entity_id",latest.id)).data?.length??0;if(failed&&rounds<3){await retryFailedUnits(latest.id,"system");await db.from("admin_audit_logs").insert({admin_user_id:null,action:"auto_retry_failed",entity:"import_job",entity_id:latest.id,details:{actor:"system",round:rounds+1}});}}return NextResponse.json(await runSlice({budgetMs:25000}));}
