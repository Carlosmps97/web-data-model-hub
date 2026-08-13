import { apiGet, apiPost, apiPut } from '@/services/http';

import { API_BASE } from '@/services/apiBase';
const CS = `${API_BASE}/api/changesets`;

export interface ChangesetDiff { added: string[]; modified: string[]; removed: string[]; }
// Cabecera del changeset. Los cambios en sí viven en la colección
// `changeset_changes` del backend (un doc por cambio) y
// NUNCA viajan crudos al cliente — se consumen vía /effective y /diff.
export interface Changeset {
  id: string; title: string; owner: string; status: string;
  diff?: Record<string, ChangesetDiff>;
  submittedAt?: string; reviewedBy?: string; reviewedAt?: string; reviewNote?: string;
}

export const listChangesets = () => apiGet<Changeset[]>(CS);
export const getChangeset = (id: string) => apiGet<Changeset>(`${CS}/${encodeURIComponent(id)}`);
export const createChangeset = (title: string) => apiPost<Changeset>(CS, { title });
export const recordChange = (id: string, collection: string, entityId: string, op: 'upsert' | 'delete', payload?: Record<string, unknown>) =>
  apiPut<Changeset>(`${CS}/${encodeURIComponent(id)}/changes`, { collection, entityId, op, payload });
/** Estado efectivo de una colección. `opts.tableId`/`opts.ids` acotan la
 *  respuesta a un slice server-side — sin filtro, canonical_columns a escala
 *  (300k docs) mueve la colección completa por request. `opts.q`/`opts.limit`:
 *  búsqueda server-side por nombre (modales de catálogo). `opts.schema`:
 *  tablas/vistas de UN esquema, draft-aware (Database Explorer, doc 25). */
export const effective = <T>(id: string, collection: string, opts?: { tableId?: string; ids?: string[]; q?: string; limit?: number; schema?: string }) => {
  const params = new URLSearchParams();
  if (opts?.tableId) params.set('tableId', opts.tableId);
  if (opts?.ids?.length) params.set('ids', opts.ids.join(','));
  if (opts?.q) params.set('q', opts.q);
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.schema) params.set('schema', opts.schema);
  const qs = params.toString();
  return apiGet<T[]>(`${CS}/${encodeURIComponent(id)}/effective/${collection}${qs ? `?${qs}` : ''}`);
};
export const submitChangeset = (id: string) => apiPost<Changeset>(`${CS}/${encodeURIComponent(id)}/submit`);
export const approveChangeset = (id: string) => apiPost<Changeset>(`${CS}/${encodeURIComponent(id)}/approve`);
export const rejectChangeset = (id: string, note?: string) => apiPost<Changeset>(`${CS}/${encodeURIComponent(id)}/reject`, { note });
