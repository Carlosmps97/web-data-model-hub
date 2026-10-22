// Armado del grafo del Autoarrange, compartido por el botón del toolbar (nodos
// medidos por React Flow) y por el arrange «headless» de la carga masiva
// (canvases que no están abiertos: tamaños estimados con las mismas métricas de
// `lodSize.ts` / `scripts/arrange_all.py`). `buildArrangeGraph` es puro;
// `arrangeDiagram` llama a ELK y re-deriva los símbolos de subcategoría (lo usa
// también `autoOrganize`).
import type { Diagram } from '@/features/modeler/services/modeler.service';
import type { CanonicalColumn } from '@/services/governance.service';
import { tableLodSize, viewLodSize } from './lodSize';
import { viewSourceIds } from './viewGraph';
import { subtypeGroups, symbolDefaultPos, SYMBOL_SIZE } from './subtypeGraph';

export interface ArrangeSize { width: number; height: number; }
export interface ArrangeNode extends ArrangeSize { id: string; }
export interface ArrangeEdge { id: string; source: string; target: string; }
export interface ArrangeGraph { nodes: ArrangeNode[]; edges: ArrangeEdge[]; viewIds: string[]; }
/** Tamaño medido de un nodo (React Flow) o undefined para usar la estimación. */
export type SizeOf = (id: string) => ArrangeSize | undefined;

export function buildArrangeGraph(dia: Diagram, sizeOf: SizeOf, viewMode: 'logical' | 'physical'): ArrangeGraph {
  const colsByTable = new Map<string, CanonicalColumn[]>();
  const colTypes: Record<string, string> = {};
  for (const c of dia.columns) {
    (colsByTable.get(c.tableId) ?? colsByTable.set(c.tableId, []).get(c.tableId)!).push(c);
    colTypes[`${c.tableId}::${c.physicalName}`] = c.dataType;
  }
  const tableIds = new Set(dia.tables.map((t) => t.id));
  const nodes: ArrangeNode[] = dia.tables.map((t) => {
    const m = sizeOf(t.id);
    if (m) return { id: t.id, ...m };
    const s = tableLodSize(t, colsByTable.get(t.id) ?? [], viewMode);
    return { id: t.id, width: s.w, height: s.h };
  });
  // Las vistas visibles se auto-organizan como nodos normales; sus
  // derivaciones entran como edges para que ELK las ubique junto a sus fuentes.
  // Las vistas existen solo en el modelo físico: en lógico no están en el
  // canvas, así que el arrange no las mueve ni les reserva sitio.
  const views = viewMode === 'physical'
    ? (dia.views ?? []).filter((v) => viewSourceIds(v).some((id) => tableIds.has(id)))
    : [];
  for (const v of views) {
    const m = sizeOf(v.id);
    if (m) { nodes.push({ id: v.id, ...m }); continue; }
    const s = viewLodSize(v, colTypes);
    nodes.push({ id: v.id, width: s.w, height: s.h });
  }
  const edges: ArrangeEdge[] = [
    ...dia.relationships.map((r) => ({ id: r.id, source: r.parentTableId, target: r.childTableId })),
    ...views.flatMap((v) => viewSourceIds(v).filter((id) => tableIds.has(id))
      .map((tid) => ({ id: `deriv__${v.id}__${tid}`, source: tid, target: v.id }))),
  ];
  return { nodes, edges, viewIds: views.map((v) => v.id) };
}

/** Layout ELK del diagrama + símbolos de subcategoría re-derivados. Devuelve
 *  posiciones por id (tablas, vistas y símbolos) listas para
 *  `setSubjectAreaLayout` (que hace merge). */
export async function arrangeDiagram(
  dia: Diagram, sizeOf: SizeOf, viewMode: 'logical' | 'physical',
): Promise<Record<string, { x: number; y: number }>> {
  const { elkLayout } = await import('./elkLayout');
  const g = buildArrangeGraph(dia, sizeOf, viewMode);
  const nodes = g.nodes.map((n) => ({ id: n.id, position: { x: 0, y: 0 }, data: {}, width: n.width, height: n.height })) as never;
  const pos = await elkLayout(nodes, g.edges as never);
  // Los símbolos de subcategoría no van a ELK: tras el arrange se re-derivan al
  // punto medio de las posiciones calculadas (el merge dejaría pegada la
  // posición previa del símbolo, huérfana del layout recién calculado).
  const sizeById = new Map(g.nodes.map((n) => [n.id, n]));
  for (const grp of subtypeGroups(dia.relationships)) {
    const p = pos[grp.parentTableId];
    if (!p) continue;
    const m = sizeById.get(grp.parentTableId);
    const kids = grp.rels.map((r) => pos[r.childTableId]).filter((c): c is { x: number; y: number } => !!c);
    pos[grp.symbolId] = symbolDefaultPos(
      { x: p.x, y: p.y, w: m?.width ?? 230, h: m?.height ?? SYMBOL_SIZE * 4 }, kids);
  }
  return pos;
}
