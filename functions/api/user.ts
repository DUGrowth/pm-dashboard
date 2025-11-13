import { authorizeRequest } from './_auth';

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return ok({ error: auth.error }, auth.status);
  return ok({
    id: auth.user.id,
    email: auth.user.email,
    name: auth.user.name,
    isAdmin: auth.user.isAdmin,
    features: auth.user.features,
    ts: new Date().toISOString(),
  });
};
