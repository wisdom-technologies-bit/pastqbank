import { NextResponse } from "next/server";
import { verifyCron } from "@/lib/security/verifyCron";
import { runSlice } from "@/lib/imports/engine";
import { autoResumeIfKeysAvailable } from "@/lib/imports/jobs";
export const maxDuration=60;
export async function POST(request:Request){if(!verifyCron(request))return NextResponse.json({error:"Unauthorized"},{status:401});await autoResumeIfKeysAvailable();return NextResponse.json(await runSlice({budgetMs:25000}));}
