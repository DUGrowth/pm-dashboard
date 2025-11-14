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

const UPSERT_COLUMNS =
  'name=?, passwordHash=?, status=?, isAdmin=1, features=?, inviteToken=NULL, inviteExpiresAt=NULL, updatedAt=?';

export async function ensureDefaultOwner(env: any) {
  try {
    if (!env?.DB) return;
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        passwordHash TEXT,
        inviteToken TEXT,
        inviteExpiresAt TEXT,
        features TEXT,
        status TEXT DEFAULT 'pending',
        isAdmin INTEGER DEFAULT 0,
        createdAt TEXT,
        updatedAt TEXT,
        lastLoginAt TEXT
      )`,
    ).run();
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        tokenHash TEXT NOT NULL,
        createdAt TEXT,
        expiresAt TEXT,
        userAgent TEXT,
        ip TEXT
      )`,
    ).run();
    const normalizedEmail = DEFAULT_OWNER_EMAIL.toLowerCase();
    const existing = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(normalizedEmail).first();
    if (existing && existing.passwordHash) return;
    const now = new Date().toISOString();
    const featuresJson = JSON.stringify(DEFAULT_OWNER_FEATURES);
    const hashed = await hashPassword(DEFAULT_OWNER_PASSWORD);
    if (existing) {
      try {
        await env.DB.prepare(`UPDATE users SET ${UPSERT_COLUMNS} WHERE id=?`)
          .bind(DEFAULT_OWNER_NAME, hashed, 'active', featuresJson, now, existing.id)
          .run();
      } catch {
        await env.DB.prepare('UPDATE users SET name=?, passwordHash=?, status=?, isAdmin=1, features=?, updatedAt=? WHERE id=?')
          .bind(DEFAULT_OWNER_NAME, hashed, 'active', featuresJson, now, existing.id)
          .run();
      }
      return;
    }
    const id = randomId('usr_');
    try {
      await env.DB.prepare(
        'INSERT INTO users (id,email,name,passwordHash,status,isAdmin,features,createdAt,updatedAt,lastLoginAt,inviteToken,inviteExpiresAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      )
        .bind(id, normalizedEmail, DEFAULT_OWNER_NAME, hashed, 'active', 1, featuresJson, now, now, null, null, null)
        .run();
    } catch {
      await env.DB.prepare(
        'INSERT INTO users (id,email,name,passwordHash,status,isAdmin,features,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)',
      )
        .bind(id, normalizedEmail, DEFAULT_OWNER_NAME, hashed, 'active', 1, featuresJson, now, now)
        .run();
    }
  } catch (error) {
    console.warn('Default owner bootstrap failed', error);
  }
}
