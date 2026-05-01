/**
 * /api/admin/users — admin-only endpoints to list and create users.
 *
 * GET  returns every user (password hashes stripped).
 * POST creates a new user with the provided credentials and grants.
 *      Rejects on duplicate username and on malformed payload.
 */

import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import type { AuthUser, Permission, UserRole, UserRecord } from '@/types/auth';
import {
  createUser,
  getUserByUsername,
  listUsers,
} from '@/server/db/users';
import { hashPassword } from '@/server/auth/password';
import { validatePermissions } from '@/server/auth/permissions';
import { handleAuthError, requireAdmin } from '@/server/auth/session';
import { ensureBootstrapAdmin } from '@/server/auth/bootstrap';

function toAuthUser(r: UserRecord): AuthUser {
  return {
    id: r.id,
    username: r.username,
    role: r.role,
    isActive: r.isActive,
    permissions: r.permissions,
    createdAt: r.createdAt,
    statusUpdatedAt: r.statusUpdatedAt,
    lastLoginAt: r.lastLoginAt,
  };
}

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
    await ensureBootstrapAdmin();
    const records = await listUsers();
    return NextResponse.json({ success: true, data: records.map(toAuthUser) });
  } catch (err) {
    const authResp = handleAuthError(err);
    if (authResp) return authResp;
    console.error('[admin/users GET]', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error.' },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body.' },
        { status: 400 },
      );
    }

    const validated = validateCreatePayload(body);
    if ('error' in validated) {
      return NextResponse.json(
        { success: false, error: validated.error },
        { status: 400 },
      );
    }
    const { username, password, role, isActive, permissions } = validated;

    const existing = await getUserByUsername(username);
    if (existing) {
      return NextResponse.json(
        { success: false, error: `Username "${username}" is already taken.` },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const record: UserRecord = {
      id: uuidv4(),
      username,
      passwordHash: await hashPassword(password),
      role,
      isActive,
      // Admins implicitly own everything, so we drop the list for them.
      permissions: role === 'admin' ? [] : permissions,
      createdAt: now,
      statusUpdatedAt: now,
    };
    await createUser(record);
    return NextResponse.json({ success: true, data: toAuthUser(record) });
  } catch (err) {
    const authResp = handleAuthError(err);
    if (authResp) return authResp;
    console.error('[admin/users POST]', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error.' },
      { status: 500 },
    );
  }
}

interface CreateUserPayload {
  username: string;
  password: string;
  role: UserRole;
  isActive: boolean;
  permissions: Permission[];
}

function validateCreatePayload(
  body: unknown,
): CreateUserPayload | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Payload must be an object.' };
  const p = body as Record<string, unknown>;

  const username = typeof p.username === 'string' ? p.username.trim() : '';
  if (!username) return { error: 'username is required.' };
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    return { error: 'username must be 3-32 chars, letters / digits / . _ -' };
  }

  const password = typeof p.password === 'string' ? p.password : '';
  if (password.length < 6) {
    return { error: 'password must be at least 6 characters long.' };
  }

  const role = p.role;
  if (role !== 'admin' && role !== 'editor' && role !== 'viewer') {
    return { error: 'role must be "admin", "editor" or "viewer".' };
  }

  const isActive = typeof p.isActive === 'boolean' ? p.isActive : true;

  let permissions: Permission[];
  try {
    permissions = validatePermissions(p.permissions ?? []);
  } catch (err) {
    return { error: (err as Error).message };
  }

  return { username, password, role, isActive, permissions };
}
