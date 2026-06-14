/**
 * Client-safe permission helpers. Pure functions — no DB, no cookies, no
 * server-only imports. Used by React components and the auth store to decide
 * which controls to disable for viewers, which project cards to hide, etc.
 *
 * Project-centric model: a project is the unit of access (one canvas per
 * project), so all checks are project-scoped.
 */

import type { AuthUser, PermissionLevel, UserRole } from '@/types/auth';

export function isAdminRole(role: UserRole): boolean {
  return role === 'admin';
}

export function isAdmin(user: Pick<AuthUser, 'role'> | null | undefined): boolean {
  return !!user && user.role === 'admin';
}

export function projectAccessLevel(
  user: AuthUser | null | undefined,
  projectId: string,
): PermissionLevel | null {
  if (!user || !user.isActive) return null;
  if (user.role === 'admin') return 'edit';
  let best: PermissionLevel | null = null;
  for (const perm of user.permissions) {
    if (perm.projectId === projectId) {
      if (perm.level === 'edit') return 'edit';
      best = best ?? 'view';
    }
  }
  return best;
}

export function canViewProject(user: AuthUser | null | undefined, projectId: string): boolean {
  return projectAccessLevel(user, projectId) !== null;
}

export function canEditProject(user: AuthUser | null | undefined, projectId: string): boolean {
  return projectAccessLevel(user, projectId) === 'edit';
}

export function visibleProjectIds(user: AuthUser | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!user || !user.isActive) return out;
  for (const perm of user.permissions) {
    out.add(perm.projectId);
  }
  return out;
}
