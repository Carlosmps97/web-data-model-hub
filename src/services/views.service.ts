// Views service (R4c). CRUD de las vistas asociadas a una tabla. El backend
// devuelve el envelope `{ success, data }`, que `apiGet/apiPost/...` ya
// desempaquetan; estos helpers sólo dan tipos y construyen las URLs.
//
// Las vistas NO son changeset-aware (a diferencia de governance): son recursos
// REST directos sobre `/api/views`. Lectura/escritura van siempre al mismo
// endpoint publicado.

import type { Tag } from '@/types/model';
import { apiGet, apiPost, apiPut, apiDelete } from './http';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const VIEWS = `${API_BASE}/api/views`;

/** Una fuente (tabla origen) dentro de una vista, con alias/expresión opcionales. */
export interface ViewSource {
  table: string;
  outputAlias?: string;
  expression?: string;
}

/** Vista persistida (forma completa del backend R4c). */
export interface View {
  id: string;
  tableId?: string;
  name: string;
  schema?: string;
  tags?: Tag[];
  filter?: string;
  sources?: ViewSource[];
  outputAlias?: string;
  expression?: string;
  sql?: string;
  description?: string;
}

/** Body de creación/actualización (sin `id`, lo asigna/usa el backend). */
export interface ViewInput {
  tableId?: string;
  name: string;
  schema?: string;
  tags?: Tag[];
  filter?: string;
  sources?: ViewSource[];
  outputAlias?: string;
  expression?: string;
  sql?: string;
  description?: string;
}

/** Vistas de una tabla concreta. */
export function listViews(tableId: string): Promise<View[]> {
  return apiGet<View[]>(`${VIEWS}?tableId=${encodeURIComponent(tableId)}`);
}

export function createView(body: ViewInput): Promise<View> {
  return apiPost<View>(VIEWS, body);
}

export function updateView(id: string, body: ViewInput): Promise<View> {
  return apiPut<View>(`${VIEWS}/${encodeURIComponent(id)}`, body);
}

export function deleteView(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`${VIEWS}/${encodeURIComponent(id)}`);
}
