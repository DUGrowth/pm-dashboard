const DEFAULTS = {
charLimits: {
Instagram: 2200,
Facebook: 63206,
LinkedIn: 3000,
'X/Twitter': 280,
TikTok: 2200,
YouTube: 5000,
Threads: 500,
Pinterest: 500,
},
bannedWords: ['shocking', 'apocalypse'],
requiredPhrases: ['Population Matters'],
languageGuide: 'Keep copy confident, compassionate, and evidence-led.',
hashtagTips: '#PopulationMatters #Sustainability',
teamsWebhookUrl: '',
};

const ok = (data: unknown, status = 200) =>
new Response(JSON.stringify(data), {
status,
headers: { 'content-type': 'application/json' },
});

export const onRequestGet = async ({ env }: { env: any }) => {
if (!env.DB) return ok({ id: 'default', ...DEFAULTS });
const row = await env.DB.prepare("SELECT * FROM guidelines WHERE id='default'").first();
if (!row) return ok({ id: 'default', ...DEFAULTS });
const parse = (s: string | null) => {
try { return s ? JSON.parse(s) : undefined; } catch { return undefined; }
};
return ok({
id: row.id,
charLimits: parse(row.charLimits) ?? DEFAULTS.charLimits,
bannedWords: parse(row.bannedWords) ?? DEFAULTS.bannedWords,
requiredPhrases: parse(row.requiredPhrases) ?? DEFAULTS.requiredPhrases,
languageGuide: row.languageGuide ?? DEFAULTS.languageGuide,
hashtagTips: row.hashtagTips ?? DEFAULTS.hashtagTips,
teamsWebhookUrl: row.teamsWebhookUrl ?? DEFAULTS.teamsWebhookUrl,
});
};

export const onRequestPut = async ({ request, env }: { request: Request; env: any }) => {
const b = await request.json().catch(() => null);
if (!b) return ok({ error: 'Invalid JSON' }, 400);
const s = (v: any) => JSON.stringify(v ?? null);
const languageGuide = typeof b.languageGuide === 'string' ? b.languageGuide : '';
const hashtagTips = typeof b.hashtagTips === 'string' ? b.hashtagTips : '';
const teamsWebhookUrl = typeof b.teamsWebhookUrl === 'string' ? b.teamsWebhookUrl : '';
await env.DB.prepare(
"INSERT OR REPLACE INTO guidelines (id,charLimits,bannedWords,requiredPhrases,languageGuide,hashtagTips,teamsWebhookUrl) VALUES ('default',?,?,?,?,?,?)"
).bind(
s(b.charLimits), s(b.bannedWords), s(b.requiredPhrases), languageGuide, hashtagTips, teamsWebhookUrl
).run();
return ok({ ok: true });
};
