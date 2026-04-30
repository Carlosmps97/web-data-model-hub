/**
 * /api/admin/users/[id] — admin-only endpoints for a specific user.
 *
 * PUT    patches role, isActive, permissions, or (optionally) the
 *        password — each field is independent and only touched when
 *        present in the payload.
 * DELETE removes the user entirely. The admin cannot delete
 *        themselves (that's a foot-gun check, not a security one).
 */

import { NextResponse } from 'next/server';
import type { AuthUser, Permission, UserRole, UserRecord } from '@/types/auth';
import {
  deleteUser,
  getUserById,
  getUserByUsername,
  updateUser,
} from '@/server/db/users';
import { hashPassword } from '@/server/auth/password';
import { validatePermissions } from '@/server/auth/permissions';
import { handleAuthError, requireAdmin } from '@/server/auth/session';

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

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const self = await requireAdmin();
    const { id } = await ctx.params;
    const existing = await getUserById(id);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'User not found.' },
        { status: 404 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body.' },
        { status: 400 },
      );
    }

    const patch = validateUpdatePayload(body);
    if ('error' in patch) {
      return NextResponse.json(
        { success: false, error: patch.error },
        { status: 400 },
      );
    }

    // Safety nets — the admin cannot lock themselves out accidentally.
    if (self.id === id) {
      if (patch.isActive === false) {
        return NextResponse.json(
          { success: false, error: 'You cannot deactivate your own account.' },
          { status: 400 },
        );
      }
      if (patch.role && patch.role !== 'admin') {
        return NextResponse.json(
          { success: false, error: 'You cannot demote your own admin role.' },
          { status: 400 },
        );
      }
    }

    // Username changes collide with unique index — check before write.
    if (patch.username && patch.username !== existing.username) {
      const clash = await getUserByUsername(patch.username);
      if (clash) {
        return NextResponse.json(
          { success: false, error: `Username "${patch.username}" is already taken.` },
          { status: 409 },
        );
      }
    }

    const updates: Partial<Omit<UserRecord, 'id'>> = {};
    if (patch.username !== undefined) updates.username = patch.username;
    if (patch.role !== undefined) {
      updates.role = patch.role;
      // Admins implicitly own everything; normalize permissions when
      // promoting to admin so stale grants don't pollute the record.
      if (patch.role === 'admin' && patch.permissions === undefined) {
        updates.permissions = [];
      }
    }
    if (patch.isActive !== undefined && patch.isActive !== existing.isActive) {
      updates.isActive = patch.isActive;
      updates.statusUpdatedAt = new Date().toISOString();
    }
    if (patch.permissions !== undefined) {
      updates.permissions =
        (updates.role ?? existing.role) === 'admin' ? [] : patch.permissions;
    }
    if (patch.password !== undefined) {
      updates.passwordHash = await hashPassword(patch.password);
    }

    const updated = await updateUser(id, updates);
    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'User not found.' },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, data: toAuthUser(updated) });
  } catch (err) {
    const authResp = handleAuthError(err);
    if (authResp) return authResp;
    throw err;
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const self = await requireAdmin();
    const { id } = await ctx.params;
    if (self.id === id) {
      return NextResponse.json(
        { success: false, error: 'You cannot delete your own account.' },
        { status: 400 },
      );
    }
    const ok = await deleteUser(id);
    if (!ok) {
      return NextResponse.json(
        { success: false, error: 'User not found.' },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const authResp = handleAuthError(err);
    if (authResp) return authResp;
    throw err;
  }
}

interface UpdateUserPayload {
  username?: string;
  password?: string;
  role?: UserRole;
  isActive?: boolean;
  permissions?: Permission[];
}

function validateUpdatePayload(
  body: unknown,
): UpdateUserPayload | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Payload must be an object.' };
  const p = body as Record<string, unknown>;
  const out: UpdateUserPayload = {};

  if (p.username !== undefined) {
    if (typeof p.username !== 'string') return { error: 'username must be a string.' };
    const trimmed = p.username.trim();
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(trimmed)) {
      return { error: 'username must be 3-32 chars, letters / digits / . _ -' };
    }
    out.username = trimmed;
  }

  if (p.password !== undefined) {
    if (typeof p.password !== 'string' || p.password.length < 6) {
      return { error: 'password must be at least 6 characters long.' };
    }
    out.password = p.password;
  }

  if (p.role !== undefined) {
    if (p.role !== 'admin' && p.role !== 'editor' && p.role !== 'viewer') {
      return { error: 'role must be "admin", "editor" or "viewer".' };
    }
    out.role = p.role;
  }

  if (p.isActive !== undefined) {
    if (typeof p.isActive !== 'boolean') return { error: 'isActive must be a boolean.' };
    out.isActive = p.isActive;
  }

  if (p.permissions !== undefined) {
    try {
      out.permissions = validatePermissions(p.permissions);
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  return out;
}
