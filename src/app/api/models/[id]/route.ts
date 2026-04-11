// Single model API - Get, Update, Delete
import { NextRequest } from 'next/server';
import { getModel, updateModel, deleteModel } from '@/lib/storage/jsonStore';
import { success, error } from '@/lib/utils/response';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const model = await getModel(id);
    if (!model) return error('Model not found', 404);
    return success(model);
  } catch (err) {
    return error(`Failed to fetch model: ${err}`, 500);
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const updated = await updateModel(id, body);
    if (!updated) return error('Model not found', 404);
    return success(updated);
  } catch (err) {
    return error(`Failed to update model: ${err}`, 500);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const deleted = await deleteModel(id);
    if (!deleted) return error('Model not found', 404);
    return success({ deleted: true });
  } catch (err) {
    return error(`Failed to delete model: ${err}`, 500);
  }
}
