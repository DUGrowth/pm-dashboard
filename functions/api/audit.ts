const ok = (data: unknown, status = 200) =>
new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
const url = new URL(request.url);
const entryId = url.searchParams.get('entryId');
const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 100)));
let stmt = 'SELECT * FROM audit';
const binds: any[] = [];
if (entryId) { stmt += ' WHERE entryId=?'; binds.push(entryId); }
stmt += ' ORDER BY ts DESC LIMIT ?';
binds.push(limit);
const { results } = await env.DB.prepare(stmt).bind(...binds).all();
return ok(results || []);
};

