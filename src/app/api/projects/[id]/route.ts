// Single project API - Get, Update, Delete
import { NextRequest } from 'next/server';
import { getProject, updateProject, deleteProject } from '@/lib/storage/jsonStore';
import { success, error } from '@/lib/utils/response';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const project = await getProject(id);
    if (!project) return error('Project not found', 404);
    return success(project);
  } catch (err) {
    return error(`Failed to fetch project: ${err}`, 500);
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const updated = await updateProject(id, body);
    if (!updated) return error('Project not found', 404);
    return success(updated);
  } catch (err) {
    return error(`Failed to update project: ${err}`, 500);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const deleted = await deleteProject(id);
    if (!deleted) return error('Project not found', 404);
    return success({ deleted: true });
  } catch (err) {
    return error(`Failed to delete project: ${err}`, 500);
  }
}
