import type { TableModel, Relationship } from '@/types/model';

// ── Dimension constants (must match CSS) ──
const NODE_WIDTH = 260;
const HEADER_H = 36;
const ROW_H = 28;
// Extra vertical budget added to a row when the column carries a
// functionalDefinition rendered inline (up to 2 lines at ~13px line-height
// plus the 2px gap from `.table-node-column { gap: 2px }`).
const ROW_COMMENT_H = 28;
const FOOTER_H = 28;
const H_GAP = 100;
const V_GAP = 60;

type Positions = Record<string, { x: number; y: number }>;

function estimateHeight(table: TableModel): number {
  const commented = table.columns.filter((c) => !!c.functionalDefinition).length;
  return (
    HEADER_H +
    table.columns.length * ROW_H +
    commented * ROW_COMMENT_H +
    (table.functionalDefinition ? FOOTER_H : 0)
  );
}

// ── Helpers ──
function buildAdjacency(tables: TableModel[], relationships: Relationship[]) {
  const tableById = new Map(tables.map(t => [t.id, t]));
  const tableByName = new Map(tables.map(t => [t.name, t]));
  const resolve = (ref: string) => tableById.get(ref) ?? tableByName.get(ref);

  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  const neighbors = new Map<string, Set<string>>();

  tables.forEach(t => {
    outgoing.set(t.id, new Set());
    incoming.set(t.id, new Set());
    neighbors.set(t.id, new Set());
  });

  relationships.forEach(rel => {
    const src = resolve(rel.sourceTable);
    const tgt = resolve(rel.targetTable);
    if (!src || !tgt || src.id === tgt.id) return;
    outgoing.get(src.id)!.add(tgt.id);
    incoming.get(tgt.id)!.add(src.id);
    neighbors.get(src.id)!.add(tgt.id);
    neighbors.get(tgt.id)!.add(src.id);
  });

  return { outgoing, incoming, neighbors, resolve };
}

function degree(neighbors: Map<string, Set<string>>, id: string): number {
  return neighbors.get(id)?.size ?? 0;
}

// ════════════════════════════════════════════════════
// Shared helpers
// ════════════════════════════════════════════════════

/** Canvas origin padding — every layout starts at this offset. */
const CANVAS_PAD_X = 60;
const CANVAS_PAD_Y = 60;

/**
 * Skyline bin-packing with uniform column width (all ER nodes share
 * `NODE_WIDTH`). Pre-sorts tables by height descending (First-Fit
 * Decreasing heuristic) and places each into the column whose current
 * skyline height is lowest, so shorter tables tuck in beside taller ones
 * instead of leaving empty rows below.
 *
 * Returns positions already offset by `CANVAS_PAD_X/Y`.
 *
 * @param tables           Tables to lay out.
 * @param numCols          Number of columns in the packing grid.
 * @param heightsById      Optional cache mapping table.id → pre-computed height.
 * @param columnXBase      X-offset applied to column 0 (useful when packing
 *                         within a layer of `layoutLeftRight`).
 * @param yOrigin          Y-offset added to every node.
 */
function packSkyline(
  tables: TableModel[],
  numCols: number,
  heightsById?: Map<string, number>,
  columnXBase = CANVAS_PAD_X,
  yOrigin = CANVAS_PAD_Y,
): Positions {
  const heights =
    heightsById ?? new Map(tables.map((t) => [t.id, estimateHeight(t)]));

  // First-Fit Decreasing: tallest first so they anchor each column
  const sorted = [...tables].sort(
    (a, b) => (heights.get(b.id) ?? 0) - (heights.get(a.id) ?? 0),
  );

  const columnHeights = new Array(numCols).fill(0);
  const positions: Positions = {};

  for (const t of sorted) {
    // Pick the column with the smallest current height; ties → leftmost
    let bestCol = 0;
    for (let c = 1; c < numCols; c++) {
      if (columnHeights[c] < columnHeights[bestCol]) bestCol = c;
    }

    const h = heights.get(t.id) ?? estimateHeight(t);
    positions[t.id] = {
      x: columnXBase + bestCol * (NODE_WIDTH + H_GAP),
      y: yOrigin + columnHeights[bestCol],
    };
    columnHeights[bestCol] += h + V_GAP;
  }

  return positions;
}

/** Heuristic column count for a bag of N tables — targets an aspect ratio
 *  around 1.4 (slightly wider than tall). Caps at 6 columns so very large
 *  models don't explode sideways. */
function pickCompactCols(n: number): number {
  if (n <= 1) return 1;
  return Math.max(1, Math.min(6, Math.round(Math.sqrt(n) * 1.2)));
}

/**
 * Edge-less fallback for `layoutLeftRight`. Produces a **row-major** layout
 * where tables flow left-to-right, wrapping to the next row when the
 * cumulative width exceeds `maxRowWidth`. Each row's Y origin is the sum
 * of the previous rows' max heights so a tall table doesn't squash the
 * shorter ones below it.
 *
 * Visually this makes the "Left-right" button look distinctly wider than
 * Compact (masonry). Target width is chosen so even a 15-table flat model
 * stays below ~2500px — comfortably readable with React Flow's default
 * fit-to-view.
 */
function layoutFlatHorizontal(tables: TableModel[]): Positions {
  if (tables.length === 0) return {};
  const heights = new Map(tables.map((t) => [t.id, estimateHeight(t)]));
  const tablesPerRow = Math.max(
    1,
    Math.min(tables.length, Math.ceil(Math.sqrt(tables.length) * 1.6)),
  );

  const positions: Positions = {};
  let x = CANVAS_PAD_X;
  let y = CANVAS_PAD_Y;
  let rowMaxH = 0;
  let colInRow = 0;

  for (const t of tables) {
    const h = heights.get(t.id) ?? 0;
    positions[t.id] = { x, y };
    x += NODE_WIDTH + H_GAP;
    rowMaxH = Math.max(rowMaxH, h);
    colInRow += 1;

    if (colInRow >= tablesPerRow) {
      x = CANVAS_PAD_X;
      y += rowMaxH + V_GAP;
      rowMaxH = 0;
      colInRow = 0;
    }
  }

  return positions;
}

// ════════════════════════════════════════════════════
// 1. LEFT-RIGHT  (topological layers, left → right)
// ════════════════════════════════════════════════════
/**
 * Arranges tables in layers from left to right based on FK direction.
 * Each layer is itself packed with the `packSkyline` helper so a layer
 * with many tables grows into multiple sub-columns instead of an
 * unbounded vertical stack.
 *
 * If the graph has no edges, we still honour the "left-right" intent by
 * laying out every table in horizontal rows (wrapping when the total
 * width would exceed a reasonable target) so the "Left-right" button
 * produces a distinctly wider layout than Compact's masonry.
 */
export function layoutLeftRight(tables: TableModel[], relationships: Relationship[]): Positions {
  if (tables.length === 0) return {};

  // No relationships → lay out horizontally so "Left-right" still looks
  // visibly different from Compact (masonry).
  if (relationships.length === 0) {
    return layoutFlatHorizontal(tables);
  }

  const { outgoing, incoming, neighbors } = buildAdjacency(tables, relationships);

  // Kahn's algorithm to assign layers
  const layers = new Map<string, number>();
  const queue: string[] = [];

  tables.forEach(t => {
    if ((incoming.get(t.id)?.size ?? 0) === 0) {
      queue.push(t.id);
      layers.set(t.id, 0);
    }
  });

  // If no roots (fully cyclic), seed with the lowest in-degree node
  if (queue.length === 0) {
    const sorted = [...tables].sort(
      (a, b) => (incoming.get(a.id)?.size ?? 0) - (incoming.get(b.id)?.size ?? 0),
    );
    queue.push(sorted[0].id);
    layers.set(sorted[0].id, 0);
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const currentLayer = layers.get(current)!;
    outgoing.get(current)?.forEach(neighbor => {
      const newLayer = currentLayer + 1;
      if (!layers.has(neighbor) || layers.get(neighbor)! < newLayer) {
        layers.set(neighbor, newLayer);
      }
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    });
  }

  tables.forEach(t => {
    if (!layers.has(t.id)) layers.set(t.id, 0);
  });

  // Group by layer
  const byLayer = new Map<number, TableModel[]>();
  tables.forEach(t => {
    const l = layers.get(t.id)!;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(t);
  });

  // Only one layer was produced → Kahn's algorithm had no hierarchy to work
  // with (every edge must be within the same layer). Use the flat
  // horizontal fallback instead of compact, so the "Left-right" button
  // still produces a visibly horizontal distribution.
  if (byLayer.size <= 1) {
    return layoutFlatHorizontal(tables);
  }

  // Layout per layer. A layer may need multiple sub-columns if its stacked
  // height exceeds this budget — prevents the diagram from becoming a
  // single 5,000px tall ribbon.
  const MAX_LAYER_HEIGHT = 1200;
  const heights = new Map(tables.map((t) => [t.id, estimateHeight(t)]));
  const positions: Positions = {};

  // X-cursor walks left to right across layers, accumulating each layer's
  // actual width (numSubCols * NODE_WIDTH) so adjacent layers never collide.
  let xCursor = CANVAS_PAD_X;
  const maxLayer = Math.max(...byLayer.keys());

  for (let l = 0; l <= maxLayer; l++) {
    const group = byLayer.get(l) ?? [];
    if (group.length === 0) continue;

    // Sort within layer by degree desc so the most connected tables sit
    // near the top of each column — shorter edges, less crossing.
    const sortedGroup = [...group].sort(
      (a, b) => degree(neighbors, b.id) - degree(neighbors, a.id),
    );

    const totalH = sortedGroup.reduce(
      (sum, t) => sum + (heights.get(t.id) ?? 0) + V_GAP,
      0,
    );
    const numSubCols = Math.max(1, Math.ceil(totalH / MAX_LAYER_HEIGHT));

    const layerPositions = packSkyline(
      sortedGroup,
      numSubCols,
      heights,
      xCursor,
      CANVAS_PAD_Y,
    );
    Object.assign(positions, layerPositions);

    xCursor += numSubCols * (NODE_WIDTH + H_GAP) + H_GAP;
  }

  return positions;
}

// ════════════════════════════════════════════════════
// 2. COMPACT  (skyline bin-packing / masonry)
// ════════════════════════════════════════════════════
/**
 * Masonry-style packing. Instead of the old row-based grid (which left a
 * vertical gap below any short table whose row neighbours happened to be
 * taller), this algorithm treats each column as an independent skyline:
 * the next table is placed into the column currently occupying the least
 * vertical space, so short tables tuck in beside tall ones without gaps.
 *
 * Tables are ordered by height descending (First-Fit Decreasing), with
 * connection count and name as stable tie-breakers so models with many
 * small-and-equal tables still render in a predictable order.
 */
export function layoutCompact(tables: TableModel[], relationships: Relationship[]): Positions {
  if (tables.length === 0) return {};
  const { neighbors } = buildAdjacency(tables, relationships);

  const heights = new Map(tables.map((t) => [t.id, estimateHeight(t)]));

  // Stable tie-break: height desc → degree desc → name asc
  const sorted = [...tables].sort((a, b) => {
    const dh = (heights.get(b.id) ?? 0) - (heights.get(a.id) ?? 0);
    if (dh !== 0) return dh;
    const dd = degree(neighbors, b.id) - degree(neighbors, a.id);
    if (dd !== 0) return dd;
    return a.name.localeCompare(b.name);
  });

  const numCols = pickCompactCols(sorted.length);
  return packSkyline(sorted, numCols, heights);
}
