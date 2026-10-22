// Explorer unificado — helpers puros del árbol por proyecto: alcance de
// tablas/vistas, agrupación por esquema, resolución de canvases para "ir al
// objeto" y el filtro liviano de la cabecera.

export interface CanvasLike { id: string; name: string; tableIds: string[]; viewIds?: string[] | null; folderId?: string | null }

/** Ids de tabla del proyecto = unión de los `tableIds` de sus canvases (orden
 *  de primera aparición, sin duplicados). */
export function projectTableIds(canvases: CanvasLike[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sa of canvases) for (const t of sa.tableIds ?? []) if (!seen.has(t)) { seen.add(t); out.push(t); }
  return out;
}

/** Canvases del proyecto que dibujan la tabla (para redirigir y centrar). */
export function canvasesWithTable(canvases: CanvasLike[], tableId: string): CanvasLike[] {
  return canvases.filter((sa) => (sa.tableIds ?? []).includes(tableId));
}

/** Canvases donde la vista es miembro (`viewIds`); si ningún canvas
 *  materializó su lista, cae a los canvases de sus tablas fuente. */
export function canvasesWithView(canvases: CanvasLike[], viewId: string, sourceTableIds: string[]): CanvasLike[] {
  const explicit = canvases.filter((sa) => (sa.viewIds ?? []).includes(viewId));
  if (explicit.length) return explicit;
  return canvases.filter((sa) => sourceTableIds.some((t) => (sa.tableIds ?? []).includes(t)));
}

/**
 * Índice inverso canvas→objeto para el rendimiento del Explorer: en un modelo
 * grande (miles de tablas × cientos de canvases), llamar a `canvasesWithTable`/
 * `canvasesWithView` (un barrido de todos los canvases) por cada fila y en cada
 * re-render cuesta O(filas×canvases). Este índice se construye una vez por lista
 * de canvases y deja cada lookup en O(1); `order` preserva el orden de los
 * canvases para que el fallback por fuente sea idéntico a `canvasesWithView`.
 */
export interface CanvasIndex {
  byTable: Map<string, CanvasLike[]>;
  byView: Map<string, CanvasLike[]>;
  order: Map<string, number>;
}

export function buildCanvasIndex(canvases: CanvasLike[]): CanvasIndex {
  const byTable = new Map<string, CanvasLike[]>();
  const byView = new Map<string, CanvasLike[]>();
  const order = new Map<string, number>();
  canvases.forEach((sa, i) => {
    order.set(sa.id, i);
    for (const t of sa.tableIds ?? []) { const a = byTable.get(t); if (a) a.push(sa); else byTable.set(t, [sa]); }
    for (const v of sa.viewIds ?? []) { const a = byView.get(v); if (a) a.push(sa); else byView.set(v, [sa]); }
  });
  return { byTable, byView, order };
}

/** Igual que `canvasesWithTable`, a partir del índice (O(1)). */
export function indexCanvasesWithTable(idx: CanvasIndex, tableId: string): CanvasLike[] {
  return idx.byTable.get(tableId) ?? [];
}

/** Igual que `canvasesWithView`, a partir del índice: miembros explícitos (`viewIds`)
 *  o, si ninguno, la unión (sin duplicados, en orden de canvas) de los canvases
 *  de sus tablas fuente. */
export function indexCanvasesWithView(idx: CanvasIndex, viewId: string, sourceTableIds: string[]): CanvasLike[] {
  const explicit = idx.byView.get(viewId);
  if (explicit && explicit.length) return explicit;
  const seen = new Set<string>();
  const out: CanvasLike[] = [];
  for (const t of sourceTableIds) for (const sa of idx.byTable.get(t) ?? []) if (!seen.has(sa.id)) { seen.add(sa.id); out.push(sa); }
  if (out.length > 1) out.sort((a, b) => (idx.order.get(a.id) ?? 0) - (idx.order.get(b.id) ?? 0));
  return out;
}

/** Destino del clic: el canvas abierto si contiene el objeto; único canvas →
 *  ese; varios → null (el llamador ofrece elegir); ninguno → undefined. */
export function pickCanvas<T extends { id: string }>(candidates: T[], activeSaId: string | null): T | null | undefined {
  if (candidates.length === 0) return undefined;
  const here = activeSaId ? candidates.find((c) => c.id === activeSaId) : undefined;
  if (here) return here;
  return candidates.length === 1 ? candidates[0] : null;
}

export interface SchemaGroup<T> { schema: string; items: T[] }

/** Agrupa por esquema (sin esquema → «(no schema)»), esquemas e ítems
 *  ordenados por nombre (case-insensitive). */
export function groupBySchema<T>(items: T[], schemaOf: (t: T) => string | null | undefined, nameOf: (t: T) => string): SchemaGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const key = (schemaOf(it) ?? '').trim() || '(no schema)';
    (map.get(key) ?? map.set(key, []).get(key)!).push(it);
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  return [...map.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([schema, list]) => ({ schema, items: [...list].sort((a, b) => cmp(nameOf(a), nameOf(b))) }));
}

/** Filtro «contiene», case-insensitive; vacío = pasa todo. */
export function matchesFilter(name: string | null | undefined, q: string): boolean {
  const t = q.trim().toLowerCase();
  return !t || (name ?? '').toLowerCase().includes(t);
}

/** Conteos por esquema para la rama «Schemas»: tablas y vistas. */
export function schemaSummary(
  tables: { schema?: string | null }[], views: { schema?: string | null }[],
): { schema: string; tables: number; views: number }[] {
  const acc = new Map<string, { tables: number; views: number }>();
  const key = (s?: string | null) => (s ?? '').trim() || '(no schema)';
  for (const t of tables) { const k = key(t.schema); const e = acc.get(k) ?? { tables: 0, views: 0 }; e.tables += 1; acc.set(k, e); }
  for (const v of views) { const k = key(v.schema); const e = acc.get(k) ?? { tables: 0, views: 0 }; e.views += 1; acc.set(k, e); }
  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([schema, n]) => ({ schema, ...n }));
}
