// Projects API - List all projects and create new ones
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getProjects, createProject } from '@/server/db/mongo';
import { success, error } from '@/server/http/response';
import {
  handleAuthError,
  requireAdmin,
  requireUser,
} from '@/server/auth/session';
import { isAdmin, visibleProjectIds } from '@/server/auth/permissions';
import type { Project } from '@/types/model';

export async function GET() {
  try {
    const user = await requireUser();
    const projects = await getProjects();
    // Admins see everything; other roles see only projects for which
    // they have at least one grant (project-scope OR model-scope).
    const filtered = isAdmin(user)
      ? projects
      : projects.filter((p) => visibleProjectIds(user).has(p.id));
    return success(filtered);
  } catch (err) {
    const authResp = handleAuthError(err);
    if (authResp) return authResp;
    return error(`Failed to fetch projects: ${err}`, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    // Only admins can spin up new projects. Editors work within
    // projects an admin onboarded.
    await requireAdmin();
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
    const authResp = handleAuthError(err);
    if (authResp) return authResp;
    return error(`Failed to create project: ${err}`, 500);
  }
}
