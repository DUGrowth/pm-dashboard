import { authorizeRequest } from './_auth';
import { generateToken, hashPassword, hashToken, randomId, verifyPassword } from '../lib/crypto';

const SESSION_COOKIE = 'pm_session';

const json = (data: unknown, status = 200, cookies?: string | string[]) => {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (cookies) {
    const list = Array.isArray(cookies) ? cookies : [cookies];
    list.filter(Boolean).forEach((cookie) => headers.append('set-cookie', cookie));
  }
  return new Response(JSON.stringify(data), { status, headers });
};

const sessionTtlSeconds = (env: any) => {
  const raw = Number(env.SESSION_TTL_SECONDS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 60 * 60 * 24 * 7;
};

const cookieString = (token: string, maxAge: number) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const getIP = (req: Request) =>
  (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'anon').toString();

const sessionUserAgent = (req: Request) => req.headers.get('user-agent') || '';

const createSession = async (request: Request, env: any, userId: string) => {
  const ttl = sessionTtlSeconds(env);
  const token = generateToken(32);
  const tokenHash = await hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (id,userId,tokenHash,createdAt,expiresAt,userAgent,ip) VALUES (?,?,?,?,?,?,?)',
  )
    .bind(
      randomId('ses_'),
      userId,
      tokenHash,
      now.toISOString(),
      expiresAt,
      sessionUserAgent(request).slice(0, 255),
      getIP(request),
    )
    .run();
  return { token, ttl };
};

export const onRequestPut = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON' }, 400);
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!newPassword || newPassword.length < 8) {
    return json({ error: 'New password must be at least 8 characters.' }, 400);
  }
  const row = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(auth.user.id).first();
  if (!row) return json({ error: 'User not found' }, 404);
  if (row.status === 'disabled') return json({ error: 'Account disabled' }, 403);
  if (row.passwordHash) {
    if (!currentPassword) return json({ error: 'Current password required' }, 400);
    const valid = await verifyPassword(currentPassword, row.passwordHash);
    if (!valid) return json({ error: 'Current password is incorrect' }, 400);
  }
  const hashed = await hashPassword(newPassword);
  const now = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE users SET passwordHash=?, status=?, inviteToken=NULL, inviteExpiresAt=NULL, updatedAt=? WHERE id=?',
  )
    .bind(hashed, 'active', now, row.id)
    .run();
  await env.DB.prepare('DELETE FROM sessions WHERE userId=?').bind(row.id).run();
  const session = await createSession(request, env, row.id);
  return json({ ok: true, hasPassword: true }, 200, cookieString(session.token, session.ttl));
};
