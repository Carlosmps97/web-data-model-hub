// Single project API - Get, Update, Delete
import { NextRequest } from 'next/server';
import { getProject, updateProject, deleteProject } from '@/server/db/mongo';
import { success, error } from '@/server/http/response';
import {
  handleAuthError,
  requireAdmin,
  requireProjectAccess,
} from '@/server/auth/session';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireProjectAccess(id, 'view');
    const project = await getProject(id);
    if (!project) return error('Project not found', 404);
    return success(project);
  } catch (err) {
    const authResp = handleAuthError(err);
    if (authResp) return authResp;
    return error(`Failed to fetch project: ${err}`, 500);
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireProjectAccess(id, 'edit');
    const body = await request.json();
    const updated = await updateProject(id, body);
    if (!updated) return error('Project not found', 404);
    return success(updated);
  } catch (err) {
    const authResp = handleAuthError(err);
    if (authResp) return authResp;
    return error(`Failed to update project: ${err}`, 500);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    // Project deletion is destructive (it cascades across models and
    // their children). Keep it admin-only to avoid accidents by an
    // editor who happens to have edit rights over the project.
    await requireAdmin();
    const { id } = await params;
    const deleted = await deleteProject(id);
    if (!deleted) return error('Project not found', 404);
    return success({ deleted: true });
  } catch (err) {
    const authResp = handleAuthError(err);
    if (authResp) return authResp;
    return error(`Failed to delete project: ${err}`, 500);
  }
}
