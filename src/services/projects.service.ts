import type { Project } from '@/types/model';
import type { CreateProjectRequest, UpdateProjectRequest } from '@/types/api';
import { apiGet, apiPost, apiPut, apiDelete } from './http';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export function listProjects(): Promise<Project[]> {
  return apiGet<Project[]>(`${API_BASE}/api/projects`);
}

export function getProject(id: string): Promise<Project> {
  return apiGet<Project>(`${API_BASE}/api/projects/${id}`);
}

export function createProject(data: CreateProjectRequest): Promise<Project> {
  return apiPost<Project>(`${API_BASE}/api/projects`, data);
}

export function updateProject(id: string, patch: UpdateProjectRequest): Promise<Project> {
  return apiPut<Project>(`${API_BASE}/api/projects/${id}`, patch);
}

export function deleteProject(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`${API_BASE}/api/projects/${id}`);
}
