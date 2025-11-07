type Platform =
  | 'Instagram'
  | 'Facebook'
  | 'LinkedIn'
  | 'X/Twitter'
  | 'TikTok'
  | 'YouTube'
  | 'Threads'
  | 'Pinterest';
type AssetType = 'Video' | 'Design' | 'Carousel';
type Approval = 'Pending' | 'Approved';

type Entry = {
  id: string;
  date: string; // YYYY-MM-DD
  approvers: string[];
  author?: string;
  platforms: Platform[];
  caption: string;
  url?: string;
  assetType: AssetType;
  script?: string;
  designCopy?: string;
  carouselSlides?: string[];
  firstComment?: string;
  status: Approval;
  approvedAt?: string;
  createdAt: string;
  deletedAt?: string;
};

function corsHeaders(origin?: string | null) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  } as Record<string, string>;
}

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const headers = corsHeaders(request.headers.get('origin'));
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const limit = Math.min(Number(url.searchParams.get('limit') || '200'), 500);
  const db = (env as any).DB as any;
  if (!db) return new Response(JSON.stringify({ error: 'D1 binding DB not configured' }), { status: 501, headers });

  let sql = `SELECT * FROM entries WHERE (deletedAt IS NULL)`;
  const binds: any[] = [];
  if (from) { sql += ` AND date >= ?`; binds.push(from); }
  if (to) { sql += ` AND date <= ?`; binds.push(to); }
  sql += ` ORDER BY date ASC LIMIT ?`; binds.push(limit);

  const result = await db.prepare(sql).bind(...binds).all();
  return new Response(JSON.stringify({ items: result.results || [] }), { status: 200, headers });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const headers = corsHeaders(request.headers.get('origin'));
  const db = (env as any).DB as any;
  if (!db) return new Response(JSON.stringify({ error: 'D1 binding DB not configured' }), { status: 501, headers });

  let body: Partial<Entry>;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }); }

  // Minimal validation
  if (!body || typeof body !== 'object' || !body.date || !body.assetType || !body.caption || !Array.isArray(body.platforms)) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers });
  }

  const id = crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now().toString(36));
  const createdAt = new Date().toISOString();
  const status: Approval = 'Pending';

  const sql = `INSERT INTO entries (
    id,date,approvers,author,platforms,caption,url,assetType,script,designCopy,carouselSlides,firstComment,status,approvedAt,createdAt,deletedAt
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

  const approvers = JSON.stringify(body.approvers || []);
  const platforms = JSON.stringify(body.platforms || []);
  const carouselSlides = JSON.stringify(body.carouselSlides || null);

  await db.prepare(sql).bind(
    id,
    body.date,
    approvers,
    body.author || null,
    platforms,
    body.caption || '',
    body.url || null,
    body.assetType,
    body.script || null,
    body.designCopy || null,
    carouselSlides,
    body.firstComment || null,
    status,
    null,
    createdAt,
    null
  ).run();

  return new Response(JSON.stringify({ id, createdAt, status }), { status: 201, headers });
};

export const onRequestPut: PagesFunction = async ({ request, env }) => {
  const headers = corsHeaders(request.headers.get('origin'));
  const db = (env as any).DB as any;
  if (!db) return new Response(JSON.stringify({ error: 'D1 binding DB not configured' }), { status: 501, headers });

  let body: Partial<Entry> & { id?: string };
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }); }
  if (!body.id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers });

  // Fetch existing to decide status revert
  const existing = await db.prepare(`SELECT * FROM entries WHERE id = ?`).bind(body.id).first();
  if (!existing) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });

  const contentChanged = (
    (body.caption !== undefined && body.caption !== existing.caption) ||
    (body.script !== undefined && body.script !== existing.script) ||
    (body.designCopy !== undefined && body.designCopy !== existing.designCopy) ||
    (body.carouselSlides !== undefined && JSON.stringify(body.carouselSlides) !== existing.carouselSlides) ||
    (body.platforms !== undefined && JSON.stringify(body.platforms) !== existing.platforms)
  );

  let nextStatus: Approval = existing.status as Approval;
  let approvedAt: string | null = existing.approvedAt || null;
  if (contentChanged && existing.status === 'Approved') {
    nextStatus = 'Pending';
    approvedAt = null;
  }

  const sql = `UPDATE entries SET
    date = COALESCE(?, date),
    approvers = COALESCE(?, approvers),
    author = COALESCE(?, author),
    platforms = COALESCE(?, platforms),
    caption = COALESCE(?, caption),
    url = COALESCE(?, url),
    assetType = COALESCE(?, assetType),
    script = COALESCE(?, script),
    designCopy = COALESCE(?, designCopy),
    carouselSlides = COALESCE(?, carouselSlides),
    firstComment = COALESCE(?, firstComment),
    status = ?,
    approvedAt = ?
  WHERE id = ?`;

  await db.prepare(sql).bind(
    body.date || null,
    body.approvers ? JSON.stringify(body.approvers) : null,
    body.author || null,
    body.platforms ? JSON.stringify(body.platforms) : null,
    body.caption || null,
    body.url || null,
    body.assetType || null,
    body.script || null,
    body.designCopy || null,
    body.carouselSlides ? JSON.stringify(body.carouselSlides) : null,
    body.firstComment || null,
    nextStatus,
    approvedAt,
    body.id
  ).run();

  return new Response(JSON.stringify({ id: body.id, status: nextStatus }), { status: 200, headers });
};

export const onRequestDelete: PagesFunction = async ({ request, env }) => {
  const headers = corsHeaders(request.headers.get('origin'));
  const db = (env as any).DB as any;
  if (!db) return new Response(JSON.stringify({ error: 'D1 binding DB not configured' }), { status: 501, headers });

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers });
  const deletedAt = new Date().toISOString();
  await db.prepare(`UPDATE entries SET deletedAt = ? WHERE id = ?`).bind(deletedAt, id).run();
  return new Response(JSON.stringify({ id, deletedAt }), { status: 200, headers });
};

