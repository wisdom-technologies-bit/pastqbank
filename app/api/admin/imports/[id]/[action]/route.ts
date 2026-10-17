import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { pauseJob,resumeJob,cancelJob,retryFailedUnits } from "@/lib/imports/jobs";
import { runSlice } from "@/lib/imports/engine";
export async function POST(_:Request,{params}:{params:Promise<{id:string;action:string}>}){try{const admin=await requireAdmin();const {id,action}=await params;if(action==="run-slice")return NextResponse.json(await runSlice({jobId:id,budgetMs:45000}));if(action==="pause")await pauseJob(id,admin.id);else if(action==="resume")await resumeJob(id,admin.id);else if(action==="cancel")await cancelJob(id,admin.id);else if(action==="retry")await retryFailedUnits(id,admin.id);else return NextResponse.json({error:"Unknown action"},{status:404});return NextResponse.json({ok:true});}catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"Action failed"},{status:400});}}
