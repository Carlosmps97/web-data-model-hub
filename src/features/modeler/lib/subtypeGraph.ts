// Armado puro de los nodos 'subcat' (símbolo de subcategoría) y edges 'subcat'
// del canvas, separado de ModelerCanvas para testearlo sin React.
//
// Contrato:
//   - la subcategoría es una variante de `relationships` (`subcategory=true` +
//     `subtypeSymbolId`); el símbolo (rombo) es un nodo derivado: existe
//     mientras el grupo tenga ≥1 arista y su posición vive en
//     SubjectArea.layout[symbolId] (default: punto medio padre↔hijos);
//   - node type 'subcat'; id = subtypeSymbolId;
//   - edge type 'subcat': una arista tronco `subsym-{symbolId}` supertipo →
//     símbolo (handles __hdr_src → __sym_tgt) + una arista por subtipo
//     símbolo → hijo (id = rel.id, handles __sym_src → `{col}__tgt`);
//   - las frases son de cada relación, así que la etiqueta va en la rama de su
//     subtipo (el tronco no es una relación: no lleva).
import type { Edge, Node } from '@xyflow/react';
import type { Relationship } from '@/services/governance.service';
import { relationshipLabel } from './relationshipLabel';

/** Lado del rombo del símbolo (px). */
export const SYMBOL_SIZE = 28;

export interface SubtypeGroup {
  symbolId: string;
  parentTableId: string;
  rels: Relationship[];
}

/** Predicado de la variante: subcategoría con símbolo. */
export function isSubcategory(r: Relationship): boolean {
  return !!r.subcategory && !!r.subtypeSymbolId;
}

/** Grupos de subcategoría por símbolo, en orden estable (por symbolId). El
 *  supertipo del grupo es el padre de sus aristas (todas comparten padre;
 *  ante datos raros gana el de la primera). */
export function subtypeGroups(rels: Relationship[]): SubtypeGroup[] {
  const by = new Map<string, SubtypeGroup>();
  for (const r of rels) {
    if (!isSubcategory(r)) continue;
    const sid = r.subtypeSymbolId as string;
    const g = by.get(sid);
    if (g) g.rels.push(r);
    else by.set(sid, { symbolId: sid, parentTableId: r.parentTableId, rels: [r] });
  }
  return [...by.values()].sort((a, b) => a.symbolId.localeCompare(b.symbolId));
}

/** Símbolo donde `childTableId` ya es subtipo (regla Erwin: una entidad no es
 *  subtipo en dos grupos), o null. */
export function childSubtypeMembership(rels: Relationship[], childTableId: string): string | null {
  for (const r of rels) {
    if (isSubcategory(r) && r.childTableId === childTableId) return r.subtypeSymbolId as string;
  }
  return null;
}

/** Grupos cuyo supertipo es `parentTableId` (selector del popup de creación). */
export function symbolsOfParent(rels: Relationship[], parentTableId: string): SubtypeGroup[] {
  return subtypeGroups(rels).filter((g) => g.parentTableId === parentTableId);
}

export interface NodeBox { x: number; y: number; w: number; h: number; }

/** Posición default del símbolo: centrado entre el borde inferior del
 *  supertipo y el promedio de los hijos presentes; sin hijos presentes, bajo
 *  el supertipo. Devuelve la esquina superior-izquierda del nodo. */
export function symbolDefaultPos(parent: NodeBox, children: { x: number; y: number }[]): { x: number; y: number } {
  const px = parent.x + parent.w / 2;
  const py = parent.y + parent.h;
  if (!children.length) return { x: px - SYMBOL_SIZE / 2, y: py + 48 };
  const cx = children.reduce((s, c) => s + c.x, 0) / children.length;
  const cy = children.reduce((s, c) => s + c.y, 0) / children.length;
  return {
    x: (px + cx) / 2 - SYMBOL_SIZE / 2,
    y: (py + cy) / 2 - SYMBOL_SIZE / 2,
  };
}

/** Nodos 'subcat' + edges 'subcat' a partir de las relaciones de subcategoría.
 *  - un grupo dibuja solo si su supertipo está en el canvas;
 *  - aristas de hijo solo para hijos presentes (el backend ya filtra las
 *    relaciones a "ambas puntas en el canvas", esto es defensivo);
 *  - `driftOf` marca en ámbar las aristas fuera de sync con la llave. */
export function buildSubtypeGraph(
  rels: Relationship[],
  layout: Record<string, { x: number; y: number }>,
  tablePos: Map<string, { x: number; y: number }>,
  tableSize: (tableId: string) => { w: number; h: number },
  driftOf: (r: Relationship) => boolean,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  for (const g of subtypeGroups(rels)) {
    const p = tablePos.get(g.parentTableId);
    if (!p) continue;
    const kids = g.rels
      .map((r) => tablePos.get(r.childTableId))
      .filter((c): c is { x: number; y: number } => !!c);
    const size = tableSize(g.parentTableId);
    nodes.push({
      id: g.symbolId,
      type: 'subcat',
      position: layout[g.symbolId]
        ?? symbolDefaultPos({ x: p.x, y: p.y, w: size.w, h: size.h }, kids),
      data: { parentTableId: g.parentTableId, count: g.rels.length },
    });
    edges.push({
      id: `subsym-${g.symbolId}`,
      source: g.parentTableId,
      target: g.symbolId,
      sourceHandle: '__hdr_src',
      targetHandle: '__sym_tgt',
      type: 'subcat',
      data: { trunk: true, symbolId: g.symbolId },
    });
    for (const r of g.rels) {
      if (!tablePos.has(r.childTableId)) continue;
      edges.push({
        id: r.id,
        source: g.symbolId,
        target: r.childTableId,
        sourceHandle: '__sym_src',
        targetHandle: `${r.pairs[0]?.childColumnId}__tgt`,
        type: 'subcat',
        data: {
          symbolId: g.symbolId, drifted: driftOf(r),
          label: relationshipLabel(r), labelTitle: relationshipLabel(r, Infinity),
        },
      });
    }
  }
  return { nodes, edges };
}
