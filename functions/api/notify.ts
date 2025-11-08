// Notification proxy: supports Teams webhook and optional email via MailChannels

import { authorizeRequest } from './_auth';

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

type TeamsPayload = { teamsWebhookUrl?: string; message: string };
type EmailPayload = { to: string[]; subject: string; text?: string; html?: string };

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

  // Email via MailChannels
  const providedTo = Array.isArray(b.to) ? b.to : [];
  const envTo = typeof env.MAIL_TO === 'string' && env.MAIL_TO ? String(env.MAIL_TO).split(',') : [];
  const allTo = [...providedTo, ...envTo];
  if (allTo.length && (b.subject || b.text || b.html)) {
    const to = allTo.filter((x: any) => typeof x === 'string' && x.includes('@'));
    if (to.length) {
      const fromEmail = env.MAIL_FROM || 'no-reply@example.com';
      const fromName = env.MAIL_FROM_NAME || 'PM Dashboard';
      const subject = String(b.subject || 'Notification');
      const content: any[] = [];
      if (b.text) content.push({ type: 'text/plain', value: String(b.text) });
      if (b.html) content.push({ type: 'text/html', value: String(b.html) });
      if (!content.length) content.push({ type: 'text/plain', value: 'Notification' });
      try {
        const mailRes = await fetch('https://api.mailchannels.net/tx/v1/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            personalizations: [{ to: to.map((email) => ({ email })) }],
            from: { email: fromEmail, name: fromName },
            subject,
            content,
          }),
        });
        results.email = mailRes.ok ? 'sent' : `http_${mailRes.status}`;
      } catch {
        results.email = 'error';
      }
    }
  }

  return ok({ ok: true, results });
};
