// Views service (R4c → doc 20: VERSIONADAS). CRUD de las vistas asociadas a
// una tabla. El backend devuelve el envelope `{ success, data }`, que
// `apiGet/apiPost/...` ya desempaquetan.
//
// Desde el doc 20 las vistas siguen el MISMO patrón changeset-aware que
// governance/estructura/esquemas: con changeset activo, las lecturas van al
// estado EFECTIVO (publicado + overlay del draft) y las escrituras se
// registran en el changeset con el DOC COMPLETO (el overlay REEMPLAZA).
// Producción se toca SOLO en el apply del approve; el ROLLBACK las revierte.
// Sin changeset (scripts/compat), sigue el REST directo.

import { apiGet, apiPost, apiPut, apiDelete } from './http';
import * as csvc from '@/services/changeset.service';
import { useSessionStore } from '@/store/useSessionStore';

const active = () => useSessionStore.getState().activeChangesetId;

import { API_BASE } from '@/services/apiBase';
const VIEWS = `${API_BASE}/api/views`;

/** Una proyección de columna dentro de una vista (editor 07b-2 / F3 multi-fuente):
 *  la columna origen, de qué tabla fuente viene, nombre de salida, expresión SQL
 *  y/o CAST opcionales. `table` queda por compatibilidad con vistas legacy. */
export interface ViewSource {
  /** Columna origen. */
  column?: string;
  /** (Legacy) tabla origen por nombre. */
  table?: string;
  /** F3: id de la tabla fuente de la que viene la columna. */
  tableId?: string;
  /** Nombre de salida (alias) de la columna en la vista. */
  outputAlias?: string;
  /** Expresión SQL libre (mask/hash/cast/concat…). */
  expression?: string;
  /** F3: override de tipo ⇒ el DDL emite `CAST(col AS castType) AS alias`. */
  castType?: string;
  /** F5: definición funcional PROPIA de esta columna en la vista (semántica
   *  re-contextualizada respecto de la física). Vacío ⇒ hereda la definición
   *  de la columna física origen. Erwin la trae a nivel de columna-de-vista. */
  description?: string;
}

/** Vista persistida (forma completa del backend R4c + F3).
 *  Invariante round-trip: cada campo persistido vive acá Y en el `ViewDoc`
 *  Pydantic del backend (F3a) — si falta en uno, desaparece al recargar. */
export interface View {
  id: string;
  /** Legacy: primera fuente (= sourceTableIds[0], compat). */
  tableId?: string;
  /** F3: fuentes canónicas de la vista, en orden (definen los alias t1, t2…). */
  sourceTableIds?: string[];
  /** F3 (D3): flag GLOBAL — la vista aparece en todo canvas con ≥1 fuente.
   *  NO afecta el export DDL. */
  showOnCanvas?: boolean;
  name: string;
  schema?: string;
  /** Doc 91 D1/D2/D5: `tags`, `filter` y `joinOverride` se RETIRARON (los UDP
   *  de vista reemplazan a las etiquetas; con 2+ fuentes el DDL lista
   *  `FROM t1, t2` como Erwin; un JOIN/WHERE se anota en la User-Defined SQL). */
  /** Proyección columna a columna — de acá sale el DDL (doc 96 D6). */
  sources?: ViewSource[];
  outputAlias?: string;
  expression?: string;
  sql?: string;
  description?: string;
  /** Doc 61 → 91 → doc 96 D6: «User-Defined SQL», texto INFORMATIVO — se
   *  guarda tal cual, sin validar, y NO se exporta: el DDL se genera siempre de
   *  `sources`. Distinto de `sql` (preview congelado). */
  customSql?: string;
  /** Doc 61: valores UDP de la vista ({defId: value}) — keys de level='view'. */
  udpValues?: Record<string, string>;
}

/** Body de creación/actualización (sin `id`, lo asigna/usa el backend). */
export interface ViewInput {
  tableId?: string;
  sourceTableIds?: string[];
  showOnCanvas?: boolean;
  name: string;
  schema?: string;
  sources?: ViewSource[];
  outputAlias?: string;
  expression?: string;
  sql?: string;
  description?: string;
  customSql?: string;
  udpValues?: Record<string, string>;
}

/** Normaliza el doc para el changeset (espejo de la normalización del apply):
 *  tableId ↔ sourceTableIds coherentes — el payload es el DOC COMPLETO. */
function normalizeInput(body: ViewInput): ViewInput {
  const src = body.sourceTableIds?.length
    ? body.sourceTableIds
    : (body.tableId ? [body.tableId] : []);
  return { ...body, sourceTableIds: src, tableId: src[0] ?? body.tableId };
}

/** Vistas de una tabla concreta (con changeset: estado EFECTIVO). */
export function listViews(tableId: string): Promise<View[]> {
  const a = active();
  if (a) return csvc.effective<View>(a, 'views', { tableId });
  return apiGet<View[]>(`${VIEWS}?tableId=${encodeURIComponent(tableId)}`);
}

/** Doc 102 (431): ids por GET — 100 uuid ≈ 4 KB de URL, lejos del tope de
 *  16 KB (línea de pedido + cabeceras) del servidor Node del front. */
export const VIEW_IDS_PER_GET = 100;

/** Vistas de VARIAS tablas (p.ej. «Import existing tables» con sus vistas) —
 *  sin draft, en tandas de `VIEW_IDS_PER_GET` ids por request; con changeset
 *  activo se resuelve por tabla contra el estado efectivo. Dedup por id. */
export async function listViewsForTables(tableIds: string[]): Promise<View[]> {
  if (!tableIds.length) return [];
  const a = active();
  let parts: View[][];
  if (a) {
    parts = await Promise.all(tableIds.map((t) => csvc.effective<View>(a, 'views', { tableId: t })));
  } else {
    const lots: string[][] = [];
    for (let i = 0; i < tableIds.length; i += VIEW_IDS_PER_GET) lots.push(tableIds.slice(i, i + VIEW_IDS_PER_GET));
    parts = await Promise.all(lots.map((lot) => apiGet<View[]>(`${VIEWS}?tableIds=${encodeURIComponent(lot.join(','))}`)));
  }
  const byId = new Map<string, View>();
  parts.flat().forEach((v) => byId.set(v.id, v));
  return [...byId.values()];
}

/** Una vista de la tabla con los canvases donde es MIEMBRO (doc 70 §2.4). */
export interface TableViewRow extends View { canvases: { id: string; name: string }[]; }

/** Vistas GLOBALES de una tabla (la tabla es canónica: incluye las que viven
 *  sólo en otros canvases) con sus canvases — tab Views del panel («This
 *  canvas» / «Other canvases»), espejo de `gov.tableLinks`. Con changeset
 *  activo el backend aplica el overlay del draft. */
export function tableViews(tableId: string): Promise<{ views: TableViewRow[]; total: number }> {
  const params = new URLSearchParams({ tableId });
  const a = active();
  if (a) params.set('changesetId', a);
  return apiGet<{ views: TableViewRow[]; total: number }>(`${VIEWS}/for-table?${params.toString()}`);
}

export function createView(body: ViewInput): Promise<View> {
  const a = active();
  if (!a) return apiPost<View>(VIEWS, body);
  const doc = { ...normalizeInput(body), id: crypto.randomUUID() } as View;
  return csvc.recordChange(a, 'views', doc.id, 'upsert', doc as unknown as Record<string, unknown>).then(() => doc);
}

export function updateView(id: string, body: ViewInput): Promise<View> {
  const a = active();
  if (!a) return apiPut<View>(`${VIEWS}/${encodeURIComponent(id)}`, body);
  const doc = { ...normalizeInput(body), id } as View;
  return csvc.recordChange(a, 'views', id, 'upsert', doc as unknown as Record<string, unknown>).then(() => doc);
}

// Doc 91 D6: el sandbox `POST /api/views/sql/parse` (Validate) se RETIRÓ — el
// User-Defined SQL se guarda verbatim, sin validar.

export function deleteView(id: string): Promise<{ deleted: boolean }> {
  const a = active();
  if (!a) return apiDelete<{ deleted: boolean }>(`${VIEWS}/${encodeURIComponent(id)}`);
  return csvc.recordChange(a, 'views', id, 'delete').then(() => ({ deleted: true }));
}
