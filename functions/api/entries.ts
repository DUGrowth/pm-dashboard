import { authorizeRequest } from './_auth';

const ok = (data: unknown, status = 200) =>
new Response(JSON.stringify(data), {
status,
headers: { 'content-type': 'application/json' },
});

const uuid = () => (crypto?.randomUUID?.() ?? (Math.random().toString(36).slice(2) + Date.now().toString(36)));

const nowIso = () => new Date().toISOString();

const str = (v: any) => JSON.stringify(v ?? null);

const parseJson = (s: string | null | undefined) => {
try { return s ? JSON.parse(s) : undefined; } catch { return undefined; }
};

const inflate = (row: any) => {
if (!row) return row;
return {
...row,
platforms: parseJson(row.platforms) ?? [],
platformCaptions: parseJson(row.platformCaptions) ?? {},
approvers: parseJson(row.approvers) ?? [],
checklist: parseJson(row.checklist) ?? {},
analytics: parseJson(row.analytics) ?? {},
aiFlags: parseJson(row.aiFlags) ?? [],
aiScore: parseJson(row.aiScore) ?? {},
};
};

async function logAudit(env: any, user: string, entryId: string, action: string, meta: any = {}) {
const id = uuid();
const ts = nowIso();
await env.DB.prepare(
'INSERT INTO audit (id,ts,user,entryId,action,meta) VALUES (?,?,?,?,?,?)'
).bind(id, ts, user || 'Unknown', entryId || '', action || '', JSON.stringify(meta)).run();
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
const auth = authorizeRequest(request, env);
if (!auth.ok) return ok({ error: auth.error }, auth.status);
const url = new URL(request.url);
const id = url.searchParams.get('id');
const month = url.searchParams.get('month'); // YYYY-MM
const includeDeleted = url.searchParams.get('includeDeleted') === '1';

if (id) {
const row = await env.DB.prepare('SELECT * FROM entries WHERE id=?').bind(id).first();
return ok(inflate(row) || null);
}

let stmt = 'SELECT * FROM entries';
const binds: any[] = [];
const conds: string[] = [];
if (month) {
conds.push('substr(date,1,7)=?');
binds.push(month);
}
if (!includeDeleted) {
conds.push('(deletedAt IS NULL OR deletedAt="")');
}
if (conds.length) stmt += ' WHERE ' + conds.join(' AND ');
stmt += ' ORDER BY date ASC';

const { results } = await env.DB.prepare(stmt).bind(...binds).all();
return ok((results || []).map(inflate));
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
const auth = authorizeRequest(request, env);
if (!auth.ok) return ok({ error: auth.error }, auth.status);
const b = await request.json().catch(() => null);
if (!b || typeof b.date !== 'string') return ok({ error: 'Invalid JSON' }, 400);
const entryId = b.id || uuid();
const createdAt = nowIso();
const updatedAt = createdAt;
const authorName =
  typeof b.author === 'string' && b.author.trim()
    ? b.author.trim()
    : typeof b.user === 'string' && b.user.trim()
    ? b.user.trim()
    : 'Unknown';
await env.DB.prepare(
  `INSERT INTO entries (id,date,platforms,assetType,caption,platformCaptions,firstComment,status,approvers,author,campaign,contentPillar,previewUrl,checklist,analytics,workflowStatus,statusDetail,aiFlags,aiScore,testingFrameworkId,testingFrameworkName,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
).bind(
entryId,
b.date,
str(b.platforms),
b.assetType || 'Design',
b.caption || '',
str(b.platformCaptions),
b.firstComment || '',
b.status || 'Pending',
str(b.approvers),
authorName,
b.campaign || '',
b.contentPillar || '',
b.previewUrl || '',
str(b.checklist),
str(b.analytics),
b.workflowStatus || 'Draft',
b.statusDetail || '',
str(b.aiFlags),
str(b.aiScore),
b.testingFrameworkId || '',
b.testingFrameworkName || '',
createdAt,
updatedAt
).run();
const actorName = b.user || auth.user.name || auth.user.email;
await logAudit(env, actorName, entryId, 'create', { date: b.date });
return ok({ id: entryId });
};

export const onRequestPut = async ({ request, env }: { request: Request; env: any }) => {
const auth = authorizeRequest(request, env);
if (!auth.ok) return ok({ error: auth.error }, auth.status);
const url = new URL(request.url);
const id = url.searchParams.get('id');
if (!id) return ok({ error: 'Missing id' }, 400);
const b = await request.json().catch(() => null);
if (!b) return ok({ error: 'Invalid JSON' }, 400);

const existing = await env.DB.prepare('SELECT * FROM entries WHERE id=?').bind(id).first();
if (!existing) return ok({ error: 'Not found' }, 404);
const wasApproved = existing.status === 'Approved';

const updatedAt = nowIso();
let status = b.status ?? existing.status ?? 'Pending';
let approvedAt = b.approvedAt ?? existing.approvedAt ?? null;

const hasField = (field: string) => Object.prototype.hasOwnProperty.call(b, field);
const contentChanged =
(hasField('caption') && b.caption !== existing.caption) ||
(hasField('platformCaptions') && str(b.platformCaptions) !== existing.platformCaptions) ||
(hasField('firstComment') && b.firstComment !== existing.firstComment);

if (wasApproved && contentChanged) {
status = 'Pending';
approvedAt = null;
}

await env.DB.prepare(
  `UPDATE entries SET date=?, platforms=?, assetType=?, caption=?, platformCaptions=?, firstComment=?, status=?, approvers=?, author=?, campaign=?, contentPillar=?, previewUrl=?, checklist=?, analytics=?, workflowStatus=?, statusDetail=?, aiFlags=?, aiScore=?, testingFrameworkId=?, testingFrameworkName=?, updatedAt=?, approvedAt=? WHERE id=?`
).bind(
b.date ?? existing.date,
str(b.platforms ?? parseJson(existing.platforms)),
b.assetType ?? existing.assetType,
b.caption ?? existing.caption,
str(b.platformCaptions ?? parseJson(existing.platformCaptions)),
b.firstComment ?? existing.firstComment,
status,
str(b.approvers ?? parseJson(existing.approvers)),
typeof b.author === 'string' && b.author.trim()
  ? b.author.trim()
  : (existing.author && typeof existing.author === 'string' && existing.author.trim()
      ? existing.author.trim()
      : existing.author) || 'Unknown',
b.campaign ?? existing.campaign,
b.contentPillar ?? existing.contentPillar,
b.previewUrl ?? existing.previewUrl,
str(b.checklist ?? parseJson(existing.checklist)),
str(b.analytics ?? parseJson(existing.analytics)),
b.workflowStatus ?? existing.workflowStatus,
b.statusDetail ?? existing.statusDetail,
str(b.aiFlags ?? parseJson(existing.aiFlags)),
str(b.aiScore ?? parseJson(existing.aiScore)),
b.testingFrameworkId ?? existing.testingFrameworkId,
b.testingFrameworkName ?? existing.testingFrameworkName,
updatedAt,
approvedAt,
id
).run();

const actorName = b.user || auth.user.name || auth.user.email;
await logAudit(env, actorName, id, 'update', { contentChanged, status });
return ok({ ok: true, status, approvedAt });
};

export const onRequestDelete = async ({ request, env }: { request: Request; env: any }) => {
const auth = authorizeRequest(request, env);
if (!auth.ok) return ok({ error: auth.error }, auth.status);
const url = new URL(request.url);
const id = url.searchParams.get('id');
if (!id) return ok({ error: 'Missing id' }, 400);
const ts = nowIso();
await env.DB.prepare('UPDATE entries SET deletedAt=? WHERE id=?').bind(ts, id).run();
const actorName = auth.user.name || auth.user.email;
await logAudit(env, actorName, id, 'delete', {});
return ok({ ok: true });
};
