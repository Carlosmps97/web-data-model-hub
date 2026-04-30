/**
 * Client-safe permission helpers. Pure functions — no DB, no cookies,
 * no server-only imports. The server-side equivalent in
 * `@/server/auth/permissions` re-exports from this module plus adds
 * request-payload validation.
 *
 * These are used by the React components and the zustand auth store
 * to decide which UI controls to disable for viewers, which project
 * cards to hide, etc.
 */

import type { AuthUser, Permission, PermissionLevel, UserRole } from '@/types/auth';

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
    if (matchesProject(perm, projectId)) {
      if (perm.level === 'edit') return 'edit';
      best = best ?? 'view';
    }
  }
  return best;
}

export function modelAccessLevel(
  user: AuthUser | null | undefined,
  modelId: string,
  projectId: string,
): PermissionLevel | null {
  if (!user || !user.isActive) return null;
  if (user.role === 'admin') return 'edit';
  let best: PermissionLevel | null = null;
  for (const perm of user.permissions) {
    if (perm.scope === 'model' && perm.modelId === modelId) {
      if (perm.level === 'edit') return 'edit';
      best = best ?? 'view';
    } else if (perm.scope === 'project' && perm.projectId === projectId) {
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

export function canViewModel(
  user: AuthUser | null | undefined,
  modelId: string,
  projectId: string,
): boolean {
  return modelAccessLevel(user, modelId, projectId) !== null;
}

export function canEditModel(
  user: AuthUser | null | undefined,
  modelId: string,
  projectId: string,
): boolean {
  return modelAccessLevel(user, modelId, projectId) === 'edit';
}

export function visibleProjectIds(user: AuthUser | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!user || !user.isActive) return out;
  for (const perm of user.permissions) {
    out.add(perm.projectId);
  }
  return out;
}

function matchesProject(perm: Permission, projectId: string): boolean {
  if (perm.scope === 'project') return perm.projectId === projectId;
  if (perm.scope === 'model') return perm.projectId === projectId;
  return false;
}
