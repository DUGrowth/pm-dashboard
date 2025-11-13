type SendArgs = {
  env: any;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
};

const sendViaBrevo = async ({ env, to, subject, text, html }: SendArgs) => {
  const apiKey = env.BREVO_API_KEY || env.BREVO_API_TOKEN;
  if (!apiKey) return { ok: false as const, status: 0, reason: 'missing_api_key' };
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

const sendViaMailChannels = async ({ env, to, subject, text, html }: SendArgs) => {
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

export async function sendEmail({ env, to, subject, text, html }: SendArgs) {
  if (!Array.isArray(to) || !to.length) {
    return { ok: false, reason: 'no_recipients' };
  }
  let result = await sendViaBrevo({ env, to, subject, text, html });
  if (!result.ok) {
    result = await sendViaMailChannels({ env, to, subject, text, html });
  }
  return result;
}
