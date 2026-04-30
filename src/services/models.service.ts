/**
 * Models service — CRUD del recurso `DataModel`.
 *
 * `listModels` aporta el dualismo `full` vs stubs: el listado default
 * devuelve tablas vacías (solo el conteo), usado por home/dashboard.
 * Con `{ full: true }` el backend carga tablas + relationships + views
 * reales — lo que el Global Canvas y el editor individual necesitan.
 */

import type { DataModel } from '@/types/model';
import type { CreateModelRequest } from '@/types/api';
import { apiGet, apiPost, apiPut, apiDelete } from './http';

interface ListOptions {
  projectId?: string;
  /** Cuando es `true`, el backend devuelve modelos con tablas y
   *  relaciones cargadas. Default: stubs ligeros. */
  full?: boolean;
}

export function listModels(opts: ListOptions = {}): Promise<DataModel[]> {
  const params = new URLSearchParams();
  if (opts.projectId) params.set('projectId', opts.projectId);
  if (opts.full) params.set('full', 'true');
  const qs = params.toString();
  return apiGet<DataModel[]>(`/api/models${qs ? `?${qs}` : ''}`);
}

export function getModel(id: string): Promise<DataModel> {
  return apiGet<DataModel>(`/api/models/${id}`);
}

export function createModel(data: CreateModelRequest): Promise<DataModel> {
  return apiPost<DataModel>('/api/models', data);
}

/** Update completo o parcial del modelo. El backend acepta un merge
 *  tipo PUT (reemplaza las listas que vienen en el body). */
export function updateModel(id: string, patch: Partial<DataModel>): Promise<DataModel> {
  return apiPut<DataModel>(`/api/models/${id}`, patch);
}

export function deleteModel(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/api/models/${id}`);
}
