// Single model API - Get, Update, Delete
import { NextRequest } from 'next/server';
import { getModel, updateModel, deleteModel } from '@/server/db/mongo';
import { success, error } from '@/server/http/response';
import {
  handleAuthError,
  requireModelAccess,
} from '@/server/auth/session';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    // Load the model first so we know its projectId, then assert
    // access. A 404 before auth keeps the endpoint from leaking the
    // existence of models the caller can't see.
    const model = await getModel(id);
    if (!model) return error('Model not found', 404);
    await requireModelAccess(id, model.projectId, 'view');
    return success(model);
  } catch (err) {
    const authResp = handleAuthError(err);
    if (authResp) return authResp;
    return error(`Failed to fetch model: ${err}`, 500);
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const existing = await getModel(id);
    if (!existing) return error('Model not found', 404);
    await requireModelAccess(id, existing.projectId, 'edit');
    const body = await request.json();
    const updated = await updateModel(id, body);
    if (!updated) return error('Model not found', 404);
    return success(updated);
  } catch (err) {
    const authResp = handleAuthError(err);
    if (authResp) return authResp;
    return error(`Failed to update model: ${err}`, 500);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const existing = await getModel(id);
    if (!existing) return error('Model not found', 404);
    await requireModelAccess(id, existing.projectId, 'edit');
    const deleted = await deleteModel(id);
    if (!deleted) return error('Model not found', 404);
    return success({ deleted: true });
  } catch (err) {
    const authResp = handleAuthError(err);
    if (authResp) return authResp;
    return error(`Failed to delete model: ${err}`, 500);
  }
}
