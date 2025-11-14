// Notification proxy: supports Teams webhook plus email via Brevo (primary) or MailChannels (fallback)

import { authorizeRequest } from './_auth';
import { sendEmail } from '../lib/email';

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

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
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
      const result = await sendEmail({
        env,
        to: recipients,
        subject,
        text: b.text,
        html: b.html,
      });
      if (result.ok) {
        results.email = 'sent';
      } else if ('status' in result && typeof result.status === 'number') {
        results.email = `http_${result.status}`;
      } else if ('reason' in result && result.reason) {
        results.email = String(result.reason);
      } else {
        results.email = 'error';
      }
    } catch {
      results.email = 'error';
    }
  } else if (!recipients.length) {
    results.email = 'skipped_no_recipients';
  }

  return ok({ ok: true, results });
};
