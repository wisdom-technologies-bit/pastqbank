import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { runSlice } from "@/lib/imports/engine";
export const maxDuration=60;
export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){try{await requireAdmin();const {id}=await params;return NextResponse.json(await runSlice({jobId:id,budgetMs:45000}));}catch(e){return NextResponse.json({error:"Unauthorized"},{status:401});}}
