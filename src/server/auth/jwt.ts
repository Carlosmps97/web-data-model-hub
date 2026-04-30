/**
 * JWT sign / verify, built on `jose` (edge-runtime compatible — key
 * for using this inside Next.js middleware).
 *
 * The signing key is derived from `AUTH_SECRET` in the environment. A
 * dev fallback is used when unset; this is safe because Cosmos DB
 * access requires `COSMOS_CONNECTION_STRING` anyway, so there's no
 * multi-user exposure in dev.
 *
 * Tokens are symmetric (HS256). Ten-hour lifetime matches a typical
 * "one workday" session without the noise of a sliding refresh
 * scheme.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { AuthJwtClaims } from '@/types/auth';

const TOKEN_LIFETIME_SECONDS = 10 * 60 * 60; // 10 hours
const JWT_ALG = 'HS256';

/** Cookie name carrying the session token. */
export const AUTH_COOKIE_NAME = 'modeler-auth';

function getSecret(): Uint8Array {
  const secret =
    process.env.AUTH_SECRET ||
    'dev-only-secret-please-override-in-production-via-AUTH_SECRET-env';
  return new TextEncoder().encode(secret);
}

export async function signAuthToken(claims: AuthJwtClaims): Promise<string> {
  const { sub, username, role } = claims;
  return await new SignJWT({ username, role })
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_LIFETIME_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyAuthToken(token: string): Promise<AuthJwtClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: [JWT_ALG],
    });
    if (!payload.sub) return null;
    return payloadToClaims(payload);
  } catch {
    return null;
  }
}

function payloadToClaims(p: JWTPayload): AuthJwtClaims {
  return {
    sub: String(p.sub),
    username: String(p.username ?? ''),
    role: (p.role as AuthJwtClaims['role']) ?? 'viewer',
    iat: p.iat,
    exp: p.exp,
  };
}

/** Cookie options used when setting the auth cookie on a response. */
export function authCookieOptions(): {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TOKEN_LIFETIME_SECONDS,
  };
}
