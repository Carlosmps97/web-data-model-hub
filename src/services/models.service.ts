import type { DataModel } from '@/types/model';
import type { CreateModelRequest } from '@/types/api';
import { apiGet, apiPost, apiPut, apiDelete } from './http';

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
