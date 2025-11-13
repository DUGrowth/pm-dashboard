import { authorizeRequest } from './_auth';

// Cloudflare Pages Function: /api/copy-check
// Validates input, calls OpenAI (configurable), and enforces constraints on output

// JSON response helper
const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// Allowed enums
const PLATFORMS = new Set([
  'Instagram',
  'LinkedIn',
  'X/Twitter',
  'Facebook',
  'TikTok',
  'YouTube',
  'Threads',
  'Pinterest',
  'BlueSky',
]);
const ASSET_TYPES = new Set(['Video', 'Design', 'Carousel']);

const PLATFORM_PROMPTS: Record<string, string> = {
  Facebook: `Facebook Page copy check. Front-load value in the first 80 characters. One post = one job (comments, shares, or clicks—pick one) with a single, specific CTA. Avoid engagement/click bait and unoriginal reposts; if resharing, add unique commentary. Prefer clear language; 0–3 hashtags max. Cite credible sources inline when using stats. Prompt meaningful discussion with a concrete question (not “What do you think?”). Accessibility: require alt text for images and captions for video. Deliver the core insight natively before any link. Population Matters: people-first, solution-oriented framing—avoid doom.`,
  LinkedIn: `LinkedIn Company Page copy check. Line 1 must state a clear claim/insight; follow with 3–5 short, scannable lines that teach one practical thing. Include a credible stat/source inline. Use one precise practitioner CTA. Prefer native value; if a link exists, place it after delivering value (or recommend first-comment placement)—never lead with a naked link. Suggest a Document (carousel) if the draft tries to explain multiple points. Accessibility: require alt text/captions. Tone: plain, professional, zero fluff. Population Matters: evidence-led, human impact first.`,
  Instagram: `Instagram caption check. Hook + human stake in the first 1–2 lines. Write for followers first; for reach, suggest Collab tags and creator mentions over hashtag spam. Use natural-language keywords in the caption; keep hashtags focused (0–5 relevant). Deliver the gist natively (link in bio/sticker if needed). CTA should drive saves, specific comments, or DMs. Accessibility: alt text mandatory; subtitles/on-screen text for Reels. Population Matters: stories + solutions; keep numbers transparent and sourced.`,
  YouTube: `YouTube copy check (titles, descriptions, hashtags, Community). Title: ≤70 characters, benefit + specific context + light curiosity; include the primary keyword naturally. Description: first 150–200 characters must summarize the payoff and include key terms; then bullets/chapters. Hashtags: 1–3 relevant (avoid >15). Recommend pinning a top comment with sources/links if the description is dense. Community posts: teach one thing in 2–4 short lines + single qualified question. CTA must match intent (watch next, comment, subscribe). Accessibility: captions required. Population Matters: evidence + outcomes, not sensationalism.`,
  TikTok: `TikTok caption check. Verify in-app caption allowance on publish; regardless, the first line must carry the hook. Pair on-screen text + spoken hook with a caption that gives one line of context and 3–5 natural-language search phrases (“how to…”, “why X…”). Avoid hashtag clouds and engagement bait. Use a clear CTA (e.g., ask for a specific keyword in comments if you’ll follow up). Ensure auto-captions are on; respect safe zones for text overlays. Population Matters: human stories, practical solutions, transparent sources when citing stats.`,
  BlueSky: `Bluesky post check. 300-character hard cap: one idea, strong verb, one proof point. If more is required, recommend a deliberate thread (1/?, 2/?). Avoid hashtag clutter; use proper nouns/keywords in plain text. If images are referenced, require alt text. End with a concrete question or pointer when discussion is the goal. Population Matters: people-centred framing; clarity over cleverness.`,
};

const BASE_SYSTEM_PROMPT =
  'You are a senior copy editor for a social impact organization. Optimize for clarity, brevity, action, and platform fit.\n' +
  'Respect HARD CONSTRAINTS: do not exceed character limits; do not change URLs; include REQUIRED PHRASES; remove BANNED WORDS.\n' +
  'Preserve meaning and factual content. Return ONLY strict JSON with keys: score, flags, suggestion, variants, explanations. No extra text or markdown.\n' +
  'If constraints are impossible, produce the closest valid text and list violations in flags.';

const getSystemPrompt = (platform: string) => {
  const platformPrompt = PLATFORM_PROMPTS[platform] || '';
  return platformPrompt ? `${BASE_SYSTEM_PROMPT}\n${platformPrompt}` : BASE_SYSTEM_PROMPT;
};

// Simple token-bucket RL per IP (with idle cleanup)
const RL = new Map<string, { tokens: number; ts: number; seen: number }>();
function rateLimit(ip: string, limit = 20, interval = 60_000) {
  const now = Date.now();
  let bucket = RL.get(ip);
  if (!bucket) {
    bucket = { tokens: limit, ts: now, seen: now };
    RL.set(ip, bucket);
  } else {
    const elapsed = now - bucket.ts;
    if (elapsed > 0) {
      const refill = Math.floor((elapsed / interval) * limit);
      if (refill > 0) {
        bucket.tokens = Math.min(limit, bucket.tokens + refill);
        bucket.ts = now;
        if (bucket.tokens === limit && now - bucket.seen > interval * 5) {
          RL.delete(ip);
          bucket = { tokens: limit, ts: now, seen: now };
          RL.set(ip, bucket);
        }
      }
    }
  }
  if (bucket.tokens <= 0) {
    bucket.seen = now;
    RL.set(ip, bucket);
    return false;
  }
  bucket.tokens -= 1;
  bucket.seen = now;
  RL.set(ip, bucket);
  return true;
}

const getIP = (req: Request) =>
  (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'anon').toString();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function maskUrls(text: string) {
  const urls: string[] = [];
  const masked = (text || '').replace(/https?:\/\/\S+/gi, (m) => {
    const t = `__URL_${urls.length}__`;
    urls.push(m);
    return t;
  });
  return { masked, urls };
}
function restoreUrls(text: string, urls: string[]) {
  let out = text;
  urls.forEach((u, i) => {
    const token = `__URL_${i}__`;
    out = out.replaceAll(token, u);
  });
  return out;
}
function enforceHashtags(text: string, max?: number) {
  if (!max || max <= 0) return text;
  const tokens = text.split(/(\s+)/);
  let seen = 0;
  return tokens
    .map((t) => {
      if (/^#\w+/.test(t)) {
        if (seen < max) {
          seen += 1;
          return t;
        }
        return t.replace('#', '');
      }
      return t;
    })
    .join('');
}
function ensureRequired(text: string, phrases: string[], limit?: number, urls: string[] = []) {
  let out = text;
  for (const p of phrases || []) {
    if (!p) continue;
    if (new RegExp(escapeRegExp(p), 'i').test(out)) continue;
    const candidate = `${p} ${out}`.trim();
    if (limit && limit > 0) {
      out = trimTo(candidate, limit, urls, phrases);
      if (!new RegExp(escapeRegExp(p), 'i').test(out)) {
        out = p.length > limit ? p.slice(0, limit) : p;
      }
    } else {
      out = candidate;
    }
  }
  return out;
}
function removeBanned(text: string, words: string[]) {
  let out = text;
  for (const w of words || []) {
    if (!w) continue;
    const re = new RegExp(`\\b${escapeRegExp(w)}\\b`, 'gi');
    out = out.replace(re, '').replace(/\s{2,}/g, ' ');
  }
  return out.trim();
}
function trimTo(
  text: string,
  limit: number,
  urls: string[],
  preservePhrases: string[] = [],
) {
  if (text.length <= limit) return text;
  const phrases = (preservePhrases || []).filter(Boolean);
  const hasPhrase = (candidate: string, phrase: string) =>
    new RegExp(escapeRegExp(phrase), 'i').test(candidate);
  const canDrop = (current: string, next: string) =>
    phrases.every((phrase) => !hasPhrase(current, phrase) || hasPhrase(next, phrase));
  const dropTrailing = (current: string, targetLength: number) => {
    if (!current) return '';
    if (targetLength < 0) return '';
    let candidate = current.trim();
    while (candidate && candidate.length > targetLength) {
      const idx = candidate.lastIndexOf(' ');
      if (idx === -1) return '';
      const next = candidate.slice(0, idx).trim();
      if (!next) return '';
      if (!canDrop(candidate, next)) break;
      candidate = next;
    }
    return candidate;
  };

  let working = text.slice(0, limit).trim();
  const lastSpace = working.lastIndexOf(' ');
  if (lastSpace > limit - 20) {
    const sliced = working.slice(0, lastSpace).trim();
    if (sliced) working = sliced;
  }
  working = dropTrailing(working, limit) || working.slice(0, limit).trim();

  const ensureContains = (base: string, snippet: string) => {
    if (!snippet || snippet.length > limit) return base;
    if (base.includes(snippet)) return base;
    let candidate = base.trim();
    const addLength = snippet.length + (candidate ? 1 : 0);
    if (candidate.length + addLength > limit) {
      const trimmed = dropTrailing(candidate, limit - addLength);
      if (!trimmed) {
        return snippet.length > limit ? snippet.slice(0, limit) : snippet;
      }
      if (trimmed.length + addLength > limit) return candidate;
      candidate = trimmed;
    }
    return candidate ? `${candidate} ${snippet}`.trim() : snippet;
  };

  for (const url of urls) {
    working = ensureContains(working, url);
  }

  if (working.length > limit) {
    working = dropTrailing(working, limit) || working.slice(0, limit).trim();
  }

  return working;
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
  work = trimTo(work, c.maxChars || 280, urls, brand.requiredPhrases || []);
  work = ensureRequired(work, brand.requiredPhrases || [], c.maxChars || 280, urls);
  const suggestion = { text: work };
  const score =
    result?.score || {
      clarity: 0.7,
      brevity: 0.7,
      hook: 0.6,
      fit: 0.75,
      readingLevel: input.readingLevelTarget || 'Grade 8',
    };
  const flags = Array.isArray(result?.flags) ? result.flags : [];
  const variants = Array.isArray(result?.variants)
    ? result.variants.slice(0, 3).map((v: any, i: number) => {
        const variantSource = typeof v?.text === 'string' && v.text.trim() ? v.text : input.text;
        const { masked: variantMasked, urls: variantUrls } = maskUrls(variantSource || '');
        const normalized = trimTo(
          restoreUrls(
            removeBanned(ensureRequired(variantMasked, brand.requiredPhrases || []), brand.bannedWords || []),
            variantUrls,
          ),
          c.maxChars || 280,
          variantUrls,
          brand.requiredPhrases || [],
        );
        const ensured = ensureRequired(
          normalized,
          brand.requiredPhrases || [],
          c.maxChars || 280,
          variantUrls,
        );
        return {
          label: v?.label || `Variant ${i + 1}`,
          text: ensured,
        };
      })
    : [];
  const explanations = Array.isArray(result?.explanations)
    ? result.explanations
    : ['Copy adjusted for constraints'];
  return { score, flags, suggestion, variants, explanations };
}

const withFallbackMeta = (payload: any) => ({ ...payload, fallback: true });

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return ok({ error: auth.error }, auth.status);
  if (!rateLimit(getIP(request))) return ok({ error: 'Rate limit exceeded' }, 429);
  const b = await request.json().catch(() => null);
  if (!b || typeof b.text !== 'string') return ok({ error: 'Invalid JSON body' }, 400);
  if (!PLATFORMS.has(b.platform)) return ok({ error: 'Invalid platform' }, 400);
  if (!ASSET_TYPES.has(b.assetType)) return ok({ error: 'Invalid assetType' }, 400);
  const constraints = b.constraints || {};
  if (!(constraints && typeof constraints.maxChars === 'number' && constraints.maxChars > 0)) {
    return ok({ error: 'constraints.maxChars required' }, 400);
  }

  const OPENAI_MODEL = env.OPENAI_MODEL || 'gpt-4o-mini';
  const OPENAI_API_BASE = env.OPENAI_API_BASE || 'https://api.openai.com/v1';

  if (!env.OPENAI_API_KEY) {
    // Fallback if key is missing
    const fb = postValidate(null, b);
    return ok(withFallbackMeta(fb));
  }

  const systemPrompt = getSystemPrompt(b.platform);

  const schema = JSON.stringify({
    score: {
      clarity: 'number',
      brevity: 'number',
      hook: 'number',
      fit: 'number',
      readingLevel: 'string',
    },
    flags: ['string'],
    suggestion: { text: 'string' },
    variants: [{ label: 'string', text: 'string' }],
    explanations: ['string'],
  });

  const prompt = `Input JSON: ${JSON.stringify(b)}\nOutput Schema: ${schema}`;

  let raw = '';
  try {
    const r = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!r.ok) throw new Error('LLM_HTTP');
    const j: any = await r.json();
    raw = j?.choices?.[0]?.message?.content ?? '';
  } catch {
    const fb = postValidate(null, b);
    return ok(withFallbackMeta(fb));
  }

  let parsed: any;
  try {
    parsed = JSON.parse((raw || '').trim());
  } catch {
    // Retry once with stricter instruction
    try {
      const r2 = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          temperature: 0.25,
          messages: [
          { role: 'system', content: systemPrompt },
            { role: 'user', content: `${prompt}\nReturn ONLY strict JSON matching the schema.` },
          ],
        }),
      });
      if (!r2.ok) throw new Error('LLM_HTTP');
      const j2: any = await r2.json();
      parsed = JSON.parse((j2?.choices?.[0]?.message?.content || '').trim());
    } catch {
      const fb = postValidate(null, b);
      return ok(withFallbackMeta(fb));
    }
  }

  const safe = postValidate(parsed, b);
  return ok(safe);
};
