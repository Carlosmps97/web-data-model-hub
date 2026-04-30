/**
 * Server-side permission helpers.
 *
 * The *pure* checks (isAdmin, canView*, canEdit*, visibleProjectIds,
 * …) live in `@/lib/auth/permissions` and are re-exported from here
 * so route handlers only import from one place. This module adds
 * `validatePermissions`, which is a server-only concern (parses raw
 * request payloads and throws on bad shape).
 */

import type { Permission } from '@/types/auth';

export {
  canEditModel,
  canEditProject,
  canViewModel,
  canViewProject,
  isAdmin,
  isAdminRole,
  modelAccessLevel,
  projectAccessLevel,
  visibleProjectIds,
} from '@/lib/auth/permissions';

/** Validate a raw permissions array from an admin payload. Throws on bad shape. */
export function validatePermissions(input: unknown): Permission[] {
  if (!Array.isArray(input)) throw new Error('permissions must be an array');
  return input.map((raw, idx) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`permission[${idx}] must be an object`);
    }
    const p = raw as Record<string, unknown>;
    const level = p.level === 'edit' || p.level === 'view' ? p.level : null;
    if (!level) throw new Error(`permission[${idx}].level must be "view" or "edit"`);
    const projectId = typeof p.projectId === 'string' ? p.projectId : null;
    if (!projectId) throw new Error(`permission[${idx}].projectId must be a string`);
    if (p.scope === 'project') {
      return { scope: 'project', projectId, level };
    }
    if (p.scope === 'model') {
      const modelId = typeof p.modelId === 'string' ? p.modelId : null;
      if (!modelId) throw new Error(`permission[${idx}].modelId must be a string`);
      return { scope: 'model', projectId, modelId, level };
    }
    throw new Error(`permission[${idx}].scope must be "project" or "model"`);
  });
}
