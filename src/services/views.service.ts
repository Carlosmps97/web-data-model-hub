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

/** Vistas de una tabla concreta. */
export function listViews(tableId: string): Promise<View[]> {
  return apiGet<View[]>(`${VIEWS}?tableId=${encodeURIComponent(tableId)}`);
}

/** Vistas de VARIAS tablas en UNA request (p.ej. todas las tablas de un canvas
 *  para el Export DDL) — evita N llamadas por tabla. */
export function listViewsForTables(tableIds: string[]): Promise<View[]> {
  if (!tableIds.length) return Promise.resolve([]);
  return apiGet<View[]>(`${VIEWS}?tableIds=${encodeURIComponent(tableIds.join(','))}`);
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
