import { authorizeRequest } from './_auth';

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const sanitizeUser = (row: any) => {
  const parseFeatures = () => {
    try {
      const parsed = JSON.parse(row.features || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isAdmin: Boolean(row.isAdmin),
    isApprover: Boolean(row.isApprover),
    features: parseFeatures(),
    avatarUrl: row.avatarUrl || null,
    hasPassword: Boolean(row.passwordHash),
  };
};

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return ok({ error: auth.error }, auth.status);
  return ok({
    id: auth.user.id,
    email: auth.user.email,
    name: auth.user.name,
    isAdmin: auth.user.isAdmin,
    isApprover: Boolean(auth.user.isApprover),
    features: auth.user.features,
    avatarUrl: auth.user.avatarUrl || null,
    hasPassword: Boolean(auth.user.hasPassword),
    ts: new Date().toISOString(),
  });
};

const MAX_AVATAR_LENGTH = 400000; // ~200KB base64

export const onRequestPut = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return ok({ error: auth.error }, auth.status);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return ok({ error: 'Invalid JSON' }, 400);
  const updates: string[] = [];
  const bindings: any[] = [];
  if (typeof body.name === 'string' && body.name.trim()) {
    updates.push('name=?');
    bindings.push(body.name.trim());
  }
  if (Object.prototype.hasOwnProperty.call(body, 'avatar')) {
    if (body.avatar === null || body.avatar === '') {
      updates.push('avatarUrl=?');
      bindings.push(null);
    } else if (typeof body.avatar === 'string') {
      if (body.avatar.length > MAX_AVATAR_LENGTH) {
        return ok({ error: 'Avatar too large. Please upload an image under 200KB.' }, 400);
      }
      updates.push('avatarUrl=?');
      bindings.push(body.avatar);
    }
  }
  if (!updates.length) return ok({ error: 'No changes requested.' }, 400);
  updates.push('updatedAt=?');
  bindings.push(new Date().toISOString(), auth.user.id);
  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id=?`).bind(...bindings).run();
  const row = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(auth.user.id).first();
  if (!row) return ok({ error: 'User not found' }, 404);
  return ok({ ok: true, user: sanitizeUser(row) });
};
