import { hashToken, randomId } from '../lib/crypto';

const EMAIL_HEADERS = [
  'cf-access-verified-email',
  'cf-access-authenticated-user-email',
  'x-user-email',
  'x-dev-user',
];

const NAME_HEADERS = [
  'cf-access-verified-user',
  'cf-access-authenticated-user-name',
  'x-user-name',
  'x-dev-user-name',
];

const SESSION_COOKIE = 'pm_session';

const headerValue = (request: Request, names: string[]) => {
  for (const name of names) {
    const value = request.headers.get(name);
    if (value && value.trim()) return value.trim();
  }
  return '';
};

const toSet = (value: string | undefined | null) => {
  if (!value) return new Set<string>();
  return new Set(
    String(value)
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
};

const parseFeatures = (value: string | null | undefined) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry) => typeof entry === 'string');
    }
  } catch {
    // ignore
  }
  return [];
};

const rowToUser = (row: any) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  isAdmin: Boolean(row.isAdmin),
  status: row.status || 'pending',
  features: parseFeatures(row.features),
});

const parseCookies = (header: string | null) => {
  if (!header) return {};
  return header.split(';').reduce<Record<string, string>>((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
};

const ensureUserForAccess = async (env: any, email: string, name: string) => {
  const normalized = email.toLowerCase();
  const existing = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(normalized).first();
  if (existing) return rowToUser(existing);
  if (env.ACCESS_AUTO_PROVISION === '0') return null;
  const now = new Date().toISOString();
  const isAdmin = toSet(env.ADMIN_EMAILS || env.ACCESS_ALLOWED_EMAILS).has(normalized) ? 1 : 0;
  const id = randomId('usr_');
  await env.DB.prepare(
    'INSERT INTO users (id,email,name,status,isAdmin,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)',
  )
    .bind(id, normalized, name || email, 'active', isAdmin, now, now)
    .run();
  const row = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
  return rowToUser(row);
};

const authorizeViaSession = async (request: Request, env: any) => {
  const cookies = parseCookies(request.headers.get('cookie'));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const session = await env.DB.prepare('SELECT * FROM sessions WHERE tokenHash=?').bind(tokenHash).first();
  if (!session) return null;
  if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(session.id).run();
    return null;
  }
  const user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(session.userId).first();
  if (!user || user.status === 'disabled') return null;
  return rowToUser(user);
};

const authorizeViaAccess = async (request: Request, env: any) => {
  const rawEmail = headerValue(request, EMAIL_HEADERS);
  const normalizedEmail = rawEmail.toLowerCase();
  if (!normalizedEmail) return null;

  const allowed = toSet(env.ACCESS_ALLOWED_EMAILS);
  if (allowed.size && !allowed.has(normalizedEmail)) {
    return { error: 'Forbidden', status: 403 };
  }

  const name = headerValue(request, NAME_HEADERS) || rawEmail;
  const user = await ensureUserForAccess(env, normalizedEmail, name);
  if (!user) return null;
  if (user.status === 'disabled') {
    return { error: 'Forbidden', status: 403 };
  }
  return user;
};

type AuthSuccess = {
  ok: true;
  user: { id: string; email: string; name: string; isAdmin: boolean; features: string[]; status: string };
};
type AuthFailure = { ok: false; status: number; error: string };

export async function authorizeRequest(request: Request, env: any): Promise<AuthSuccess | AuthFailure> {
  if (env.ALLOW_UNAUTHENTICATED === '1' || env.ACCESS_ALLOW_UNAUTHENTICATED === '1') {
    const email = env.DEV_AUTH_EMAIL || 'dev@example.com';
    const name = env.DEV_AUTH_NAME || 'Dev User';
    return {
      ok: true,
      user: {
        id: 'dev',
        email,
        name,
        isAdmin: true,
        status: 'active',
        features: ['admin', 'calendar', 'ideas', 'testing', 'approvals', 'kanban'],
      },
    };
  }

  const sessionUser = await authorizeViaSession(request, env);
  if (sessionUser) {
    return { ok: true, user: sessionUser };
  }

  const accessUser = await authorizeViaAccess(request, env);
  if (accessUser && !('error' in accessUser)) {
    return { ok: true, user: accessUser };
  }
  if (accessUser && 'error' in accessUser) {
    return { ok: false, status: accessUser.status, error: accessUser.error };
  }

  return { ok: false, status: 401, error: 'Unauthorized' };
}
