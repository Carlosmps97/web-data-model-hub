// Models API - List all models (optionally by project) and create new ones
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getModels, createModel } from '@/server/db/mongo';
import { success, error } from '@/server/http/response';
import {
  handleAuthError,
  requireProjectAccess,
  requireUser,
} from '@/server/auth/session';
import {
  canViewModel,
  canViewProject,
  isAdmin,
} from '@/server/auth/permissions';
import type { DataModel } from '@/types/model';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId') || undefined;
    // Pass `?full=true` when the caller needs full table/relationship
    // payloads (e.g. the Global Canvas). Default keeps the lightweight
    // stub behaviour used by listing screens so card grids stay fast.
    const full = searchParams.get('full') === 'true';
    const models = await getModels(projectId, { full });
    // Admins see everything. Other roles keep only models they can
    // `view` — either via a project-scope grant or an explicit model
    // grant.
    const filtered = isAdmin(user)
      ? models
      : models.filter(
          (m) =>
            canViewProject(user, m.projectId) ||
            canViewModel(user, m.id, m.projectId),
        );
    return success(filtered);
  } catch (err) {
    const authResp = handleAuthError(err);
    if (authResp) return authResp;
    return error(`Failed to fetch models: ${err}`, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, name, description, tables, relationships } = body;

    if (!projectId || !name) {
      return error('projectId and name are required');
    }

    // Creating a model requires edit access to its parent project.
    // Model-scope grants alone do not authorize this — they're meant
    // for read-only collaborators on a subset of existing models.
    await requireProjectAccess(String(projectId), 'edit');

    const now = new Date().toISOString();
    const model: DataModel = {
      id: uuidv4(),
      projectId,
      name: name.trim(),
      description: description?.trim() || undefined,
      tables: tables || [],
      relationships: relationships || [],
      createdAt: now,
      updatedAt: now,
    };

    const created = await createModel(model);
    return success(created, 201);
  } catch (err) {
    const authResp = handleAuthError(err);
    if (authResp) return authResp;
    return error(`Failed to create model: ${err}`, 500);
  }
}
