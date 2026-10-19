import { NextResponse } from 'next/server'
import { requireService } from '@/lib/security/requireService'
export function guard(request: Request) { return requireService(request) }
export function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } }) }
export function error(code: string, message: string, status: number) { return json({ error: { code, message } }, status) }
