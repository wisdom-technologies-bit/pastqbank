import { NextResponse } from "next/server";
import { verifyCron } from "@/lib/security/verifyCron";
import { runSlice } from "@/lib/imports/engine";
export const maxDuration=60;
export async function POST(request:Request){if(!verifyCron(request))return NextResponse.json({error:"Unauthorized"},{status:401});return NextResponse.json(await runSlice({budgetMs:45000}));}
export async function GET(request:Request){return POST(request);}
