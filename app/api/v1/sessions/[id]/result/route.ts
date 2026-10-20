import { guard, json } from '@/lib/catalog/http'
import { owner, sessionSummary, bad } from '@/lib/sessions/api'
import { resultFor } from '@/lib/sessions/finalize'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(request); if (denied) return denied
  const id = (await params).id, session = await sessionSummary(id)
  if (!session || !owner(request, session.user_ref)) return bad('not_found', 'Session not found', 404)
  if (session.status !== 'submitted' && session.status !== 'expired') return bad('not_submitted', 'Session has not been submitted', 409)
  return json({ data: await resultFor(id), meta: { generatedAt: new Date().toISOString() } })
}
