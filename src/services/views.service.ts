// Servicio de vistas (versionadas). CRUD de las vistas asociadas a una tabla.
// El backend devuelve el envelope `{ success, data }`, que
// `apiGet/apiPost/...` ya desempaquetan.
//
// Las vistas siguen el mismo patrón changeset-aware que
// governance/estructura/esquemas: con changeset activo, las lecturas van al
// estado efectivo (publicado + overlay del draft) y las escrituras se
// registran en el changeset con el doc completo (el overlay sustituye al doc).
// Producción se toca solo en el apply del approve; el rollback las revierte.
// Sin changeset, las lecturas van al REST directo; las escrituras exigen una
// versión en edición.

import { apiGet } from './http';
import * as csvc from '@/services/changeset.service';
import { useSessionStore } from '@/store/useSessionStore';

const active = () => useSessionStore.getState().activeChangesetId;

import { API_BASE } from '@/services/apiBase';
const VIEWS = `${API_BASE}/api/views`;

/** Una proyección de columna dentro de una vista (editor multi-fuente): la
 *  columna origen, de qué tabla fuente viene, nombre de salida, expresión SQL
 *  y/o CAST opcionales. `table` identifica la fuente por nombre en vistas que
 *  no traen `tableId`. */
export interface ViewSource {
  /** Columna origen. */
  column?: string;
  /** Tabla origen por nombre (vistas sin `tableId`). */
  table?: string;
  /** Id de la tabla fuente de la que viene la columna. */
  tableId?: string;
  /** Nombre de salida (alias) de la columna en la vista. */
  outputAlias?: string;
  /** Expresión SQL libre (mask/hash/cast/concat…). */
  expression?: string;
  /** Override de tipo ⇒ el DDL emite `CAST(col AS castType) AS alias`. */
  castType?: string;
  /** Definición funcional propia de esta columna en la vista (semántica
   *  re-contextualizada respecto de la física). Vacío ⇒ hereda la definición
   *  de la columna física origen. Erwin la trae a nivel de columna-de-vista. */
  description?: string;
}

/** Vista persistida (forma completa del backend).
 *  Invariante round-trip: cada campo persistido vive acá y en el `ViewDoc`
 *  Pydantic del backend; si falta en uno, desaparece al recargar. */
export interface View {
  id: string;
  /** Primera fuente (= sourceTableIds[0]), por compatibilidad. */
  tableId?: string;
  /** Fuentes canónicas de la vista, en orden (definen los alias t1, t2…). */
  sourceTableIds?: string[];
  /** Flag global: la vista aparece en todo canvas con ≥1 fuente. No decide
   *  qué vistas se exportan (eso es la membresía del canvas); para las reglas
   *  DDL marca la vista de negocio. */
  showOnCanvas?: boolean;
  name: string;
  schema?: string;
  /** Proyección columna a columna: de acá sale el DDL. Con 2+ fuentes el DDL
   *  lista `FROM t1, t2` como Erwin; un JOIN/WHERE se anota en la User-Defined SQL. */
  sources?: ViewSource[];
  outputAlias?: string;
  expression?: string;
  sql?: string;
  description?: string;
  /** «User-Defined SQL»: texto informativo; se guarda tal cual, sin validar, y
   *  no se exporta: el DDL se genera siempre de `sources`. Distinto de `sql`
   *  (preview congelado). */
  customSql?: string;
  /** Valores UDP de la vista ({defId: value}): keys de level='view'. */
  udpValues?: Record<string, string>;
  /** Color de la vista en todos sus canvases (como las tablas). */
  color?: string | null;
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
  /** El payload es el doc completo: quien edita una vista conserva su color. */
  color?: string | null;
}

/** Normaliza el doc para el changeset (espejo de la normalización del apply):
 *  tableId ↔ sourceTableIds coherentes; el payload es el doc completo. */
function normalizeInput(body: ViewInput): ViewInput {
  const src = body.sourceTableIds?.length
    ? body.sourceTableIds
    : (body.tableId ? [body.tableId] : []);
  return { ...body, sourceTableIds: src, tableId: src[0] ?? body.tableId };
}

/** Documento vigente de una vista en la working copy (null = no existe o no
 *  hay sesión de edición): base de un guardado (ver `currentTable`). */
export async function currentView(id: string): Promise<View | null> {
  const a = active();
  if (!a) return null;
  const [v] = await csvc.effective<View>(a, 'views', { ids: [id] });
  return v ?? null;
}

/** Vistas de una tabla concreta (con changeset: estado efectivo). */
export function listViews(tableId: string): Promise<View[]> {
  const a = active();
  if (a) return csvc.effective<View>(a, 'views', { tableId });
  return apiGet<View[]>(`${VIEWS}?tableId=${encodeURIComponent(tableId)}`);
}

/** Ids por GET: 100 uuid ≈ 4 KB de URL, lejos del tope de
 *  16 KB (línea de pedido + cabeceras) del servidor Node del front. */
export const VIEW_IDS_PER_GET = 100;

/** Vistas de varias tablas (p. ej. «Import existing tables» con sus vistas), en
 *  tandas de `VIEW_IDS_PER_GET` tablas por request: sin draft, contra
 *  producción; con changeset activo, contra su estado efectivo. Todo o nada: si
 *  una tanda falla, falla la lectura. Dedup por id y filtro de respaldo por
 *  fuentes (si el backend ignorara `tableIds` en el estado efectivo, devolvería
 *  todas las vistas del proyecto). */
export async function listViewsForTables(tableIds: string[]): Promise<View[]> {
  if (!tableIds.length) return [];
  const a = active();
  const lots: string[][] = [];
  for (let i = 0; i < tableIds.length; i += VIEW_IDS_PER_GET) lots.push(tableIds.slice(i, i + VIEW_IDS_PER_GET));
  const parts = await Promise.all(lots.map((lot) => (a
    ? csvc.effective<View>(a, 'views', { tableIds: lot })
    : apiGet<View[]>(`${VIEWS}?tableIds=${encodeURIComponent(lot.join(','))}`))));
  const wanted = new Set(tableIds);
  const byId = new Map<string, View>();
  parts.flat().forEach((v) => {
    const src = v.sourceTableIds?.length ? v.sourceTableIds : (v.tableId ? [v.tableId] : []);
    if (src.some((t) => wanted.has(t))) byId.set(v.id, v);
  });
  return [...byId.values()];
}

/** Una vista de la tabla con los canvases donde es miembro. */
export interface TableViewRow extends View { canvases: { id: string; name: string }[]; }

/** Vistas globales de una tabla (la tabla es canónica: incluye las que viven
 *  solo en otros canvases) con sus canvases: tab Views del panel («This
 *  canvas» / «Other canvases»), espejo de `gov.tableLinks`. Con changeset
 *  activo el backend aplica el overlay del draft. */
export function tableViews(tableId: string): Promise<{ views: TableViewRow[]; total: number }> {
  const params = new URLSearchParams({ tableId });
  const a = active();
  if (a) params.set('changesetId', a);
  return apiGet<{ views: TableViewRow[]; total: number }>(`${VIEWS}/for-table?${params.toString()}`);
}

/** Crear / editar / borrar una vista va siempre por la versión en edición
 *  (como tablas y columnas en governance): si la sesión se degradó, rechaza. */
function editingCs(): string {
  const s = useSessionStore.getState();
  if (s.openMode !== 'editing' || !s.activeChangesetId) {
    throw new Error('Editing a view requires a version in edit mode.');
  }
  return s.activeChangesetId;
}

export async function createView(body: ViewInput): Promise<View> {
  const a = editingCs();
  const doc = { ...normalizeInput(body), id: crypto.randomUUID() } as View;
  return csvc.recordChange(a, 'views', doc.id, 'upsert', doc as unknown as Record<string, unknown>).then(() => doc);
}

/** El documento que graba una edición de vista (el cuerpo normalizado con su
 *  `id`): lo usa `updateView` y lo que va en un lote (`gov.bulk.upsertView`). */
export const viewWriteDoc = (id: string, body: ViewInput): View => ({ ...normalizeInput(body), id } as View);

export async function updateView(id: string, body: ViewInput): Promise<View> {
  const a = editingCs();
  const doc = viewWriteDoc(id, body);
  return csvc.recordChange(a, 'views', id, 'upsert', doc as unknown as Record<string, unknown>).then(() => doc);
}

export async function deleteView(id: string): Promise<{ deleted: boolean }> {
  const a = editingCs();
  return csvc.recordChange(a, 'views', id, 'delete').then(() => ({ deleted: true }));
}
