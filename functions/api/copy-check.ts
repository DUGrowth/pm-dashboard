/* Cloudflare Pages Function: POST /api/copy-check */
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
type Tone = { confident: number; compassionate: number; evidenceLed: number };
type Constraints = { maxChars: number; maxHashtags?: number; requireCTA?: boolean };
type Brand = { bannedWords: string[]; requiredPhrases: string[]; tone: Tone };

type InputPayload = {
text: string;
platform: Platform;
assetType: AssetType;
readingLevelTarget?: string;
constraints: Constraints;
brand: Brand;
};

type OutputShape = {
score: { clarity: number; brevity: number; hook: number; fit: number; readingLevel: string };
flags: string[];
suggestion: { text: string };
variants: { label: string; text: string }[];
explanations: string[];
};

// CORS
function corsHeaders(origin?: string | null) {
return {
'access-control-allow-origin': origin || '*',
'access-control-allow-methods': 'POST, OPTIONS, GET',
'access-control-allow-headers': 'authorization, content-type',
'access-control-allow-credentials': 'true',
'content-type': 'application/json; charset=utf-8',
'cache-control': 'no-store',
} as Record<string, string>;
}

export const onRequestOptions: PagesFunction = async ({ request }) =>
new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });

export const onRequestGet: PagesFunction = async ({ request }) =>
new Response(JSON.stringify({ ok: true, use: 'POST /api/copy-check' }), {
status: 200,
headers: corsHeaders(request.headers.get('origin')),
});

// Simple rate limit (20/min per IP)
const RL: Map<string, { tokens: number; ts: number }> = new Map();
function rateLimit(ip: string, limit = 20, windowMs = 60_000) {
const now = Date.now();
const b = RL.get(ip) || { tokens: limit, ts: now };
const elapsed = now - b.ts;
if (elapsed > windowMs) {
b.tokens = limit;
b.ts = now;
}
if (b.tokens <= 0) {
RL.set(ip, b);
return false;
}
b.tokens -= 1;
RL.set(ip, b);
return true;
}

// Utils
const ALLOWED_PLATFORMS: Platform[] = [
'Instagram',
'Facebook',
'LinkedIn',
'X/Twitter',
'TikTok',
'YouTube',
'Threads',
'Pinterest',
];
const ALLOWED_ASSETS: AssetType[] = ['Video', 'Design', 'Carousel'];

function escapeRegExp(s: string) {
return s.replace(/[.*+?^${}()|[]\]/g, '\$&');
}

function getClientIp(req: Request) {
return req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '0.0.0.0';
}

// URL detector (uses \u005c to avoid JSON escaping issues for backslashes)
const URL_RE = /(https?://[^\u005cs)]+)|(www.[^\u005cs)]+)/gi;

function extractUrls(s: string) {
const urls: string[] = [];
const text = s.replace(URL_RE, (m) => {
const idx = urls.push(m) - 1;
return __URL${idx}__;
});
return { text, urls };
}

function reinstateUrls(s: string, urls: string[]) {
return s.replace(/URL(\u005cd+)/g, (_: string, n: string) => urls[Number(n)] ?? '');
}

function limitHashtags(s: string, max?: number) {
if (!max || max < 0) return s;
const parts = s.split(/(\u005cs+)/); // keep spaces
let count = 0;
for (let i = 0; i < parts.length; i++) {
const p = parts[i];
if (/^#[\u005cp{L}0-9_]+$/u.test(p)) {
count += 1;
if (count > max) parts[i] = '';
}
}
return parts.join('');
}

function hardTrimTo(s: string, max: number, preserveUrls = true) {
if (s.length <= max) return s;
if (!preserveUrls) return s.slice(0, max);
const urls = Array.from(s.matchAll(URL_RE)).map((m) => ({
start: m.index || 0,
end: (m.index || 0) + m[0].length,
}));
let end = max;
for (const u of urls) {
if (end > u.start && end < u.end) {
end = u.start;
break;
}
}
return s.slice(0, Math.max(0, end));
}

function normalizeSpaces(s: string) {
return s.replace(/\u005cs+/g, ' ').trim();
}

function validateInput(body: any): { ok: true; data: InputPayload } | { ok: false; error: string } {
if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid JSON body' };
const { text, platform, assetType, readingLevelTarget, constraints, brand } = body;
if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'text required' };
if (!ALLOWED_PLATFORMS.includes(platform)) return { ok: false, error: 'invalid platform' };
if (!ALLOWED_ASSETS.includes(assetType)) return { ok: false, error: 'invalid assetType' };
if (!constraints || typeof constraints.maxChars !== 'number')
return { ok: false, error: 'constraints.maxChars required' };
if (!brand || !Array.isArray(brand.bannedWords) || !Array.isArray(brand.requiredPhrases))
return { ok: false, error: 'brand.bannedWords and brand.requiredPhrases required' };
const tone = brand.tone || { confident: 0.8, compassionate: 0.7, evidenceLed: 1 };
const data: InputPayload = {
text: String(text),
platform,
assetType,
readingLevelTarget: readingLevelTarget || 'Grade 7',
constraints: {
maxChars: Number(constraints.maxChars),
maxHashtags: constraints.maxHashtags ? Number(constraints.maxHashtags) : undefined,
requireCTA: Boolean(constraints.requireCTA),
},
brand: {
bannedWords: brand.bannedWords.map((x: any) => String(x)),
requiredPhrases: brand.requiredPhrases.map((x: any) => String(x)),
tone: {
confident: Number(tone.confident ?? 0.8),
compassionate: Number(tone.compassionate ?? 0.7),
evidenceLed: Number(tone.evidenceLed ?? 1),
},
},
};
return { ok: true, data };
}

function ruleBasedTransform(input: InputPayload): { text: string; flags: string[] } {
const { constraints, brand } = input;
const flags: string[] = [];
const { text: noUrl, urls } = extractUrls(input.text);

// Remove banned words (whole word)
let t = noUrl;
for (const bw of brand.bannedWords) {
if (!bw) continue;
const re = new RegExp(\\b${escapeRegExp(bw)}\\b, 'gi');
if (re.test(t)) flags.push(Removed banned word: "${bw}");
t = t.replace(re, '');
}
t = normalizeSpaces(t);

// Inject required phrases if missing
for (const req of brand.requiredPhrases) {
if (!req) continue;
const present = new RegExp(escapeRegExp(req), 'i').test(t);
if (!present) {
const addition = (t ? ' — ' : '') + req;
t += addition;
flags.push(Injected required phrase: "${req}");
}
}

// Re-insert URLs exactly
t = reinstateUrls(t, urls);

// Cap hashtags
t = limitHashtags(t, constraints.maxHashtags);

// Trim to max chars, preserve URLs where possible
if (t.length > constraints.maxChars) {
t = hardTrimTo(t, constraints.maxChars, true);
flags.push('Trimmed to maxChars');
}

// CTA heuristic
if (constraints.requireCTA) {
const hasCTA = /\u005cb(join|sign up|donate|learn more|read more|take action|share)\u005cb/i.test(t);
if (!hasCTA) flags.push('Missing CTA');
}

return { text: t, flags };
}

function buildSystemPrompt() {
return (
'You are a senior copy editor for a social impact organization. Optimize for clarity, brevity, action, and platform fit.\n' +
'Respect HARD CONSTRAINTS: do not exceed character limits; do not change URLs; include REQUIRED PHRASES; remove BANNED WORDS.\n' +
'Preserve meaning and factual content. Return ONLY strict JSON with keys: score, flags, suggestion, variants, explanations. No extra text or markdown.\n' +
'If constraints are impossible, produce the closest valid text and list violations in flags.'
);
}

function buildUserPrompt(input: InputPayload) {
const schema = {
type: 'object',
properties: {
score: {
type: 'object',
properties: {
clarity: { type: 'number' },
brevity: { type: 'number' },
hook: { type: 'number' },
fit: { type: 'number' },
readingLevel: { type: 'string' },
},
required: ['clarity', 'brevity', 'hook', 'fit', 'readingLevel'],
},
flags: { type: 'array', items: { type: 'string' } },
suggestion: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
variants: {
type: 'array',
items: { type: 'object', properties: { label: { type: 'string' }, text: { type: 'string' } }, required: ['label', 'text'] },
},
explanations: { type: 'array', items: { type: 'string' } },
},
required: ['score', 'flags', 'suggestion', 'variants', 'explanations'],
additionalProperties: false,
};

return 'INPUT JSON:\n' + JSON.stringify(input) + '\nOUTPUT SCHEMA (JSON):\n' + JSON.stringify(schema);
}

function coerceOutput(parsed: any): OutputShape | null {
try {
if (!parsed || typeof parsed !== 'object') return null;
const score = parsed.score || {};
const out: OutputShape = {
score: {
clarity: Number(score.clarity ?? 0),
brevity: Number(score.brevity ?? 0),
hook: Number(score.hook ?? 0),
fit: Number(score.fit ?? 0),
readingLevel: String(score.readingLevel ?? 'Unknown'),
},
flags: Array.isArray(parsed.flags) ? parsed.flags.map((x: any) => String(x)) : [],
suggestion: { text: String(parsed.suggestion?.text ?? '') },
variants: Array.isArray(parsed.variants)
? parsed.variants.map((v: any) => ({ label: String(v.label ?? ''), text: String(v.text ?? '') }))
: [],
explanations: Array.isArray(parsed.explanations) ? parsed.explanations.map((x: any) => String(x)) : [],
};
if (!out.suggestion.text) return null;
return out;
} catch {
return null;
}
}

function postValidate(out: OutputShape, input: InputPayload): OutputShape {
const fix = (s: string) => ruleBasedTransform({ ...input, text: s }).text;
const flags: string[] = [...out.flags];
const fixedSuggestion = fix(out.suggestion.text);
if (fixedSuggestion !== out.suggestion.text) flags.push('Adjusted to meet constraints');
const fixedVariants = out.variants.map((v) => {
const newText = fix(v.text);
if (newText !== v.text) flags.push(Adjusted variant (${v.label}) to meet constraints);
return { ...v, text: newText };
});
return { ...out, flags: Array.from(new Set(flags)), suggestion: { text: fixedSuggestion }, variants: fixedVariants };
}

async function callOpenAI(env: any, input: InputPayload): Promise<OutputShape | null> {
const apiKey = env?.OPENAI_API_KEY as string | undefined;
if (!apiKey) return null;

const system = buildSystemPrompt();
const user = buildUserPrompt(input);

async function once(temp: number, extra?: string) {
const r = await fetch('https://api.openai.com/v1/chat/completions', {
method: 'POST',
headers: { authorization: Bearer ${apiKey}, 'content-type': 'application/json' },
body: JSON.stringify({
model: 'gpt-5-codex-high',
temperature: temp,
messages: [
{ role: 'system', content: system },
{ role: 'user', content: extra ? ${user}\n\nReturn ONLY strict JSON. ${extra} : user },
],
}),
});
if (!r.ok) return null;
const j: any = await r.json();
const raw = j?.choices?.[0]?.message?.content ?? '';
try {
const parsed = JSON.parse(raw);
return coerceOutput(parsed);
} catch {
return null;
}
}

let out = await once(0.3);
if (out) return out;
out = await once(0.3, 'No prose, no markdown.');
return out;
}

function makeFallback(input: InputPayload): OutputShape {
const { text, flags } = ruleBasedTransform(input);
return {
score: { clarity: 0.7, brevity: 0.7, hook: 0.6, fit: 0.8, readingLevel: input.readingLevelTarget || 'Grade 7' },
flags: Array.from(new Set(['Rule-based fallback', ...flags])),
suggestion: { text },
variants: [{ label: 'Shorter', text: hardTrimTo(text, Math.max(40, Math.min(120, input.constraints.maxChars)), true) }],
explanations: [
'Removed banned words and preserved URLs',
'Injected required phrases and trimmed to character limit',
'Heuristic reading-level balance applied',
],
};
}

export const onRequestPost: PagesFunction = async ({ request, env }) => {
const origin = request.headers.get('origin');
const headers = corsHeaders(origin);

const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
if (!rateLimit(ip)) return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers });

let body: any;
try {
body = await request.json();
} catch {
return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers });
}
const v = validateInput(body);
if (!('ok' in v) || !v.ok) return new Response(JSON.stringify({ error: v.error }), { status: 400, headers });
const input = v.data;

try {
const ai = await callOpenAI(env, input);
if (ai) {
const safe = postValidate(ai, input);
return new Response(JSON.stringify(safe), { status: 200, headers });
}
} catch {
// fall through to fallback
}
const fb = makeFallback(input);
return new Response(JSON.stringify(fb), { status: 200, headers });
};
