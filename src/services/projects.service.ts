import type { Project } from '@/types/model';
import type { CreateProjectRequest } from '@/types/api';
import type { ScopeCounts } from '@/types/versioning';
import { apiGet, apiPost, LONG_TIMEOUT_MS } from './http';

import { API_BASE } from '@/services/apiBase';

export function listProjects(): Promise<Project[]> {
  return apiGet<Project[]>(`${API_BASE}/api/projects`);
}

/** Crea el proyecto (doc 75 D15): vacío o copiando bloques de Data Standards
 *  de otro (`copyFrom`). Acción larga: timeout extendido + overlay del caller. */
export function createProject(data: CreateProjectRequest): Promise<Project> {
  return apiPost<Project>(`${API_BASE}/api/projects`, data, { timeoutMs: LONG_TIMEOUT_MS });
}

/** Conteos de activos del proyecto (diálogo «Delete project…», doc 75 D5). */
export function getProjectCounts(projectId: string): Promise<ScopeCounts> {
  return apiGet<ScopeCounts>(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/counts`);
}
