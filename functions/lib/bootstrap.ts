import { hashPassword, randomId } from './crypto';

const DEFAULT_OWNER_EMAIL = 'daniel.davis@populationmatters.org';
const DEFAULT_OWNER_NAME = 'Daniel Davis';
const DEFAULT_OWNER_PASSWORD = 'password';
const DEFAULT_OWNER_FEATURES = [
  'calendar',
  'kanban',
  'approvals',
  'ideas',
  'linkedin',
  'testing',
  'admin',
];

export async function ensureDefaultOwner(env: any) {
  if (!env?.DB) return;
  const normalizedEmail = DEFAULT_OWNER_EMAIL.toLowerCase();
  const existing = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(normalizedEmail).first();
  const now = new Date().toISOString();
  const featuresJson = JSON.stringify(DEFAULT_OWNER_FEATURES);
  const hashed = await hashPassword(DEFAULT_OWNER_PASSWORD);
  if (existing) {
    await env.DB.prepare(
      'UPDATE users SET name=?, passwordHash=?, status=?, isAdmin=1, features=?, inviteToken=NULL, inviteExpiresAt=NULL, updatedAt=? WHERE id=?',
    )
      .bind(DEFAULT_OWNER_NAME, hashed, 'active', featuresJson, now, existing.id)
      .run();
    return;
  }
  await env.DB.prepare(
    'INSERT INTO users (id,email,name,passwordHash,status,isAdmin,features,createdAt,updatedAt,lastLoginAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(randomId('usr_'), normalizedEmail, DEFAULT_OWNER_NAME, hashed, 'active', 1, featuresJson, now, now, null)
    .run();
}
