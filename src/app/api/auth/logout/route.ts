/**
 * POST /api/auth/logout — clears the session cookie.
 *
 * Idempotent: returns 200 even when no cookie was set.
 */

import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, authCookieOptions } from '@/server/auth/jwt';

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(AUTH_COOKIE_NAME, '', {
    ...authCookieOptions(),
    maxAge: 0,
  });
  return res;
}
