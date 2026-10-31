export type FakeTables = { rows?: Record<string, any[]>; singles?: Record<string, any>; session?: any; rpcData?: any }

/** Minimal Supabase stand-in: table reads, single-row reads, writes and rpc calls, all recorded. */
export function makeDb({ rows = {}, singles = {}, session, rpcData = "session-1" }: FakeTables = {}) {
  const calls: { upserts: any[]; updates: any[]; rpc: any[] } = { upserts: [], updates: [], rpc: [] };
  const single: Record<string, any> = { ...singles, ...(session === undefined ? {} : { exam_sessions: session }) };
  const client = {
    from(table: string) {
      const result = () => ({ data: rows[table] ?? [], error: null });
      const chain: any = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.not = () => chain;
      chain.gte = () => chain;
      chain.lt = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = async () => ({ data: single[table] ?? null, error: null });
      chain.update = (payload: any) => { calls.updates.push({ table, payload }); if (single[table] && typeof single[table] === "object") Object.assign(single[table], payload); return chain; };
      chain.upsert = (payload: any) => { calls.upserts.push({ table, payload }); return Promise.resolve({ error: null }); };
      chain.insert = (payload: any) => { calls.upserts.push({ table, payload }); return Promise.resolve({ error: null }); };
      chain.then = (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject);
      return chain;
    },
    rpc: async (name: string, args: any) => { calls.rpc.push({ name, args }); return { data: rpcData, error: null }; },
  };
  return { client, calls };
}
