const ok = (data: unknown, status = 200) =>
new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const PLATFORMS = new Set(['Instagram','LinkedIn','X/Twitter','Facebook','TikTok','YouTube','Threads','Pinterest']);
const ASSET_TYPES = new Set(['Video','Design','Carousel']);

const RL = new Map<string,{tokens:number,ts:number}>();
function rateLimit(ip: string, limit=20, interval=60_000) {
const now = Date.now();
const b = RL.get(ip) || { tokens: limit, ts: now };
const refill = Math.floor(((now - b.ts) / interval) * limit);
if (refill > 0) { b.tokens = Math.min(limit, b.tokens + refill); b.ts = now; }
if (b.tokens <= 0) { RL.set(ip, b); return false; }
b.tokens -= 1; RL.set(ip, b); return true;
}

const getIP = (req: Request) =>
(req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'anon').toString();

function maskUrls(text: string) {
const urls: string[] = [];
const masked = (text || '').replace(/https?://\S+/gi, (m) => {
const t = __URL_${urls.length}__; urls.push(m); return t;
});
return { masked, urls };
}
function restoreUrls(text: string, urls: string[]) {
let out = text;
urls.forEach((u, i) => out = out.replaceAll(__URL_${i}__, u));
return out;
}
function enforceHashtags(text: string, max?: number) {
if (!max || max <= 0) return text;
const tokens = text.split(/(\s+)/);
let seen = 0;
return tokens.map(t => {
if (/^#\w+/.test(t)) { if (seen < max) { seen++; return t; } return t.replace('#',''); }
return t;
}).join('');
}
function ensureRequired(text: string, phrases: string[]) {
let out = text;
for (const p of (phrases || [])) {
if (!p) continue;
if (!new RegExp(p.replace(/[.*+?^${}()|[]\]/g,'\$&'), 'i').test(out)) out = ${out} ${p}.trim();
}
return out;
}
function removeBanned(text: string, words: string[]) {
let out = text;
for (const w of (words || [])) {
const re = new RegExp(\\b${w.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}\\b,'gi');
out = out.replace(re,'').replace(/\s{2,}/g,' ');
}
return out.trim();
}
function trimTo(text: string, limit: number, urls: string[]) {
if (text.length <= limit) return text;
let t = text.slice(0, limit);
const lastSpace = t.lastIndexOf(' ');
if (lastSpace > limit - 20) t = t.slice(0, lastSpace);
for (const u of urls) { if (!t.includes(u)) t = ${t.trim()} ${u}.trim(); }
if (t.length > limit) t = ${t.slice(0, limit - 1)}…;
return t;
}

function postValidate(result: any, input: any) {
const c = input.constraints || {};
const brand = input.brand || {};
const base = result?.suggestion?.text || input.text || '';
const { masked, urls } = maskUrls(base);
let work = masked;
work = removeBanned(work, brand.bannedWords || []);
work = ensureRequired(work, brand.requiredPhrases || []);
work = enforceHashtags(work, c.maxHashtags);
work = restoreUrls(work, urls);
work = trimTo(work, c.maxChars || 280, urls);
const suggestion = { text: work };
const score = result?.score || { clarity: 0.7, brevity: 0.7, hook: 0.6, fit: 0.75, readingLevel: input.readingLevelTarget || 'Grade 8' };
const flags = Array.isArray(result?.flags) ? result.flags : [];
const variants = Array.isArray(result?.variants) ? result.variants.slice(0,3).map((v:any,i:number)=>({
label: v?.label || Variant ${i+1},
text: trimTo(restoreUrls(removeBanned(ensureRequired(maskUrls(v?.text || input.text).masked, brand.requiredPhrases || []), brand.bannedWords || []), urls), c.maxChars || 280, urls),
})) : [];
const explanations = Array.isArray(result?.explanations) ? result.explanations : ['Copy adjusted for constraints'];
return { score, flags, suggestion, variants, explanations };
}

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
if (!rateLimit(getIP(request))) return ok({ error: 'Rate limit exceeded' }, 429);
const b = await request.json().catch(() => null);
if (!b || typeof b.text !== 'string') return ok({ error: 'Invalid JSON body' }, 400);
if (!PLATFORMS.has(b.platform)) return ok({ error: 'Invalid platform' }, 400);
if (!ASSET_TYPES.has(b.assetType)) return ok({ error: 'Invalid assetType' }, 400);
const constraints = b.constraints || {};
if (!(constraints && typeof constraints.maxChars === 'number' && constraints.maxChars > 0)) {
return ok({ error: 'constraints.maxChars required' }, 400);
}
if (!env.OPENAI_API_KEY) {
// Fallback if key is missing
const fb = postValidate(null, b);
return ok(fb, 422);
}

const SYSTEM_PROMPT =
'You are a senior copy editor for a social impact organization. Optimize for clarity, brevity, action, and platform fit.\n' +
'Respect HARD CONSTRAINTS: do not exceed character limits; do not change URLs; include REQUIRED PHRASES; remove BANNED WORDS.\n' +
'Preserve meaning and factual content. Return ONLY strict JSON with keys: score, flags, suggestion, variants, explanations. No extra text or markdown.\n' +
'If constraints are impossible, produce the closest valid text and list violations in flags.';

const schema = JSON.stringify({
score: { clarity: 'number', brevity: 'number', hook: 'number', fit: 'number', readingLevel: 'string' },
flags: ['string'],
suggestion: { text: 'string' },
variants: [{ label: 'string', text: 'string' }],
explanations: ['string'],
});

const prompt = Input JSON: ${JSON.stringify(b)}\nOutput Schema: ${schema};

let raw = '';
try {
const r = await fetch('https://api.openai.com/v1/chat/completions', {
method: 'POST',
headers: { authorization: Bearer ${env.OPENAI_API_KEY}, 'content-type': 'application/json' },
body: JSON.stringify({
model: 'gpt-5-codex-high',
temperature: 0.3,
messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
}),
});
const j: any = await r.json();
raw = j?.choices?.[0]?.message?.content ?? '';
} catch {
const fb = postValidate(null, b);
return ok(fb, 502);
}

let parsed: any;
try { parsed = JSON.parse((raw || '').trim()); }
catch {
// Retry once with stricter instruction
try {
const r2 = await fetch('https://api.openai.com/v1/chat/completions', {
method: 'POST',
headers: { authorization: Bearer ${env.OPENAI_API_KEY}, 'content-type': 'application/json' },
body: JSON.stringify({
model: 'gpt-5-codex-high',
temperature: 0.25,
messages: [
{ role: 'system', content: SYSTEM_PROMPT },
{ role: 'user', content: prompt + '\nReturn ONLY strict JSON matching the schema.' },
],
}),
});
const j2: any = await r2.json();
parsed = JSON.parse((j2?.choices?.[0]?.message?.content || '').trim());
} catch {
const fb = postValidate(null, b);
return ok(fb, 422);
}
}

const safe = postValidate(parsed, b);
return ok(safe);
};
