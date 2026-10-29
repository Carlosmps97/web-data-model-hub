import { apiGet, apiPut } from '@/services/http';

import { API_BASE } from '@/services/apiBase';
import { trackDraftWork } from '@/services/draftWork';
const CS = `${API_BASE}/api/changesets`;

export interface ChangesetDiff { added: string[]; modified: string[]; removed: string[]; }
// Cabecera del changeset. Los cambios en sí viven en la colección
// `changeset_changes` del backend (un doc por cambio) y
// nunca viajan crudos al cliente: se consumen vía /effective y /diff.
export interface Changeset {
  id: string; title: string; owner: string; status: string;
  diff?: Record<string, ChangesetDiff>;
  submittedAt?: string; reviewedBy?: string; reviewedAt?: string; reviewNote?: string;
  /** Escrituras grabadas en el draft: cada `/changes` devuelve el número de la suya. */
  writeSeq?: number;
}

/** Lo que se escribió en un draft, para quien necesite saberlo (el canvas
 *  recarga solo las tablas tocadas). Se avisa al terminar cada escritura, también
 *  si falló (no se sabe si llegó; recargar esas tablas es correcto igual): una
 *  recarga que empieza antes nunca la da por vista. `writeSeq` es el número de
 *  la escritura en el draft (sin él si falló); `unconfirmed`, que falló sin
 *  saberse si llegó (sin respuesta o con un error del servidor). */
type DraftWriteListener = (changesetId: string, changes: readonly BulkChange[], writeSeq?: number, unconfirmed?: boolean) => void;
const draftWriteListeners = new Set<DraftWriteListener>();
export function onDraftWrite(listener: DraftWriteListener): () => void {
  draftWriteListeners.add(listener);
  return () => { draftWriteListeners.delete(listener); };
}
/** Avisa una escritura en el draft a los observadores de `onDraftWrite`. La
 *  usan las escrituras de este servicio y las de un endpoint propio que
 *  devuelve su número (borrar un esquema). */
export const announceDraftWrite = (id: string, changes: readonly BulkChange[], writeSeq?: number, unconfirmed?: boolean) => {
  for (const listener of draftWriteListeners) {
    try { listener(id, changes, writeSeq, unconfirmed); } catch { /* un observador roto no cambia la escritura */ }
  }
};

/** ¿Una escritura fallida pudo grabarse igual? Sin respuesta (status 0) o con
 *  un error del servidor o del proxy (≥ 500, también después de grabar): no se
 *  sabe. Un rechazo (4xx) es antes de escribir. */
export const unconfirmedWrite = (e: unknown): boolean => {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status !== 'number' || status === 0 || status >= 500;
};

export const recordChange = (id: string, collection: string, entityId: string, op: 'upsert' | 'delete', payload?: Record<string, unknown>) =>
  trackDraftWork((async () => {
    let done: Changeset | undefined;
    let unconfirmed = false;
    try {
      done = await apiPut<Changeset>(`${CS}/${encodeURIComponent(id)}/changes`, { collection, entityId, op, payload });
      return done;
    } catch (e) {
      unconfirmed = unconfirmedWrite(e);
      throw e;
    } finally {
      announceDraftWrite(id, [{ collection, entityId, op, payload }], done?.writeSeq, unconfirmed);
    }
  })());
/** Procedencia de un alta: la muestra el historial de auditoría
 *  ("Created from …"). Solo la adjuntan paste de tabla/columnas y CTAS. */
export interface ChangeOrigin {
  kind: 'paste-table' | 'paste-columns' | 'ctas';
  sourceTable?: string;
  sourceColumn?: string;
  /** Pegado desde otro proyecto: su nombre. */
  sourceProject?: string;
}
/** Un cambio del lote de `recordChangesBulk` (mismo shape que recordChange). */
export interface BulkChange {
  collection: string; entityId: string; op: 'upsert' | 'delete';
  payload?: Record<string, unknown>;
  origin?: ChangeOrigin;
}
/** Lote de cambios en una sola request por tanda: las cascadas de borrar tabla
 *  / crear tabla desde fuentes, cambio por cambio, tardarían minutos con miles
 *  de columnas. Tandas de 1000 (mismo criterio que la carga Erwin), secuenciales
 *  para no saturar el backend; el server valida el lote completo de cada tanda
 *  antes de escribir. Lote vacío = cero requests. */
export const recordChangesBulk = (id: string, changes: BulkChange[], chunkSize = 1000): Promise<Changeset | undefined> =>
  trackDraftWork((async () => {
    let last: Changeset | undefined;
    for (let i = 0; i < changes.length; i += chunkSize) {
      const chunk = changes.slice(i, i + chunkSize);
      let done: Changeset | undefined;
      let unconfirmed = false;
      try {
        done = await apiPut<Changeset>(`${CS}/${encodeURIComponent(id)}/changes/bulk`, { changes: chunk });
        last = done;
      } catch (e) {
        unconfirmed = unconfirmedWrite(e);
        throw e;
      } finally {
        announceDraftWrite(id, chunk, done?.writeSeq, unconfirmed);
      }
    }
    return last;
  })());
/** Escrituras grabadas en la versión (`writeSeq`), sin el resto de su cabecera
 *  (que arma el resumen de todos sus cambios): Undo y Redo lo leen antes de
 *  escribir (candados del historial) y el canvas al volver a la pestaña. */
export const writeSeqOf = (id: string) => apiGet<{ writeSeq: number }>(`${CS}/${encodeURIComponent(id)}/seq`);
/** Estado efectivo de una colección. `opts.tableId`/`opts.ids` acotan la
 *  respuesta a un slice server-side — sin filtro, canonical_columns a escala
 *  (300k docs) mueve la colección completa por request. `opts.q`/`opts.limit`:
 *  búsqueda server-side por nombre (modales de catálogo). `opts.schema`:
 *  tablas/vistas de un esquema, draft-aware (Database Explorer). */
export const effective = <T>(id: string, collection: string, opts?: { tableId?: string; ids?: string[]; q?: string; limit?: number; schema?: string; tableIds?: string[] }) => {
  const params = new URLSearchParams();
  if (opts?.tableId) params.set('tableId', opts.tableId);
  // Solo vistas: las de un lote de tablas en una lectura.
  if (opts?.tableIds?.length) params.set('tableIds', opts.tableIds.join(','));
  if (opts?.ids?.length) params.set('ids', opts.ids.join(','));
  if (opts?.q) params.set('q', opts.q);
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.schema) params.set('schema', opts.schema);
  const qs = params.toString();
  return apiGet<T[]>(`${CS}/${encodeURIComponent(id)}/effective/${collection}${qs ? `?${qs}` : ''}`);
};

// ── Historial de auditoría por entidad ─────────────────────────────────────

export interface HistoryUser { id: string; name?: string | null; email?: string | null; }
export interface HistoryField { key: string; label: string; before?: unknown; after?: unknown; }
/** Procedencia mostrada por el historial: las de `ChangeOrigin` + la entrada
 *  sintética de la migración inicial. */
export interface HistoryOrigin { kind: ChangeOrigin['kind'] | 'migration'; sourceTable?: string; sourceColumn?: string; sourceProject?: string; }
/** Un evento publicado del historial de una tabla/columna: quién (autor del
 *  draft), cuándo (appliedAt de la versión), qué acción, qué versión y qué
 *  campos cambiaron (mismo motor de diff del popup de revisión).
 *  `synthetic` marca la entrada "Initial load" de la migración (sin usuario). */
export interface HistoryItem {
  action: 'created' | 'edited' | 'deleted';
  at?: string | null;
  editedAt?: string | null;
  csId?: string | null;
  version?: string | null;
  versionTitle?: string | null;
  user?: HistoryUser | null;
  /** Quién inició la versión si fue transferida antes de publicarse (`user`
   *  es el dueño final: quien la envió y figura como autor). */
  startedBy?: HistoryUser | null;
  publishedBy?: HistoryUser | null;
  approvedBy: HistoryUser[];
  origin?: HistoryOrigin | null;
  /** Presente cuando la versión del evento fue una restauración. */
  restoredFrom?: { csId: string; versionLabel?: string | null; appliedAt?: string | null } | null;
  name?: string | null;
  fields: HistoryField[];
  synthetic: boolean;
}
/** Historial publicado de una entidad, de solo lectura: deriva del ledger de
 *  changesets aplicados (no existe para drafts nunca publicados). */
export const entityHistory = (collection: 'canonical_tables' | 'canonical_columns' | 'views', entityId: string, limit = 50) =>
  apiGet<{ items: HistoryItem[] }>(`${CS}/history/${collection}/${encodeURIComponent(entityId)}?limit=${limit}`);
