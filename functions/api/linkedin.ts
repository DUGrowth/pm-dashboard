import { authorizeRequest } from './_auth';

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const uuid = () => crypto?.randomUUID?.() ?? (Math.random().toString(36).slice(2) + Date.now().toString(36));
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
  const month = url.searchParams.get('month'); // YYYY-MM on targetDate
  if (id) {
    const row = await env.DB.prepare('SELECT * FROM linkedin_submissions WHERE id=?').bind(id).first();
    return ok(inflate(row) || null);
  }
  let stmt = 'SELECT * FROM linkedin_submissions';
  const binds: any[] = [];
  const conds: string[] = [];
  if (month) { conds.push('substr(targetDate,1,7)=?'); binds.push(month); }
  if (conds.length) stmt += ' WHERE ' + conds.join(' AND ');
  stmt += ' ORDER BY createdAt DESC';
  const { results } = await env.DB.prepare(stmt).bind(...binds).all();
  return ok((results || []).map(inflate));
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return ok({ error: auth.error }, auth.status);
  const b = await request.json().catch(() => null);
  if (!b || typeof b.title !== 'string') return ok({ error: 'Invalid JSON' }, 400);
  const id = b.id || uuid();
  const createdAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO linkedin_submissions (id,submissionType,status,title,postCopy,comments,owner,submitter,links,attachments,targetDate,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, b.submissionType || 'My own account', b.status || 'Draft', b.title, b.postCopy || '', b.comments || '',
    b.owner || '', b.submitter || '', str(b.links), str(b.attachments), b.targetDate || '', createdAt, createdAt
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
  const existing = await env.DB.prepare('SELECT * FROM linkedin_submissions WHERE id=?').bind(id).first();
  if (!existing) return ok({ error: 'Not found' }, 404);
  const updatedAt = nowIso();
  await env.DB.prepare(
    `UPDATE linkedin_submissions SET submissionType=?, status=?, title=?, postCopy=?, comments=?, owner=?, submitter=?, links=?, attachments=?, targetDate=?, updatedAt=? WHERE id=?`
  ).bind(
    b.submissionType ?? existing.submissionType,
    b.status ?? existing.status,
    b.title ?? existing.title,
    b.postCopy ?? existing.postCopy,
    b.comments ?? existing.comments,
    b.owner ?? existing.owner,
    b.submitter ?? existing.submitter,
    str(b.links ?? parseJson(existing.links)),
    str(b.attachments ?? parseJson(existing.attachments)),
    b.targetDate ?? existing.targetDate,
    updatedAt,
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
  await env.DB.prepare('DELETE FROM linkedin_submissions WHERE id=?').bind(id).run();
  return ok({ ok: true });
};
