// Models API - List all models (optionally by project) and create new ones
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getModels, createModel } from '@/lib/storage/jsonStore';
import { success, error } from '@/lib/utils/response';
import type { DataModel } from '@/types/model';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId') || undefined;
    const models = await getModels(projectId);
    return success(models);
  } catch (err) {
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
    return error(`Failed to create model: ${err}`, 500);
  }
}
