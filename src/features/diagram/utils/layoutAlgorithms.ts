import type { TableModel, Relationship } from '@/types/model';

// ── Dimension constants (must match CSS) ──
const NODE_WIDTH = 260;
const HEADER_H = 36;
const ROW_H = 28;
const FOOTER_H = 28;
const H_GAP = 100;
const V_GAP = 60;

type Positions = Record<string, { x: number; y: number }>;

function estimateHeight(table: TableModel): number {
  return HEADER_H + table.columns.length * ROW_H + (table.functionalDefinition ? FOOTER_H : 0);
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
// 1. LEFT-RIGHT  (topological layers, left → right)
// ════════════════════════════════════════════════════
export function layoutLeftRight(tables: TableModel[], relationships: Relationship[]): Positions {
  if (tables.length === 0) return {};
  const { outgoing, incoming } = buildAdjacency(tables, relationships);

  // Kahn's algorithm to assign layers
  const layers = new Map<string, number>();
  const queue: string[] = [];

  tables.forEach(t => {
    if ((incoming.get(t.id)?.size ?? 0) === 0) {
      queue.push(t.id);
      layers.set(t.id, 0);
    }
  });

  // If no roots (cyclic), pick the one with fewest incoming
  if (queue.length === 0) {
    const sorted = [...tables].sort(
      (a, b) => (incoming.get(a.id)?.size ?? 0) - (incoming.get(b.id)?.size ?? 0),
    );
    queue.push(sorted[0].id);
    layers.set(sorted[0].id, 0);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLayer = layers.get(current)!;
    outgoing.get(current)?.forEach(neighbor => {
      if (!layers.has(neighbor) || layers.get(neighbor)! < currentLayer + 1) {
        layers.set(neighbor, currentLayer + 1);
        queue.push(neighbor);
      }
    });
  }

  // Assign any unvisited tables
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

  const positions: Positions = {};
  const maxLayer = Math.max(...byLayer.keys());

  for (let l = 0; l <= maxLayer; l++) {
    const group = byLayer.get(l) ?? [];
    let yOffset = 0;
    group.forEach(t => {
      positions[t.id] = { x: l * (NODE_WIDTH + H_GAP), y: yOffset };
      yOffset += estimateHeight(t) + V_GAP;
    });
  }

  return positions;
}

// ════════════════════════════════════════════════════
// 2. SNOWFLAKE  (radial rings from most connected)
// ════════════════════════════════════════════════════
export function layoutSnowflake(tables: TableModel[], relationships: Relationship[]): Positions {
  if (tables.length === 0) return {};
  const { neighbors } = buildAdjacency(tables, relationships);

  // Find the most connected table
  const sorted = [...tables].sort((a, b) => degree(neighbors, b.id) - degree(neighbors, a.id));
  const centerId = sorted[0].id;

  // BFS rings
  const visited = new Set<string>([centerId]);
  const rings: string[][] = [];
  let frontier = [centerId];

  while (visited.size < tables.length) {
    const nextRing: string[] = [];
    frontier.forEach(id => {
      neighbors.get(id)?.forEach(n => {
        if (!visited.has(n)) {
          visited.add(n);
          nextRing.push(n);
        }
      });
    });
    // Add disconnected tables to last ring
    if (nextRing.length === 0) {
      tables.forEach(t => {
        if (!visited.has(t.id)) {
          visited.add(t.id);
          nextRing.push(t.id);
        }
      });
    }
    if (nextRing.length > 0) rings.push(nextRing);
    frontier = nextRing;
  }

  const positions: Positions = {};
  const tableMap = new Map(tables.map(t => [t.id, t]));

  // Center table
  positions[centerId] = { x: 0, y: 0 };

  // Ring spacing based on node sizes
  const baseRadius = NODE_WIDTH + H_GAP;

  rings.forEach((ring, ringIdx) => {
    const radius = baseRadius * (ringIdx + 1);
    const angleStep = (2 * Math.PI) / ring.length;

    ring.forEach((id, i) => {
      const angle = angleStep * i - Math.PI / 2;
      const t = tableMap.get(id)!;
      const h = estimateHeight(t);
      positions[id] = {
        x: Math.round(Math.cos(angle) * radius - NODE_WIDTH / 2),
        y: Math.round(Math.sin(angle) * radius - h / 2),
      };
    });
  });

  // Normalize so no negative positions
  let minX = Infinity, minY = Infinity;
  Object.values(positions).forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
  });
  const padX = 50 - minX;
  const padY = 50 - minY;
  Object.keys(positions).forEach(id => {
    positions[id].x += padX;
    positions[id].y += padY;
  });

  return positions;
}

// ════════════════════════════════════════════════════
// 3. COMPACT  (grid layout)
// ════════════════════════════════════════════════════
export function layoutCompact(tables: TableModel[], relationships: Relationship[]): Positions {
  if (tables.length === 0) return {};
  const { neighbors } = buildAdjacency(tables, relationships);

  // Sort by connection count (desc) then name
  const sorted = [...tables].sort((a, b) => {
    const diff = degree(neighbors, b.id) - degree(neighbors, a.id);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });

  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const positions: Positions = {};

  // Compute column-wise max heights for neat rows
  const rowMaxH: number[] = [];
  sorted.forEach((t, i) => {
    const row = Math.floor(i / cols);
    const h = estimateHeight(t);
    if (!rowMaxH[row] || h > rowMaxH[row]) rowMaxH[row] = h;
  });

  sorted.forEach((t, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const yOffset = rowMaxH.slice(0, row).reduce((sum, h) => sum + h + V_GAP, 0);

    positions[t.id] = {
      x: 50 + col * (NODE_WIDTH + H_GAP),
      y: 50 + yOffset,
    };
  });

  return positions;
}
