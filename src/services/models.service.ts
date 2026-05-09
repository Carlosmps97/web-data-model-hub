import type { DataModel, NodePosition } from '@/types/model';
import type { CreateModelRequest } from '@/types/api';
import { apiGet, apiPost, apiPut, apiDelete, apiFetch } from './http';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

interface ListOptions {
  projectId?: string;
  full?: boolean;
}

export function listModels(opts: ListOptions = {}): Promise<DataModel[]> {
  const params = new URLSearchParams();
  if (opts.projectId) params.set('projectId', opts.projectId);
  if (opts.full) params.set('full', 'true');
  const qs = params.toString();
  return apiGet<DataModel[]>(`${API_BASE}/api/models${qs ? `?${qs}` : ''}`);
}

export function getModel(id: string): Promise<DataModel> {
  return apiGet<DataModel>(`${API_BASE}/api/models/${id}`);
}

export function createModel(data: CreateModelRequest): Promise<DataModel> {
  return apiPost<DataModel>(`${API_BASE}/api/models`, data);
}

export function updateModel(id: string, patch: Partial<DataModel>): Promise<DataModel> {
  return apiPut<DataModel>(`${API_BASE}/api/models/${id}`, patch);
}

export function deleteModel(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`${API_BASE}/api/models/${id}`);
}

/**
 * Persist only the canvas positions of the given tables/views. Tiny
 * payload, intentionally separate from {@link updateModel}'s full PUT
 * so the drag debounce doesn't round-trip MB-sized models.
 *
 * Backend: `PATCH /api/models/{id}/positions`.
 */
export function updatePositions(
  modelId: string,
  payload: {
    tables?: Record<string, NodePosition>;
    views?: Record<string, NodePosition>;
  },
): Promise<{ tables: number; views: number }> {
  return apiFetch<{ tables: number; views: number }>(
    `${API_BASE}/api/models/${encodeURIComponent(modelId)}/positions`,
    { method: 'PATCH', body: payload },
  );
}
