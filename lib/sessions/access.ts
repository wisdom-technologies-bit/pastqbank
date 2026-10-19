import {NextResponse} from 'next/server'
export function enforceFreeYears(tier:'free'|'premium',year:number|null,free:Set<number>){if(tier==='free'&&year!==null&&!free.has(year))return NextResponse.json({error:{code:'premium_required',message:`Free access is limited to years ${[...free].sort((a,b)=>b-a).join(', ')}`}}, {status:403});return null}
