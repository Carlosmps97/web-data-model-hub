export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me — returns the current session user, or 401 if the
 * session is invalid / expired / deactivated.
 *
 * The frontend calls this on every page load to hydrate its auth
 * store. The DB roundtrip inside `getAuthUser` makes permission
 * flips visible immediately without a re-login.
 */

import { NextResponse } from 'next/server';
import { getAuthUser } from '@/server/auth/session';

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Not authenticated.', code: 'unauthenticated' },
      { status: 401 },
    );
  }
  if (!user.isActive) {
    return NextResponse.json(
      { success: false, error: 'This user is disabled.', code: 'inactive' },
      { status: 401 },
    );
  }
  return NextResponse.json({ success: true, data: user });
}
