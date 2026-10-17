import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { startJob } from "@/lib/imports/jobs";
export async function GET(){try{await requireAdmin();const db=getAdminSupabaseClient();const jobs=(await db.from("import_jobs").select("id,job_type,scope,status,discovered_count,inserted_count,updated_count,skipped_count,credits_used,created_at,started_at").order("created_at",{ascending:false}).limit(20)).data??[];return NextResponse.json({jobs});}catch{return NextResponse.json({error:"Unauthorized"},{status:401});}}
export async function POST(request:Request){try{const user=await requireAdmin();const id=await startJob(await request.json(),user.id);return NextResponse.json({ok:true,id},{status:201});}catch(e){return NextResponse.json({ok:false,error:"Import start failed",message:e instanceof Error?e.message:"Import start failed"},{status:400});}}
