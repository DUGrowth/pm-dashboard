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

type AuthSuccess = { ok: true; user: { email: string; name: string } };
type AuthFailure = { ok: false; status: number; error: string };

export function authorizeRequest(request: Request, env: any): AuthSuccess | AuthFailure {
  if (env.ALLOW_UNAUTHENTICATED === '1' || env.ACCESS_ALLOW_UNAUTHENTICATED === '1') {
    const email = env.DEV_AUTH_EMAIL || 'dev@example.com';
    const name = env.DEV_AUTH_NAME || 'Dev User';
    return { ok: true, user: { email, name } };
  }

  const rawEmail = headerValue(request, EMAIL_HEADERS);
  const normalizedEmail = rawEmail.toLowerCase();
  if (!normalizedEmail) return { ok: false, status: 401, error: 'Unauthorized' };

  const allowed = toSet(env.ACCESS_ALLOWED_EMAILS);
  if (allowed.size && !allowed.has(normalizedEmail)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  const name = headerValue(request, NAME_HEADERS) || rawEmail;
  return { ok: true, user: { email: rawEmail, name } };
}
