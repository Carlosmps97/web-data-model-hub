/**
 * POST /api/auth/login — exchanges username+password for a session
 * cookie.
 *
 * Response body is the sanitized `AuthUser` so the frontend can
 * hydrate its store in one round trip.
 *
 * Failure modes:
 *   - 400 malformed body
 *   - 401 invalid credentials or disabled account
 *
 * The endpoint also triggers a lazy bootstrap of the default admin
 * on first hit — this removes the need for a seed script.
 */

import { NextResponse } from 'next/server';
import { getUserByUsername, markLoginSuccess } from '@/server/db/users';
import { verifyPassword } from '@/server/auth/password';
import {
  AUTH_COOKIE_NAME,
  authCookieOptions,
  signAuthToken,
} from '@/server/auth/jwt';
import { ensureBootstrapAdmin } from '@/server/auth/bootstrap';
import type { AuthUser } from '@/types/auth';

function toAuthUser(record: Awaited<ReturnType<typeof getUserByUsername>>): AuthUser | null {
  if (!record) return null;
  return {
    id: record.id,
    username: record.username,
    role: record.role,
    isActive: record.isActive,
    permissions: record.permissions,
    createdAt: record.createdAt,
    statusUpdatedAt: record.statusUpdatedAt,
    lastLoginAt: record.lastLoginAt,
  };
}

export async function POST(req: Request) {
  // Always run the bootstrap check first so a brand-new deployment
  // can immediately log in with the default admin.
  await ensureBootstrapAdmin();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const { username, password } = (body ?? {}) as {
    username?: unknown;
    password?: unknown;
  };

  if (typeof username !== 'string' || typeof password !== 'string') {
    return NextResponse.json(
      { success: false, error: 'Both "username" and "password" are required.' },
      { status: 400 },
    );
  }

  const record = await getUserByUsername(username.trim());
  if (!record) {
    return NextResponse.json(
      { success: false, error: 'Invalid credentials.' },
      { status: 401 },
    );
  }
  if (!record.isActive) {
    return NextResponse.json(
      { success: false, error: 'This user is disabled. Contact an administrator.' },
      { status: 401 },
    );
  }
  const ok = await verifyPassword(password, record.passwordHash);
  if (!ok) {
    return NextResponse.json(
      { success: false, error: 'Invalid credentials.' },
      { status: 401 },
    );
  }

  const token = await signAuthToken({
    sub: record.id,
    username: record.username,
    role: record.role,
  });

  // Fire-and-forget audit write. The user is already authenticated at
  // this point; a DB error here must not fail the login.
  void markLoginSuccess(record.id);

  const authUser = toAuthUser(record);
  const res = NextResponse.json({ success: true, data: authUser });
  res.cookies.set(AUTH_COOKIE_NAME, token, authCookieOptions());
  return res;
}
