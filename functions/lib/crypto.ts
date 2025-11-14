declare const Buffer: any;

const textEncoder = new TextEncoder();

const toBase64 = (bytes: Uint8Array) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

const fromBase64 = (value: string) => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const randomId = (prefix = '') => `${prefix}${crypto.randomUUID?.() ?? hex(crypto.getRandomValues(new Uint8Array(16)))}`;

export const generateToken = (size = 32) => hex(crypto.getRandomValues(new Uint8Array(size)));

const PBKDF2_ITERATIONS = 150000;
const PBKDF2_HASH = 'SHA-256';

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    key,
    256,
  );
  const hashBytes = new Uint8Array(derived);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${toBase64(salt)}:${toBase64(hashBytes)}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined) {
  if (!stored) return false;
  const parts = stored.split(':');
  if (parts.length !== 4) return false;
  const [, iterationsRaw, saltRaw, hashRaw] = parts;
  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = fromBase64(saltRaw);
  const expected = fromBase64(hashRaw);
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: PBKDF2_HASH },
    key,
    expected.length * 8,
  );
  const hashBytes = new Uint8Array(derived);
  if (hashBytes.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < hashBytes.length; i += 1) mismatch |= hashBytes[i] ^ expected[i];
  return mismatch === 0;
}

export async function hashToken(token: string) {
  const data = textEncoder.encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toBase64(new Uint8Array(digest));
}
