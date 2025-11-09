import { authorizeRequest } from './_auth';

const ok = (data: unknown, status = 200) =>
new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const uuid = () => (crypto?.randomUUID?.() ?? (Math.random().toString(36).slice(2) + Date.now().toString(36)));
const nowIso = () => new Date().toISOString();

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
const auth = authorizeRequest(request, env);
if (!auth.ok) return ok({ error: auth.error }, auth.status);
const url = new URL(request.url);
const entryId = url.searchParams.get('entryId');
const requestedLimit = Number(url.searchParams.get('limit'));
const limitValue = Number.isFinite(requestedLimit) ? requestedLimit : 100;
const limit = Math.max(1, Math.min(500, limitValue));
let stmt = 'SELECT * FROM audit';
const binds: any[] = [];
if (entryId) { stmt += ' WHERE entryId=?'; binds.push(entryId); }
stmt += ' ORDER BY ts DESC LIMIT ?';
binds.push(limit);
const { results } = await env.DB.prepare(stmt).bind(...binds).all();
return ok(results || []);
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
const auth = authorizeRequest(request, env);
if (!auth.ok) return ok({ error: auth.error }, auth.status);
const b = await request.json().catch(() => null);
if (!b || typeof b !== 'object') return ok({ error: 'Invalid JSON' }, 400);
const id = uuid();
const ts = nowIso();
const actorName = auth.user.name || auth.user.email;
const entryId = typeof b.entryId === 'string' ? b.entryId : '';
const action = typeof b.action === 'string' ? b.action : '';
const meta = b.meta && typeof b.meta === 'object' ? JSON.stringify(b.meta) : JSON.stringify({});
await env.DB.prepare('INSERT INTO audit (id,ts,user,entryId,action,meta) VALUES (?,?,?,?,?,?)')
.bind(id, ts, actorName, entryId, action, meta)
.run();
return ok({ id, ts });
};
