import { guard } from '@/lib/catalog/http'
import { createSession } from '@/lib/sessions/api'
export async function POST(request:Request){const denied=guard(request);if(denied)return denied;try{return await createSession(await request.json())}catch{return (await import('@/lib/sessions/api')).bad('invalid_config','Invalid JSON body',400)}}
