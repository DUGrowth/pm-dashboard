// Notification proxy: supports Teams webhook plus email (Brevo with MailChannels fallback)

import { authorizeRequest } from './_auth';

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

type TeamsPayload = { teamsWebhookUrl?: string; message?: string };
type EmailPayload = {
  to?: string[];
  approvers?: string[];
  subject?: string;
  text?: string;
  html?: string;
};

const hostMatches = (host: string, candidate: string) =>
  host === candidate || host.endsWith(`.${candidate}`);

const allowedDomainList = (value: string | undefined) =>
  (value ? String(value) : '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const isAllowedTeamsWebhook = (url: string, env: any) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    const configured = allowedDomainList(env.TEAMS_WEBHOOK_ALLOW_LIST);
    if (configured.length) return configured.some((domain) => hostMatches(host, domain));
    return ['office.com', 'office365.com'].some((domain) => hostMatches(host, domain));
  } catch {
    return false;
  }
};

const parseDirectory = (value: unknown) => {
  if (!value || typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return {};
    const directory: Record<string, string> = {};
    Object.entries(parsed as Record<string, any>).forEach(([key, email]) => {
      if (typeof key !== 'string' || typeof email !== 'string') return;
      const normalizedKey = key.trim().toLowerCase();
      const normalizedEmail = email.trim();
      if (normalizedKey && normalizedEmail.includes('@')) directory[normalizedKey] = normalizedEmail;
    });
    return directory;
  } catch {
    return {};
  }
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const resolveRecipients = (body: EmailPayload, env: any) => {
  const rawInputs = Array.isArray(body.to) ? body.to : [];
  const directory = parseDirectory(env.APPROVER_DIRECTORY);
  const approverNames = Array.isArray(body.approvers) ? body.approvers : [];
  const approverEmails = approverNames
    .map((name) => {
      if (typeof name !== 'string') return '';
      const normalized = name.trim().toLowerCase();
      return normalized ? directory[normalized] || directory[name.trim()] : '';
    })
    .filter(Boolean);
  const resolvedDirect = rawInputs
    .map((value) => {
      if (typeof value !== 'string') return '';
      const trimmed = value.trim();
      if (!trimmed) return '';
      if (trimmed.includes('@')) return trimmed;
      const normalized = trimmed.toLowerCase();
      return directory[normalized] || directory[trimmed] || '';
    })
    .filter(Boolean);
  const envTo =
    typeof env.MAIL_TO === 'string' && env.MAIL_TO
      ? env.MAIL_TO.split(',').map((entry: string) => entry.trim())
      : [];
  const combined = [...resolvedDirect, ...approverEmails, ...envTo]
    .map((email) => (typeof email === 'string' ? email.trim() : ''))
    .filter((email) => email && email.includes('@'));
  const unique = Array.from(new Set(combined.map(normalizeEmail)));
  return unique;
};

const sendViaBrevo = async ({
  to,
  subject,
  text,
  html,
  env,
}: {
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  env: any;
}) => {
  const apiKey = env.BREVO_API_KEY || env.BREVO_API_TOKEN;
  if (!apiKey) return { ok: false, reason: 'missing_api_key' };
  const senderEmail = env.BREVO_SENDER_EMAIL || env.MAIL_FROM || 'no-reply@example.com';
  const senderName = env.BREVO_SENDER_NAME || env.MAIL_FROM_NAME || 'PM Dashboard';
  const endpoint = env.BREVO_API_BASE || 'https://api.brevo.com/v3/smtp/email';
  const payload: Record<string, any> = {
    sender: { email: senderEmail, name: senderName },
    to: to.map((email) => ({ email })),
    subject,
  };
  if (html) payload.htmlContent = String(html);
  if (text) payload.textContent = String(text);
  if (!payload.htmlContent && !payload.textContent) payload.textContent = 'Notification';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status };
};

const sendViaMailChannels = async ({
  to,
  subject,
  text,
  html,
  env,
}: {
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  env: any;
}) => {
  const fromEmail = env.MAIL_FROM || 'no-reply@example.com';
  const fromName = env.MAIL_FROM_NAME || 'PM Dashboard';
  const content: any[] = [];
  if (text) content.push({ type: 'text/plain', value: String(text) });
  if (html) content.push({ type: 'text/html', value: String(html) });
  if (!content.length) content.push({ type: 'text/plain', value: 'Notification' });
  const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: to.map((email) => ({ email })) }],
      from: { email: fromEmail, name: fromName },
      subject,
      content,
    }),
  });
  return { ok: res.ok, status: res.status };
};

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = authorizeRequest(request, env);
  if (!auth.ok) return ok({ error: auth.error }, auth.status);
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== 'object') return ok({ error: 'Invalid JSON' }, 400);

  const results: any = {};

  // Teams webhook
  if (b.teamsWebhookUrl && typeof b.teamsWebhookUrl === 'string') {
    if (!isAllowedTeamsWebhook(b.teamsWebhookUrl, env)) {
      results.teams = 'rejected';
    } else {
      try {
        const res = await fetch(b.teamsWebhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: String(b.message || 'Notification') }),
        });
        results.teams = res.ok ? 'sent' : `http_${res.status}`;
      } catch (e: any) {
        results.teams = 'error';
      }
    }
  }

  // Email via Brevo (fallback to MailChannels)
  const recipients = resolveRecipients(b, env);
  if (recipients.length && (b.subject || b.text || b.html)) {
    const subject = String(b.subject || 'Notification');
    try {
      const emailResult =
        env.BREVO_API_KEY || env.BREVO_API_TOKEN
          ? await sendViaBrevo({ to: recipients, subject, text: b.text, html: b.html, env })
          : await sendViaMailChannels({ to: recipients, subject, text: b.text, html: b.html, env });
      results.email = emailResult.ok ? 'sent' : `http_${emailResult.status || emailResult.reason || 'error'}`;
    } catch {
      results.email = 'error';
    }
  }

  return ok({ ok: true, results });
};
