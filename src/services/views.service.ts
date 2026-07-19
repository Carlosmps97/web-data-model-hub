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

import type { Tag } from '@/types/model';
import { apiGet, apiPost, apiPut, apiDelete } from './http';
import * as csvc from '@/features/governance/services/changeset.service';
import { useChangesetStore } from '@/store/useChangesetStore';

const active = () => useChangesetStore.getState().activeId;

const API_BASE = import.meta.env.VITE_API_URL ?? '';
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
  /** F3 (D2): condición de JOIN manual (override de la inferida de relaciones). */
  joinOverride?: string;
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
  sourceTableIds?: string[];
  showOnCanvas?: boolean;
  joinOverride?: string;
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

/** Vistas de VARIAS tablas en UNA request (p.ej. todas las tablas de un canvas
 *  para el Export DDL) — evita N llamadas por tabla. Con changeset activo se
 *  resuelve por tabla contra el estado efectivo y se dedup-ea por id. */
export async function listViewsForTables(tableIds: string[]): Promise<View[]> {
  if (!tableIds.length) return Promise.resolve([]);
  const a = active();
  if (!a) return apiGet<View[]>(`${VIEWS}?tableIds=${encodeURIComponent(tableIds.join(','))}`);
  const perTable = await Promise.all(tableIds.map((t) => csvc.effective<View>(a, 'views', { tableId: t })));
  const byId = new Map<string, View>();
  perTable.flat().forEach((v) => byId.set(v.id, v));
  return [...byId.values()];
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

export function deleteView(id: string): Promise<{ deleted: boolean }> {
  const a = active();
  if (!a) return apiDelete<{ deleted: boolean }>(`${VIEWS}/${encodeURIComponent(id)}`);
  return csvc.recordChange(a, 'views', id, 'delete').then(() => ({ deleted: true }));
}
