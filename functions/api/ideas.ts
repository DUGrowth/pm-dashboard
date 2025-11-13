import { authorizeRequest } from './_auth';

const ok = (data: unknown, status = 200) =>
new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const uuid = () => (crypto?.randomUUID?.() ?? (Math.random().toString(36).slice(2) + Date.now().toString(36)));
const nowIso = () => new Date().toISOString();
const str = (v: any) => JSON.stringify(v ?? null);
const parseJson = (s: string | null | undefined) => { try { return s ? JSON.parse(s) : undefined; } catch { return undefined; } };

const inflate = (row: any) => row && {
...row,
links: parseJson(row.links) ?? [],
attachments: parseJson(row.attachments) ?? [],
};

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
const auth = await authorizeRequest(request, env);
if (!auth.ok) return ok({ error: auth.error }, auth.status);
const url = new URL(request.url);
const id = url.searchParams.get('id');
const month = url.searchParams.get('month');
if (id) {
const row = await env.DB.prepare('SELECT * FROM ideas WHERE id=?').bind(id).first();
return ok(inflate(row) || null);
}
let stmt = 'SELECT * FROM ideas';
const binds: any[] = [];
if (month) { stmt += ' WHERE targetMonth=?'; binds.push(month); }
stmt += ' ORDER BY createdAt DESC';
const { results } = await env.DB.prepare(stmt).bind(...binds).all();
return ok((results || []).map(inflate));
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
const auth = await authorizeRequest(request, env);
if (!auth.ok) return ok({ error: auth.error }, auth.status);
const b = await request.json().catch(() => null);
if (!b || !b.title) return ok({ error: 'Invalid JSON' }, 400);
const id = b.id || uuid();
const createdAt = nowIso();
const targetMonth = (b.targetMonth || (b.targetDate ? String(b.targetDate).slice(0, 7) : '')) as string;
await env.DB.prepare(
  `INSERT INTO ideas (id,type,title,notes,links,attachments,inspiration,createdBy,createdAt,targetDate,targetMonth) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
).bind(
id, b.type || 'Other', b.title, b.notes || '', str(b.links), str(b.attachments),
b.inspiration || '', b.createdBy || 'Unknown', createdAt, b.targetDate || '', targetMonth
).run();
return ok({ id });
};

export const onRequestPut = async ({ request, env }: { request: Request; env: any }) => {
const auth = await authorizeRequest(request, env);
if (!auth.ok) return ok({ error: auth.error }, auth.status);
const url = new URL(request.url);
const id = url.searchParams.get('id');
if (!id) return ok({ error: 'Missing id' }, 400);
const b = await request.json().catch(() => null);
if (!b) return ok({ error: 'Invalid JSON' }, 400);
const existing = await env.DB.prepare('SELECT * FROM ideas WHERE id=?').bind(id).first();
if (!existing) return ok({ error: 'Not found' }, 404);
const nextTargetMonth =
  (b.targetMonth || (b.targetDate ? String(b.targetDate).slice(0, 7) : '')) ||
  existing.targetMonth ||
  (existing.targetDate ? String(existing.targetDate).slice(0, 7) : '');
await env.DB.prepare(
  `UPDATE ideas SET type=?, title=?, notes=?, links=?, attachments=?, inspiration=?, createdBy=?, targetDate=?, targetMonth=? WHERE id=?`
).bind(
b.type ?? existing.type,
b.title ?? existing.title,
b.notes ?? existing.notes,
str(b.links ?? parseJson(existing.links)),
str(b.attachments ?? parseJson(existing.attachments)),
b.inspiration ?? existing.inspiration,
b.createdBy ?? existing.createdBy,
b.targetDate ?? existing.targetDate,
nextTargetMonth,
id
).run();
return ok({ ok: true });
};

export const onRequestDelete = async ({ request, env }: { request: Request; env: any }) => {
const auth = await authorizeRequest(request, env);
if (!auth.ok) return ok({ error: auth.error }, auth.status);
const url = new URL(request.url);
const id = url.searchParams.get('id');
if (!id) return ok({ error: 'Missing id' }, 400);
await env.DB.prepare('DELETE FROM ideas WHERE id=?').bind(id).run();
return ok({ ok: true });
};
