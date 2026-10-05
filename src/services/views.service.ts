// Views service (R4c → doc 20: VERSIONADAS). CRUD de las vistas asociadas a
// una tabla. El backend devuelve el envelope `{ success, data }`, que
// `apiGet/apiPost/...` ya desempaquetan.
//
// Desde el doc 20 las vistas siguen el MISMO patrón changeset-aware que
// governance/estructura/esquemas: con changeset activo, las lecturas van al
// estado EFECTIVO (publicado + overlay del draft) y las escrituras se
// registran en el changeset con el DOC COMPLETO (el overlay REEMPLAZA).
// Producción se toca SOLO en el apply del approve; el ROLLBACK las revierte.
// Sin changeset, las LECTURAS van al REST directo; las ESCRITURAS exigen una
// versión en edición (doc 104: sin escritura directa a producción).

import { apiGet } from './http';
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
   *  No decide qué vistas se exportan (eso es la membresía del canvas, doc
   *  102); para las reglas DDL marca la vista de NEGOCIO (doc 105, C2). */
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
  /** Doc 109: color de la vista en todos sus canvases (como las tablas). */
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
  /** Doc 109: el payload es el doc COMPLETO — quien edita una vista conserva su color. */
  color?: string | null;
}

/** Normaliza el doc para el changeset (espejo de la normalización del apply):
 *  tableId ↔ sourceTableIds coherentes — el payload es el DOC COMPLETO. */
function normalizeInput(body: ViewInput): ViewInput {
  const src = body.sourceTableIds?.length
    ? body.sourceTableIds
    : (body.tableId ? [body.tableId] : []);
  return { ...body, sourceTableIds: src, tableId: src[0] ?? body.tableId };
}

/** Doc 109: el documento VIGENTE de una vista en la working copy (null = no
 *  existe o no hay sesión de edición) — base de un guardado (ver `currentTable`). */
export async function currentView(id: string): Promise<View | null> {
  const a = active();
  if (!a) return null;
  const [v] = await csvc.effective<View>(a, 'views', { ids: [id] });
  return v ?? null;
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

/** Vistas de VARIAS tablas (p.ej. «Import existing tables» con sus vistas), en
 *  tandas de `VIEW_IDS_PER_GET` tablas por request — sin draft contra
 *  producción; con changeset activo contra su estado efectivo (doc 105: antes
 *  era UN pedido por tabla). Todo o nada: si una tanda falla, falla la lectura.
 *  Dedup por id y filtro de respaldo por fuentes (un backend viejo ignora
 *  `tableIds` en el estado efectivo y devolvería todas las vistas). */
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

/** Doc 104 (ronda 2): crear / editar / borrar una vista va SIEMPRE por la
 *  versión en edición (como tablas y columnas en governance). El POST/PUT/
 *  DELETE directo de antes sólo lo alcanzaba un popup abierto cuando la sesión
 *  se degradó — y escribía producción sin revisión. */
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

export async function updateView(id: string, body: ViewInput): Promise<View> {
  const a = editingCs();
  const doc = { ...normalizeInput(body), id } as View;
  return csvc.recordChange(a, 'views', id, 'upsert', doc as unknown as Record<string, unknown>).then(() => doc);
}

// Doc 91 D6: el sandbox `POST /api/views/sql/parse` (Validate) se RETIRÓ — el
// User-Defined SQL se guarda verbatim, sin validar.

export async function deleteView(id: string): Promise<{ deleted: boolean }> {
  const a = editingCs();
  return csvc.recordChange(a, 'views', id, 'delete').then(() => ({ deleted: true }));
}
