// Nodos del canvas re-armados con cada carga del diagrama. React Flow trata un
// nodo sin `measured` como nuevo: le borra las anclas medidas y lo dibuja aunque
// esté fuera de pantalla para medirlo (`forceInitialRender`). En un canvas
// gigante eso montaba y desmontaba todas las filas de todas las tablas (~900 mil
// elementos) en cada edición. Cada bloque conserva su tamaño medido mientras no
// cambien sus anclas ni su caja; si cambiaron, solo ese vuelve a medirse. Uno
// medido en modo compacto (LOD) conserva esa caja hasta que se dibuja de cerca,
// salvo que ancle wires de relación: ese vuelve a medirse en la carga siguiente.
import type { Edge, Node } from '@xyflow/react';
import type { CanonicalColumn, CanonicalTable } from '@/services/governance.service';
import type { View } from '@/services/views.service';
import { orderColumns } from './columnOrder';
import { tableLodSize, viewLodSize } from './lodSize';

type Facet = 'logical' | 'physical';

/** Anclas y caja de un nodo en la faceta dada. En una tabla, una ancla por fila
 *  en el orden que dibuja el bloque (llave primero, cada parte por `ordinal`)
 *  y el ancho estimado de la caja (nombres y tipos de esa faceta); en modo
 *  compacto, las columnas con wires y el tamaño de la caja. Las vistas anclan en
 *  la cabecera: cuenta su caja. Los símbolos, solo el tipo. Puro. */
export function anchorLayout(node: Node, viewMode: Facet): string {
  if (node.type === 'view') {
    const d = node.data as { view: View; colTypes?: Record<string, string> };
    const { w, h } = viewLodSize(d.view, d.colTypes ?? {});
    return `view:${w}x${h}`;
  }
  if (node.type !== 'table') return node.type ?? '';
  const d = node.data as { table: CanonicalTable; columns?: CanonicalColumn[]; lod?: boolean; refCols?: string[] };
  const columns = d.columns ?? [];
  const { w, h } = tableLodSize(d.table, columns, viewMode);
  if (d.lod) return `lod:${w}x${h}:${(d.refCols ?? []).join(',')}`;
  return `rows:${w}:${orderColumns(columns).map((c) => (c.isPrimaryKey ? `${c.id}*` : c.id)).join(',')}`;
}

export interface KeepOptions {
  /** Faceta de este armado y la del anterior: al cambiar, todos vuelven a medirse. */
  viewMode: Facet;
  prevViewMode?: string;
  /** Nodos que vuelven a medirse igual (extremos de wires nuevos o re-apuntados:
   *  uno fuera de pantalla puede tener anclas de otro momento, p. ej. del modo
   *  compacto, sin la del wire nuevo). */
  remeasure?: ReadonlySet<string>;
  /** Extremos de wires de relación o de subcategoría: anclan en sus filas y en su
   *  caja, que el modo compacto dibuja en otro lugar. Conservan la medida solo si
   *  se tomó en el modo (compacto o detallado) en que ahora se dibujan. */
  anchored?: ReadonlySet<string>;
}

/** ¿La medida es la del bloque compacto? El compacto mide exactamente su caja
 *  estimada; el detallado, lo que ocupa su contenido, que casi nunca coincide
 *  (sus filas son más altas que las estimadas y su ancho es el del texto). Si
 *  coincide, ese bloque solo se vuelve a medir de más. Puro. */
export function measuredCompact(node: Node, viewMode: Facet): boolean {
  const m = node.measured;
  if (m?.width == null || m.height == null) return false;
  let box: { w: number; h: number } | null = null;
  if (node.type === 'table') {
    const d = node.data as { table: CanonicalTable; columns?: CanonicalColumn[] };
    box = tableLodSize(d.table, d.columns ?? [], viewMode);
  } else if (node.type === 'view') {
    const d = node.data as { view: View; colTypes?: Record<string, string> };
    box = viewLodSize(d.view, d.colTypes ?? {});
  }
  return !!box && m.width === box.w && m.height === box.h;
}

/** `next` con el `measured` del nodo anterior del mismo id y tipo, si sus anclas
 *  y su caja no cambiaron. Puro. */
export function keepMeasured(prev: Node[], next: Node[], opts: KeepOptions): Node[] {
  if (opts.prevViewMode !== undefined && opts.prevViewMode !== opts.viewMode) return next;
  const before = new Map(prev.map((n) => [n.id, n]));
  return next.map((n) => {
    const p = before.get(n.id);
    if (!p?.measured || p.type !== n.type || opts.remeasure?.has(n.id)
      || anchorLayout(p, opts.viewMode) !== anchorLayout(n, opts.viewMode)
      || (opts.anchored?.has(n.id) && measuredCompact(p, opts.viewMode) !== !!(n.data as { lod?: boolean }).lod)) return n;
    return { ...n, measured: p.measured };
  });
}

/** Firma de cada wire (extremos y handles) y los nodos que son extremo de uno
 *  nuevo o re-apuntado respecto de `before`. Puro. */
export function wireChanges(before: ReadonlyMap<string, string>, edges: Edge[]): { wires: Map<string, string>; remeasure: Set<string> } {
  const wires = new Map<string, string>();
  const remeasure = new Set<string>();
  for (const e of edges) {
    const sig = `${e.source}|${e.sourceHandle ?? ''}|${e.target}|${e.targetHandle ?? ''}`;
    wires.set(e.id, sig);
    if (before.get(e.id) !== sig) { remeasure.add(e.source); remeasure.add(e.target); }
  }
  return { wires, remeasure };
}

/** Lo que un armado del canvas deja al siguiente: su faceta y la firma de cada wire. */
export interface BuildMemo { viewMode?: Facet; wires: ReadonlyMap<string, string> }

/** Opciones de `keepMeasured` para armar con `edges` en `viewMode`, contra lo que
 *  dejó el armado anterior, y lo que este deja al siguiente. Los wires de
 *  derivación quedan fuera de `anchored`: anclan en las cabeceras, a la misma
 *  altura en los dos modos, y la salida de la tabla está en su borde derecho,
 *  que en compacto es el ancho estimado (unos 60–100 px de más). Re-medir las
 *  fuentes de todas las vistas sería re-medir casi todo un canvas gigante. Puro. */
export function measureOptions(memo: BuildMemo, edges: Edge[], viewMode: Facet): { keep: KeepOptions; memo: BuildMemo } {
  const { wires, remeasure } = wireChanges(memo.wires, edges);
  const anchored = new Set<string>();
  for (const e of edges) if (e.type !== 'derivation') { anchored.add(e.source); anchored.add(e.target); }
  return { keep: { viewMode, prevViewMode: memo.viewMode, remeasure, anchored }, memo: { viewMode, wires } };
}
