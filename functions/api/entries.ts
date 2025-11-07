// Cloudflare Pages Function: /api/entries
// CRUD for entries backed by D1. All SQL strings are wrapped safely.

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

type EntrySummary = {
  id: string;
  date: string;
  assetType: AssetType;
  platforms: Platform[];
  caption: string;
  url?: string;
  approvers: string[];
  status: Approval;
};

type NotificationReason = 'created' | 'reopened';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

function parseJsonArray(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function hydrateEntry(row: any): EntrySummary {
  return {
    id: row.id,
    date: row.date,
    assetType: row.assetType,
    platforms: parseJsonArray(row.platforms) as Platform[],
    caption: row.caption || '',
    url: row.url || undefined,
    approvers: parseJsonArray(row.approvers) as string[],
    status: row.status as Approval,
  };
}

function loadApproverDirectory(env: any): Record<string, string> {
  const raw = env?.APPROVER_DIRECTORY;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    console.warn('APPROVER_DIRECTORY is not valid JSON');
    return {};
  }
}

async function notifyApprovers(env: any, entry: EntrySummary, reason: NotificationReason) {
  const apiKey = env?.BREVO_API_KEY;
  const senderEmail = env?.BREVO_SENDER_EMAIL;
  if (!apiKey || !senderEmail) return; // notifications disabled

  const senderName = env?.BREVO_SENDER_NAME || 'Content Dashboard';
  const directory = loadApproverDirectory(env);
  const recipients = entry.approvers
    .map((name) => ({ name, email: directory[name] }))
    .filter((x): x is { name: string; email: string } => Boolean(x.email));

  if (!recipients.length) return;

  const action = reason === 'created' ? 'needs your approval' : 'was updated and needs the review again';
  const subject = `Content (${entry.assetType}) ${action} for ${entry.date}`;
  const platforms = entry.platforms.length ? entry.platforms.join(', ') : 'Unspecified platforms';
  const htmlContent = `
    <p>Hello,</p>
    <p>A ${entry.assetType} scheduled for <strong>${entry.date}</strong> ${action}.</p>
    <p><strong>Platforms:</strong> ${platforms}</p>
    <p><strong>Caption:</strong></p>
    <blockquote>${entry.caption || 'No caption yet.'}</blockquote>
    ${entry.url ? `<p><strong>URL:</strong> <a href="${entry.url}">${entry.url}</a></p>` : ''}
    <p>Please review and approve in the Content Dashboard.</p>
  `;

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: recipients,
        subject,
        htmlContent,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('Brevo notification failed', res.status, text);
    }
  } catch (err) {
    console.error('Brevo notification error', err);
  }
}

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

  await notifyApprovers(env, {
    id,
    date: body.date,
    assetType: body.assetType,
    platforms: body.platforms,
    caption: body.caption || '',
    url: body.url || undefined,
    approvers: body.approvers || [],
    status,
  }, 'created');

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

  if (contentChanged && existing.status === 'Approved') {
    const refreshed = await db.prepare(`SELECT * FROM entries WHERE id = ?`).bind(body.id).first();
    if (refreshed) {
      await notifyApprovers(env, hydrateEntry(refreshed), 'reopened');
    }
  }

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
