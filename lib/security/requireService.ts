import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
export function requireService(request: Request): NextResponse | null {
  const expected = process.env.BANK_SERVICE_KEY
  if (!expected) return NextResponse.json({ error: { code: 'service_unavailable', message: 'Bank service key is not configured' } }, { status: 503 })
  const value = request.headers.get('authorization')?.replace(/^Bearer\s+/, '') ?? ''
  const actual = Buffer.from(value)
  const target = Buffer.from(expected)
  const valid = actual.length === target.length && timingSafeEqual(actual, target)
  if (!valid) return NextResponse.json({ error: { code: 'unauthorized', message: 'Invalid service key' } }, { status: 401 })
  return null
}
