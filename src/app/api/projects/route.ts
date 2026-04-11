// Projects API - List all projects and create new ones
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getProjects, createProject } from '@/lib/storage/jsonStore';
import { success, error } from '@/lib/utils/response';
import type { Project } from '@/types/model';

export async function GET() {
  try {
    const projects = await getProjects();
    return success(projects);
  } catch (err) {
    return error(`Failed to fetch projects: ${err}`, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return error('Project name is required');
    }

    const now = new Date().toISOString();
    const project: Project = {
      id: uuidv4(),
      name: name.trim(),
      description: description?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    const created = await createProject(project);
    return success(created, 201);
  } catch (err) {
    return error(`Failed to create project: ${err}`, 500);
  }
}
