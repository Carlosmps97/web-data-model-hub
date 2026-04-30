/**
 * Global auth middleware.
 *
 * Runs on every matched request BEFORE the route handler. It:
 *
 *   1. Verifies the JWT cookie.
 *   2. For HTML page requests → redirects to `/login?next=…` when
 *      missing/invalid.
 *   3. For API requests → returns a 401 JSON body (the frontend
 *      catches this and forces a logout).
 *   4. Lets `/login`, `/api/auth/login`, and static assets through
 *      without checks.
 *
 * Finer-grained checks (is the user admin? does they have access to
 * this specific project?) live in the route handlers — middleware
 * only enforces "signed-in".
 */

import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME, verifyAuthToken } from '@/server/auth/jwt';

// Paths that skip the auth check entirely.
const PUBLIC_PATHS = new Set<string>([
  '/login',
  '/api/auth/login',
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // The middleware matcher (bottom of this file) already excludes
  // `/_next` and static assets, so we don't need to re-check them.
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const claims = token ? await verifyAuthToken(token) : null;

  if (!claims) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated.', code: 'unauthenticated' },
        { status: 401 },
      );
    }
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    const next = `${pathname}${search ?? ''}`;
    if (next && next !== '/') loginUrl.searchParams.set('next', next);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

/**
 * Matcher excludes:
 *   - `/_next/*` (build artefacts)
 *   - any file-like path with an extension (static assets such as
 *     `favicon.ico`, logos, images) — leaves dynamic routes alone.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)).*)',
  ],
};
