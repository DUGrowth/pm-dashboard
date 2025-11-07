type IdeaStatus = 'Backlog' | 'In Progress' | 'Ready' | 'Archived';

type Idea = {
  id: string;
  type?: string;
  title: string;
  notes?: string;
  links?: string[];
  attachments?: string[];
  inspirationTags?: string[];
  status: IdeaStatus;
  createdAt: string;
  updatedAt: string;
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

function ensureDb(env: any) {
  const db = env?.DB;
  if (!db) throw new Error('D1 binding DB not configured');
  return db;
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const headers = corsHeaders(request.headers.get('origin'));
  try {
    const db = ensureDb(env);
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    let sql = `SELECT * FROM ideas`;
    const binds: any[] = [];
    if (status) {
      sql += ` WHERE status = ?`;
      binds.push(status);
    }
    sql += ` ORDER BY createdAt DESC LIMIT 500`;
    const result = await db.prepare(sql).bind(...binds).all();
    return new Response(JSON.stringify({ items: result.results || [] }), { status: 200, headers });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Server error' }), { status: err.message ? 400 : 500, headers });
  }
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const headers = corsHeaders(request.headers.get('origin'));
  let payload: Partial<Idea>;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }
  if (!payload.title) {
    return new Response(JSON.stringify({ error: 'title required' }), { status: 400, headers });
  }
  try {
    const db = ensureDb(env);
    const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    const now = new Date().toISOString();
    const sql = `INSERT INTO ideas (
      id,type,title,notes,links,attachments,inspirationTags,status,createdAt,updatedAt
    ) VALUES (?,?,?,?,?,?,?,?,?,?)`;
    await db.prepare(sql).bind(
      id,
      payload.type || null,
      payload.title,
      payload.notes || null,
      JSON.stringify(payload.links || []),
      JSON.stringify(payload.attachments || []),
      JSON.stringify(payload.inspirationTags || []),
      payload.status || 'Backlog',
      now,
      now
    ).run();
    return new Response(JSON.stringify({ id, createdAt: now }), { status: 201, headers });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Server error' }), { status: 500, headers });
  }
};

export const onRequestPut: PagesFunction = async ({ request, env }) => {
  const headers = corsHeaders(request.headers.get('origin'));
  let payload: Partial<Idea> & { id?: string };
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }
  if (!payload.id) {
    return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers });
  }
  try {
    const db = ensureDb(env);
    const sql = `UPDATE ideas SET
      type = COALESCE(?, type),
      title = COALESCE(?, title),
      notes = COALESCE(?, notes),
      links = COALESCE(?, links),
      attachments = COALESCE(?, attachments),
      inspirationTags = COALESCE(?, inspirationTags),
      status = COALESCE(?, status),
      updatedAt = ?
    WHERE id = ?`;
    const updatedAt = new Date().toISOString();
    await db.prepare(sql).bind(
      payload.type || null,
      payload.title || null,
      payload.notes || null,
      payload.links ? JSON.stringify(payload.links) : null,
      payload.attachments ? JSON.stringify(payload.attachments) : null,
      payload.inspirationTags ? JSON.stringify(payload.inspirationTags) : null,
      payload.status || null,
      updatedAt,
      payload.id
    ).run();
    return new Response(JSON.stringify({ id: payload.id, updatedAt }), { status: 200, headers });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Server error' }), { status: 500, headers });
  }
};

export const onRequestDelete: PagesFunction = async ({ request, env }) => {
  const headers = corsHeaders(request.headers.get('origin'));
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers });
  try {
    const db = ensureDb(env);
    await db.prepare(`DELETE FROM ideas WHERE id = ?`).bind(id).run();
    return new Response(JSON.stringify({ id }), { status: 200, headers });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Server error' }), { status: 500, headers });
  }
};

