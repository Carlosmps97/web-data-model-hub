import { apiGet, apiPut } from '@/services/http';

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

export const getChangeset = (id: string) => apiGet<Changeset>(`${CS}/${encodeURIComponent(id)}`);
export const recordChange = (id: string, collection: string, entityId: string, op: 'upsert' | 'delete', payload?: Record<string, unknown>) =>
  apiPut<Changeset>(`${CS}/${encodeURIComponent(id)}/changes`, { collection, entityId, op, payload });
/** Procedencia de un alta (doc 51): la muestra el historial de auditoría
 *  ("Created from …"). Solo la adjuntan paste de tabla/columnas y CTAS. */
export interface ChangeOrigin {
  kind: 'paste-table' | 'paste-columns' | 'ctas';
  sourceTable?: string;
  sourceColumn?: string;
}
/** Un cambio del lote de `recordChangesBulk` (mismo shape que recordChange). */
export interface BulkChange {
  collection: string; entityId: string; op: 'upsert' | 'delete';
  payload?: Record<string, unknown>;
  origin?: ChangeOrigin;
}
/** Lote de cambios en UNA request por tanda (doc 39): las cascadas de borrar
 *  tabla / crear tabla desde fuentes iban cambio-por-cambio — a 4k columnas
 *  eran minutos. Tandas de 1000 (mismo criterio que la carga Erwin),
 *  SECUENCIALES para no saturar el backend; el server valida el lote COMPLETO
 *  de cada tanda antes de escribir. Lote vacío = cero requests. */
export const recordChangesBulk = async (id: string, changes: BulkChange[], chunkSize = 1000): Promise<Changeset | undefined> => {
  let last: Changeset | undefined;
  for (let i = 0; i < changes.length; i += chunkSize) {
    last = await apiPut<Changeset>(`${CS}/${encodeURIComponent(id)}/changes/bulk`, { changes: changes.slice(i, i + chunkSize) });
  }
  return last;
};
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

// ── Historial de auditoría por entidad (doc 51) ────────────────────────────

export interface HistoryUser { id: string; name?: string | null; email?: string | null; }
export interface HistoryField { key: string; label: string; before?: unknown; after?: unknown; }
/** Procedencia mostrada por el historial: las de `ChangeOrigin` + la entrada
 *  sintética de la migración inicial. */
export interface HistoryOrigin { kind: ChangeOrigin['kind'] | 'migration'; sourceTable?: string; sourceColumn?: string; }
/** Un evento PUBLICADO del historial de una tabla/columna: quién (autor del
 *  draft), cuándo (appliedAt de la versión), qué acción, qué versión y qué
 *  campos cambiaron (mismo motor de diff del popup de revisión, doc 31).
 *  `synthetic` marca la entrada "Initial load" de la migración (sin usuario). */
export interface HistoryItem {
  action: 'created' | 'edited' | 'deleted';
  at?: string | null;
  editedAt?: string | null;
  csId?: string | null;
  version?: string | null;
  versionTitle?: string | null;
  user?: HistoryUser | null;
  publishedBy?: HistoryUser | null;
  approvedBy: HistoryUser[];
  origin?: HistoryOrigin | null;
  /** Doc 65: presente cuando la versión del evento fue una RESTAURACIÓN. */
  restoredFrom?: { csId: string; versionLabel?: string | null; appliedAt?: string | null } | null;
  name?: string | null;
  fields: HistoryField[];
  synthetic: boolean;
}
/** Historial publicado de una entidad — read-only, deriva del ledger de
 *  changesets aplicados (no existe para drafts nunca publicados). */
export const entityHistory = (collection: 'canonical_tables' | 'canonical_columns' | 'views', entityId: string, limit = 50) =>
  apiGet<{ items: HistoryItem[] }>(`${CS}/history/${collection}/${encodeURIComponent(entityId)}?limit=${limit}`);
