/**
 * Session helpers for route handlers.
 *
 * `getAuthUser` is the entry point: it reads the cookie, verifies the
 * JWT, loads the freshest user record from the DB, and returns a
 * sanitized `AuthUser` (or null). The DB hit is intentional — it
 * picks up `isActive` flips and permission changes mid-session
 * without having to re-login.
 *
 * `requireUser` / `requireAdmin` / `require[Project|Model]Access` are
 * thin wrappers that throw a typed `AuthError` when the caller is
 * unauthorized. Route handlers catch these and turn them into 401/403
 * responses via `handleAuthError`.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { AuthUser, PermissionLevel } from '@/types/auth';
import { getUserById } from '@/server/db/users';
import { AUTH_COOKIE_NAME, verifyAuthToken } from './jwt';
import {
  canEditModel,
  canEditProject,
  canViewModel,
  canViewProject,
  isAdmin,
} from './permissions';

export type AuthErrorKind =
  | 'unauthenticated'
  | 'inactive'
  | 'forbidden';

export class AuthError extends Error {
  kind: AuthErrorKind;
  constructor(kind: AuthErrorKind, message?: string) {
    super(message ?? kind);
    this.kind = kind;
    this.name = 'AuthError';
  }
}

function toAuthUser(record: {
  id: string;
  username: string;
  role: AuthUser['role'];
  isActive: boolean;
  permissions: AuthUser['permissions'];
  createdAt: string;
  statusUpdatedAt: string;
  lastLoginAt?: string;
}): AuthUser {
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

/**
 * Returns the current session user or `null` if there's no valid
 * cookie. Always re-reads the user from the DB so admin changes
 * (deactivation, permission revocation) take effect mid-session.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const jar = await cookies();
  const token = jar.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  const claims = await verifyAuthToken(token);
  if (!claims) return null;
  const record = await getUserById(claims.sub);
  if (!record) return null;
  return toAuthUser(record);
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) throw new AuthError('unauthenticated');
  if (!user.isActive) throw new AuthError('inactive', 'This user is disabled.');
  return user;
}

export async function requireAdmin(): Promise<AuthUser> {
  const user = await requireUser();
  if (!isAdmin(user)) throw new AuthError('forbidden', 'Admin role required.');
  return user;
}

export async function requireProjectAccess(
  projectId: string,
  level: PermissionLevel,
): Promise<AuthUser> {
  const user = await requireUser();
  const ok = level === 'view'
    ? canViewProject(user, projectId)
    : canEditProject(user, projectId);
  if (!ok) throw new AuthError('forbidden', `No ${level} access to project ${projectId}.`);
  return user;
}

export async function requireModelAccess(
  modelId: string,
  projectId: string,
  level: PermissionLevel,
): Promise<AuthUser> {
  const user = await requireUser();
  const ok = level === 'view'
    ? canViewModel(user, modelId, projectId)
    : canEditModel(user, modelId, projectId);
  if (!ok) throw new AuthError('forbidden', `No ${level} access to model ${modelId}.`);
  return user;
}

/**
 * Translates an AuthError into the HTTP response route handlers
 * should return. Other exceptions are re-thrown so the Next.js
 * default handler can surface them.
 */
export function handleAuthError(err: unknown): NextResponse | null {
  if (!(err instanceof AuthError)) return null;
  const status = err.kind === 'unauthenticated' ? 401 : 403;
  return NextResponse.json(
    { success: false, error: err.message, code: err.kind },
    { status },
  );
}
