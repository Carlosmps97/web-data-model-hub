/**
 * Projects service — CRUD del recurso `Project`.
 *
 * Envuelve `/api/projects*` con tipos fuertes. Todas las funciones
 * propagan `ApiError` (ver `http.ts`) si el backend devuelve no-éxito;
 * los consumidores son responsables de capturar y mostrar feedback.
 */

import type { Project } from '@/types/model';
import type { CreateProjectRequest, UpdateProjectRequest } from '@/types/api';
import { apiGet, apiPost, apiPut, apiDelete } from './http';

export function listProjects(): Promise<Project[]> {
  return apiGet<Project[]>('/api/projects');
}

export function getProject(id: string): Promise<Project> {
  return apiGet<Project>(`/api/projects/${id}`);
}

export function createProject(data: CreateProjectRequest): Promise<Project> {
  return apiPost<Project>('/api/projects', data);
}

export function updateProject(id: string, patch: UpdateProjectRequest): Promise<Project> {
  return apiPut<Project>(`/api/projects/${id}`, patch);
}

export function deleteProject(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/api/projects/${id}`);
}
