// Canvas auto-arrange layouts.
//
// Every node is exactly NODE_W wide, but its HEIGHT varies a lot with the
// column count (a 4-column table is ~210px tall; a 38-column one is ~1300px).
// The previous layouts spaced nodes by a *fixed* row height, so any table
// taller than that increment overlapped its neighbours. All three layouts now
// pack by each node's real `nodeHeight`, which makes overlap impossible
// regardless of how uneven the tables are.

import type { Table, Relationship, ModelLevel } from '@/types/model';
import { layerOrderMap } from '@/lib/hierarchy';

export type Positions = Record<string, { x: number; y: number }>;
export type ArrangeKind = 'byLayer' | 'compact' | 'snowflake';

export const NODE_W = 250;
export const HEADER = 44;
export const ROW = 32;
export const ROWS_PAD = 3;

const H_GAP = 90;       // horizontal gap between node columns
const V_GAP = 52;       // vertical gap between stacked nodes
const BAND_GAP = 140;   // gap between model-level bands
const COL_W = NODE_W + H_GAP;

export function nodeHeight(t: Table): number {
  return HEADER + ROWS_PAD * 2 + t.columns.length * ROW + (t.functionalDefinition ? 30 : 0);
}

/**
 * Masonry packer: drops each table into the currently-shortest of `nCols`
 * columns, advancing that column by the node's real height + gap. Never
 * overlaps, whatever the spread of node heights. Returns the map and the
 * total occupied width (used to lay bands side by side).
 */
function packColumns(tables: Table[], nCols: number, x0: number, y0: number): { pos: Positions; width: number } {
  const cols = Math.max(1, nCols);
  const bottom = new Array<number>(cols).fill(y0);
  const pos: Positions = {};
  tables.forEach((t) => {
    let c = 0;
    for (let i = 1; i < cols; i++) if (bottom[i] < bottom[c]) c = i;
    pos[t.id] = { x: x0 + c * COL_W, y: bottom[c] };
    bottom[c] += nodeHeight(t) + V_GAP;
  });
  return { pos, width: (cols - 1) * COL_W + NODE_W };
}

/**
 * Horizontal bands per model level (left→right by `order`). Tables within a
 * band are packed into 1–3 height-balanced sub-columns so an overloaded layer
 * never becomes a single impossibly tall tower. Tables with no/unknown layer
 * land in a trailing band.
 */
export function layoutByLayer(tables: Table[], layers: ModelLevel[]): Positions {
  const order = layerOrderMap(layers);
  const UNKNOWN = Number.MAX_SAFE_INTEGER;
  const groups = new Map<number, Table[]>();
  tables.forEach((t) => {
    const li = t.layer != null && order[t.layer] != null ? order[t.layer] : UNKNOWN;
    const g = groups.get(li);
    if (g) g.push(t); else groups.set(li, [t]);
  });

  const pos: Positions = {};
  let x = 80;
  [...groups.keys()].sort((a, b) => a - b).forEach((li) => {
    const band = groups.get(li)!.slice().sort(
      (a, b) => (a.domain ?? '').localeCompare(b.domain ?? '') || a.name.localeCompare(b.name),
    );
    const subCols = Math.min(3, Math.max(1, Math.ceil(band.length / 6)));
    const { pos: p, width } = packColumns(band, subCols, x, 70);
    Object.assign(pos, p);
    x += width + BAND_GAP;
  });
  return pos;
}

/** Compact masonry: a roughly square grid with the tightest possible whitespace.
 *  Tallest-first so the columns balance out evenly. */
export function layoutCompact(tables: Table[]): Positions {
  const n = tables.length || 1;
  const nCols = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(n))));
  const sorted = tables.slice().sort((a, b) => nodeHeight(b) - nodeHeight(a));
  return packColumns(sorted, nCols, 70, 70).pos;
}

/**
 * Radial around the most-connected table. The ring radius and the angular step
 * both scale with the real node sizes: each ring reserves enough arc per node
 * (its widest dimension) and enough radial gap (the tallest node on the ring)
 * that nodes never collide. Falls back to a compact grid when there are no
 * relationships to give the radial any meaning.
 */
export function layoutSnowflake(tables: Table[], relationships: Relationship[]): Positions {
  if (tables.length === 0) return {};
  if (tables.length === 1) return { [tables[0].id]: { x: 200, y: 200 } };
  if (relationships.length === 0) return layoutCompact(tables);

  const deg: Record<string, number> = {};
  tables.forEach((t) => { deg[t.id] = 0; });
  relationships.forEach((r) => {
    deg[r.source.table] = (deg[r.source.table] ?? 0) + 1;
    deg[r.target.table] = (deg[r.target.table] ?? 0) + 1;
  });

  // Most-connected (tie-break: tallest) at the centre; the rest sorted so the
  // tallest land on the inner rings, which bounds each ring's spacing.
  const sorted = tables.slice().sort(
    (a, b) => (deg[b.id] ?? 0) - (deg[a.id] ?? 0) || nodeHeight(b) - nodeHeight(a),
  );
  const center = sorted[0];
  const others = sorted.slice(1);

  const CX = 1400, CY = 1100, GAP = 80;
  const pos: Positions = { [center.id]: { x: CX - NODE_W / 2, y: CY - nodeHeight(center) / 2 } };

  // Each node reserves the bounding circle of the *tallest* table, so the same
  // cell size guarantees clearance both tangentially (between ring neighbours)
  // and radially (between consecutive rings, and centre→ring 1) — no overlap is
  // geometrically possible regardless of angle.
  const maxH = Math.max(...tables.map(nodeHeight));
  const cell = Math.hypot(NODE_W, maxH) + GAP;
  let radius = cell;
  let i = 0;
  while (i < others.length) {
    const capacity = Math.max(1, Math.floor((2 * Math.PI * radius) / cell));
    const count = Math.min(capacity, others.length - i);
    for (let k = 0; k < count; k++) {
      const t = others[i + k];
      const ang = -Math.PI / 2 + (k / count) * Math.PI * 2;
      pos[t.id] = {
        x: CX + Math.cos(ang) * radius - NODE_W / 2,
        y: CY + Math.sin(ang) * radius - nodeHeight(t) / 2,
      };
    }
    i += count;
    radius += cell;
  }
  return pos;
}

export function arrange(
  kind: ArrangeKind,
  tables: Table[],
  layers: ModelLevel[],
  relationships: Relationship[],
): Positions {
  if (kind === 'compact') return layoutCompact(tables);
  if (kind === 'snowflake') return layoutSnowflake(tables, relationships);
  return layoutByLayer(tables, layers);
}
