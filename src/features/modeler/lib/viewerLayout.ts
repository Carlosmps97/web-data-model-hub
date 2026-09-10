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
