import {createHash, randomBytes} from 'crypto';
import {cookies} from 'next/headers';
import {getDbPool} from '@/lib/db';

export const SESSION_COOKIE_NAME = 'fitness_food_session';
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
};

type SessionLookupRow = UserRow & {
  expires_at: Date;
};

export type Viewer = {
  id: string;
  email: string;
  displayName: string | null;
};

export function isEmailAuthConfigured(): boolean {
  return Boolean(
    process.env.APP_BASE_URL &&
      process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_FROM
  );
}

export function getAppBaseUrl(): string {
  const baseUrl = process.env.APP_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error('APP_BASE_URL is not configured.');
  }
  return baseUrl.replace(/\/$/, '');
}

function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildExpiry(ttlMs: number): Date {
  return new Date(Date.now() + ttlMs);
}

async function getOrCreateUserByEmail(email: string): Promise<UserRow> {
  const pool = getDbPool();
  const normalizedEmail = email.trim().toLowerCase();
  const result = await pool.query<UserRow>(
    `
      INSERT INTO app."user" (email)
      VALUES ($1)
      ON CONFLICT (email)
      DO UPDATE SET updated_at = NOW()
      RETURNING id, email, display_name
    `,
    [normalizedEmail]
  );
  return result.rows[0]!;
}

export async function createMagicLink(email: string): Promise<{
  viewer: Viewer;
  magicLink: string;
}> {
  const user = await getOrCreateUserByEmail(email);
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = hashSecret(rawToken);
  const expiresAt = buildExpiry(MAGIC_LINK_TTL_MS);
  const pool = getDbPool();

  await pool.query(
    `
      INSERT INTO app.magic_link_token (user_id, token_hash, email, expires_at)
      VALUES ($1, $2, $3, $4)
    `,
    [user.id, tokenHash, user.email, expiresAt]
  );

  return {
    viewer: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
    },
    magicLink: `${getAppBaseUrl()}/auth/callback?token=${encodeURIComponent(rawToken)}`,
  };
}

export async function consumeMagicLinkToken(rawToken: string): Promise<{
  viewer: Viewer;
  sessionToken: string;
  sessionExpiresAt: Date;
}> {
  const tokenHash = hashSecret(rawToken);
  const pool = getDbPool();

  const tokenResult = await pool.query<{
    id: string;
    user_id: string;
    email: string;
    expires_at: Date;
    consumed_at: Date | null;
  }>(
    `
      SELECT id, user_id, email, expires_at, consumed_at
      FROM app.magic_link_token
      WHERE token_hash = $1
      LIMIT 1
    `,
    [tokenHash]
  );

  const tokenRow = tokenResult.rows[0];
  if (!tokenRow || tokenRow.consumed_at || tokenRow.expires_at.getTime() < Date.now()) {
    throw new Error('Magic link is invalid or has expired.');
  }

  await pool.query(
    `
      UPDATE app.magic_link_token
      SET consumed_at = NOW()
      WHERE id = $1
    `,
    [tokenRow.id]
  );

  const sessionToken = randomBytes(32).toString('base64url');
  const sessionHash = hashSecret(sessionToken);
  const sessionExpiresAt = buildExpiry(SESSION_TTL_MS);

  await pool.query(
    `
      INSERT INTO app.session (user_id, session_hash, expires_at)
      VALUES ($1, $2, $3)
    `,
    [tokenRow.user_id, sessionHash, sessionExpiresAt]
  );

  await pool.query(
    `
      UPDATE app."user"
      SET last_login_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `,
    [tokenRow.user_id]
  );

  const userResult = await pool.query<UserRow>(
    `
      SELECT id, email, display_name
      FROM app."user"
      WHERE id = $1
      LIMIT 1
    `,
    [tokenRow.user_id]
  );

  const user = userResult.rows[0]!;
  return {
    viewer: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
    },
    sessionToken,
    sessionExpiresAt,
  };
}

export async function persistSessionCookie(
  sessionToken: string,
  expiresAt: Date
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    path: '/',
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getViewer(): Promise<Viewer | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) {
    return null;
  }

  const sessionHash = hashSecret(sessionToken);
  const pool = getDbPool();
  const result = await pool.query<SessionLookupRow>(
    `
      SELECT u.id, u.email, u.display_name, s.expires_at
      FROM app.session s
      JOIN app."user" u ON u.id = s.user_id
      WHERE s.session_hash = $1
      LIMIT 1
    `,
    [sessionHash]
  );

  const row = result.rows[0];
  if (!row || row.expires_at.getTime() < Date.now()) {
    await clearSessionCookie();
    return null;
  }

  await pool.query(
    `
      UPDATE app.session
      SET last_seen_at = NOW()
      WHERE session_hash = $1
    `,
    [sessionHash]
  );

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
  };
}

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) {
    throw new Error('请先登录后再执行这个操作。');
  }
  return viewer;
}

export async function deleteCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) {
    return;
  }

  const sessionHash = hashSecret(sessionToken);
  const pool = getDbPool();
  await pool.query('DELETE FROM app.session WHERE session_hash = $1', [sessionHash]);
  await clearSessionCookie();
}
