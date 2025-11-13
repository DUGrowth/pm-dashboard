import { authorizeRequest } from './_auth';

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const uuid = () => crypto?.randomUUID?.() ?? (Math.random().toString(36).slice(2) + Date.now().toString(36));
const nowIso = () => new Date().toISOString();

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return ok({ error: auth.error }, auth.status);
  const { results } = await env.DB.prepare('SELECT * FROM testing_frameworks ORDER BY createdAt DESC').all();
  return ok(results || []);
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return ok({ error: auth.error }, auth.status);
  const b = await request.json().catch(() => null);
  if (!b || typeof b.name !== 'string' || !b.name.trim()) return ok({ error: 'Invalid JSON' }, 400);
  const id = b.id || uuid();
  const createdAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO testing_frameworks (id,name,hypothesis,audience,metric,duration,status,notes,createdAt) VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, b.name.trim(), b.hypothesis || '', b.audience || '', b.metric || '', b.duration || '', b.status || 'Planned', b.notes || '', createdAt
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
  const existing = await env.DB.prepare('SELECT * FROM testing_frameworks WHERE id=?').bind(id).first();
  if (!existing) return ok({ error: 'Not found' }, 404);
  await env.DB.prepare(
    `UPDATE testing_frameworks SET name=?, hypothesis=?, audience=?, metric=?, duration=?, status=?, notes=? WHERE id=?`
  ).bind(
    b.name ?? existing.name,
    b.hypothesis ?? existing.hypothesis,
    b.audience ?? existing.audience,
    b.metric ?? existing.metric,
    b.duration ?? existing.duration,
    b.status ?? existing.status,
    b.notes ?? existing.notes,
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
  await env.DB.prepare('DELETE FROM testing_frameworks WHERE id=?').bind(id).run();
  return ok({ ok: true });
};
