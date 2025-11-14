import { authorizeRequest } from './_auth';

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const mapRow = (row: any) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  avatarUrl: row.avatarUrl || null,
});

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return ok({ error: auth.error }, auth.status);
  const { results } = await env.DB.prepare(
    'SELECT id,name,email,avatarUrl FROM users WHERE isApprover=1 AND status != "disabled" ORDER BY name COLLATE NOCASE',
  ).all();
  return ok((results || []).map(mapRow));
};
