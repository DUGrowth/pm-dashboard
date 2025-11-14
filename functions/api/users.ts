import { authorizeRequest } from './_auth';
import { generateToken, randomId } from '../lib/crypto';
import { sendEmail } from '../lib/email';

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const ensureArrayOfStrings = (value: any) => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
};

const serializeUser = (row: any) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  status: row.status,
  isAdmin: Boolean(row.isAdmin),
  isApprover: Boolean(row.isApprover),
  avatarUrl: row.avatarUrl || null,
  features: (() => {
    try {
      const parsed = JSON.parse(row.features || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })(),
  invitePending: Boolean(row.inviteToken),
  inviteExpiresAt: row.inviteExpiresAt || null,
  lastLoginAt: row.lastLoginAt || null,
  createdAt: row.createdAt || null,
});

const inviteTtlMs = (env: any) => {
  const raw = Number(env.INVITE_TTL_HOURS);
  if (Number.isFinite(raw) && raw > 0) return raw * 3600 * 1000;
  return 1000 * 60 * 60 * 24 * 7; // 7 days
};

const inviteLink = (request: Request, token: string) => {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}?invite=${encodeURIComponent(token)}`;
};

const sendInvite = async ({
  request,
  env,
  email,
  name,
  token,
}: {
  request: Request;
  env: any;
  email: string;
  name: string;
  token: string;
}) => {
  const link = inviteLink(request, token);
  const subject = 'You have been invited to the PM Dashboard';
  const text = `Hi ${name || email},

You've been invited to the Population Matters PM Dashboard. Click the link below to set your password and access the workspace:

${link}

If you weren't expecting this invitation, please contact the communications team.`;
  await sendEmail({ env, to: [email], subject, text });
};

const requireAdmin = (auth: any) => {
  if (!auth.user.isAdmin) return { ok: false, response: ok({ error: 'Forbidden' }, 403) as Response };
  return { ok: true };
};

const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const deleteSessionsForUser = async (env: any, userId: string) => {
  await env.DB.prepare('DELETE FROM sessions WHERE userId=?').bind(userId).run();
};

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return ok({ error: auth.error }, auth.status);
  const gate = requireAdmin(auth);
  if (!gate.ok) return gate.response;
  const { results } = await env.DB.prepare(
    'SELECT id,email,name,status,isAdmin,isApprover,avatarUrl,features,inviteToken,inviteExpiresAt,lastLoginAt,createdAt FROM users ORDER BY createdAt DESC',
  ).all();
  return ok((results || []).map(serializeUser));
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return ok({ error: auth.error }, auth.status);
  const gate = requireAdmin(auth);
  if (!gate.ok) return gate.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return ok({ error: 'Invalid JSON' }, 400);
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
  if (!name || !email || !emailRegex.test(email)) return ok({ error: 'Name and valid email required' }, 400);
  const features = ensureArrayOfStrings(body.features);
  const isAdmin = Boolean(body.isAdmin);
  const isApprover = Boolean(body.isApprover);
  const existing = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + inviteTtlMs(env)).toISOString();
  const now = new Date().toISOString();
  if (existing) {
    if (existing.status !== 'disabled') return ok({ error: 'User already exists' }, 409);
    await env.DB.prepare(
      'UPDATE users SET name=?, features=?, status=?, isAdmin=?, isApprover=?, inviteToken=?, inviteExpiresAt=?, updatedAt=? WHERE id=?',
    )
      .bind(name, JSON.stringify(features), 'pending', isAdmin ? 1 : 0, isApprover ? 1 : 0, token, expiresAt, now, existing.id)
      .run();
    await sendInvite({ request, env, email, name, token });
    const row = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(existing.id).first();
    return ok(serializeUser(row));
  }
  const id = randomId('usr_');
  await env.DB.prepare(
    'INSERT INTO users (id,email,name,features,status,isAdmin,isApprover,inviteToken,inviteExpiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(id, email, name, JSON.stringify(features), 'pending', isAdmin ? 1 : 0, isApprover ? 1 : 0, token, expiresAt, now, now)
    .run();
  await sendInvite({ request, env, email, name, token });
  const row = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
  return ok(serializeUser(row), 201);
};

export const onRequestPut = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return ok({ error: auth.error }, auth.status);
  const gate = requireAdmin(auth);
  if (!gate.ok) return gate.response;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return ok({ error: 'Missing id' }, 400);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return ok({ error: 'Invalid JSON' }, 400);
  const existing = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
  if (!existing) return ok({ error: 'Not found' }, 404);
  const updates: string[] = [];
  const binds: any[] = [];
  if (typeof body.name === 'string' && body.name.trim()) {
    updates.push('name=?');
    binds.push(body.name.trim());
  }
  if (body.features) {
    updates.push('features=?');
    binds.push(JSON.stringify(ensureArrayOfStrings(body.features)));
  }
  if (typeof body.isAdmin === 'boolean') {
    updates.push('isAdmin=?');
    binds.push(body.isAdmin ? 1 : 0);
  }
  if (typeof body.isApprover === 'boolean') {
    updates.push('isApprover=?');
    binds.push(body.isApprover ? 1 : 0);
  }
  if (typeof body.status === 'string') {
    const normalizedStatus = ['pending', 'active', 'disabled'].includes(body.status) ? body.status : null;
    if (normalizedStatus) {
      updates.push('status=?');
      binds.push(normalizedStatus);
      if (normalizedStatus === 'disabled') await deleteSessionsForUser(env, id);
    }
  }
  let inviteResent = false;
  if (body.resendInvite) {
    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + inviteTtlMs(env)).toISOString();
    updates.push('inviteToken=?');
    binds.push(token);
    updates.push('inviteExpiresAt=?');
    binds.push(expiresAt);
    inviteResent = true;
    await sendInvite({ request, env, email: existing.email, name: existing.name, token });
  }
  if (!updates.length) return ok({ ok: true, user: serializeUser(existing), inviteResent });
  updates.push('updatedAt=?');
  binds.push(new Date().toISOString(), id);
  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id=?`).bind(...binds).run();
  const row = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
  return ok({ ok: true, user: serializeUser(row), inviteResent });
};

export const onRequestDelete = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return ok({ error: auth.error }, auth.status);
  const gate = requireAdmin(auth);
  if (!gate.ok) return gate.response;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return ok({ error: 'Missing id' }, 400);
  const existing = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
  if (!existing) return ok({ error: 'Not found' }, 404);
  await deleteSessionsForUser(env, id);
  await env.DB.prepare(
    'UPDATE users SET status="disabled", inviteToken=NULL, inviteExpiresAt=NULL, updatedAt=? WHERE id=?',
  )
    .bind(new Date().toISOString(), id)
    .run();
  return ok({ ok: true });
};
