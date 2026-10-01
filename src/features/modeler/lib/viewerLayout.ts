/**
 * Doc 84 E — layout EFÍMERO del visor. En modo solo-lectura (producción, una
 * versión publicada, un request ajeno) el modelador puede mover bloques y
 * auto-arreglar para leer mejor el diagrama, pero esos movimientos viven SOLO
 * en su sesión (store en memoria, por canvas): nunca se persisten. Persistir
 * un layout sigue siendo cosa de una edición (draft) que se publica.
 */
export interface NodePos { x: number; y: number }
export type Layout = Record<string, NodePos>;

/** Layout que dibuja el canvas: el publicado con los movimientos de la sesión
 *  encima. Sin overrides (modo edición, o nada movido) devuelve el publicado. */
export function effectiveLayout(persisted: Layout | null | undefined, viewer: Layout | null | undefined): Layout {
  if (!viewer || Object.keys(viewer).length === 0) return persisted ?? {};
  return { ...(persisted ?? {}), ...viewer };
}

/** Nodos cuya posición vive en `layout` (los dibujos van en `drawings`). */
const LAYOUT_NODE_TYPES = new Set(['table', 'view', 'subcat']);

/** Doc 105 (A4-o1): lo que dejó un arrastre. `onNodeDragStop` trae TODOS los
 *  nodos movidos (varios con selección múltiple): las posiciones de tablas,
 *  vistas y símbolos van al `layout` (tal cual: quien graba las redondea) y
 *  las de los dibujos, enteras, a `drawings`. */
export function draggedPositions(
  nodes: readonly { id: string; type?: string; position: NodePos }[],
): { layout: Layout; shapes: (NodePos & { id: string })[] } {
  const layout: Layout = {};
  const shapes: (NodePos & { id: string })[] = [];
  for (const n of nodes) {
    if (n.type === 'shape') shapes.push({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) });
    else if (n.type && LAYOUT_NODE_TYPES.has(n.type)) layout[n.id] = { x: n.position.x, y: n.position.y };
  }
  return { layout, shapes };
}

/** Doc 99 — layout EN PANTALLA: el cargado con las posiciones vivas de los
 *  nodos encima (enteras, como las guarda el canvas). Lo usa el export en
 *  edición: el diagrama del store conserva el layout de su última carga, y un
 *  trazo manual de wire está referido a donde los bloques están AHORA. */
export function liveLayout(
  persisted: Layout | null | undefined,
  nodes: readonly { id: string; type?: string; position: NodePos }[],
): Layout {
  const out: Layout = { ...(persisted ?? {}) };
  for (const n of nodes) {
    if (!n.type || !LAYOUT_NODE_TYPES.has(n.type)) continue;
    out[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
  }
  return out;
}
