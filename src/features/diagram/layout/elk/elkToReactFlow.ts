/**
 * Convert an ELK layout result into React Flow `Node[]` + `Edge[]`.
 *
 * Responsibilities:
 *   - Flatten the (possibly hierarchical) ELK tree into the flat list
 *     React Flow expects, while accumulating absolute x/y for nodes
 *     nested inside a namespace compound.
 *   - Extract each edge's bend points into a `waypoints` array and
 *     attach it to the edge data so the Crow's Foot renderer can draw
 *     the exact orthogonal path ELK computed.
 *   - Derive the "which side is this column's handle on?" map that
 *     `TableNode` uses, by looking at each port's final `x` relative
 *     to the node width.
 *   - Preserve the interaction fields (`highlighted`, `dimmed`,
 *     `crossModel`) the edge renderer already understands.
 */

import type { Edge, Node } from '@xyflow/react';
import type { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api';

import type {
  Relationship,
  TableModel,
  ViewModel,
  CrowsFootCardinality,
} from '@/types/model';

import { parsePortId } from './types';

export interface EdgeWaypoint {
  x: number;
  y: number;
}

export interface CrowsFootEdgeData extends Record<string, unknown> {
  waypoints: EdgeWaypoint[];
  cardinality: { source: CrowsFootCardinality; target: CrowsFootCardinality };
  crossModel?: boolean;
  highlighted?: boolean;
  dimmed?: boolean;
  edgeIndex?: number;
}

export interface ElkToReactFlowInput {
  laidOut: ElkNode;
  tables: TableModel[];
  relationships: Relationship[];
  views?: ViewModel[];
  /** Namespace metadata to hydrate `namespace` background nodes. */
  namespaces?: Array<{ id: string; label: string; tintIndex?: number; engine?: string; tableIds: string[] }>;
  /** Relationship.id → cardinality pair (precomputed by crowsFootMapping). */
  cardinalityByRelId: Map<string, { source: CrowsFootCardinality; target: CrowsFootCardinality }>;
  /** Relationship.id → true when source/target namespaces differ. */
  crossModelEdgeIds?: Set<string>;
}

export interface ElkToReactFlowResult {
  nodes: Node[];
  edges: Edge[];
  /** tableId → { columnId → 'left' | 'right' } — used by TableNode to
   *  place the single handle on the side ELK chose. */
  handleSideByTable: Map<string, Record<string, 'left' | 'right'>>;
}

/** Walk the ELK tree and collect every leaf + its absolute x/y. */
function collectAbsolutePositions(
  root: ElkNode,
  acc: Map<string, { node: ElkNode; absX: number; absY: number; depth: number }>,
  baseX = 0,
  baseY = 0,
  depth = 0,
): void {
  const children = root.children ?? [];
  for (const child of children) {
    const absX = baseX + (child.x ?? 0);
    const absY = baseY + (child.y ?? 0);
    acc.set(child.id, { node: child, absX, absY, depth });
    if (child.children && child.children.length > 0) {
      collectAbsolutePositions(child, acc, absX, absY, depth + 1);
    }
  }
}

/** Extract an ordered waypoint list from an ELK edge. */
function edgeToWaypoints(
  edge: ElkExtendedEdge,
  offsetX = 0,
  offsetY = 0,
): EdgeWaypoint[] {
  const sections = edge.sections ?? [];
  if (sections.length === 0) return [];
  const pts: EdgeWaypoint[] = [];
  for (const s of sections) {
    if (pts.length === 0) {
      pts.push({ x: s.startPoint.x + offsetX, y: s.startPoint.y + offsetY });
    }
    for (const b of s.bendPoints ?? []) {
      pts.push({ x: b.x + offsetX, y: b.y + offsetY });
    }
    pts.push({ x: s.endPoint.x + offsetX, y: s.endPoint.y + offsetY });
  }
  return pts;
}

export function adaptElkResultToReactFlow(
  input: ElkToReactFlowInput,
): ElkToReactFlowResult {
  const {
    laidOut,
    tables,
    relationships,
    views = [],
    namespaces,
    cardinalityByRelId,
    crossModelEdgeIds,
  } = input;

  const positions = new Map<
    string,
    { node: ElkNode; absX: number; absY: number; depth: number }
  >();
  collectAbsolutePositions(laidOut, positions);

  const tableById = new Map(tables.map((t) => [t.id, t]));
  const viewById = new Map(views.map((v) => [v.id, v]));

  // ── handleSideByTable + per-role side map ──────────────────────────
  // We track which side ELK ended up placing each port on so:
  //   1. `handleSideByTable` (back-compat: one side per column) drives
  //      the visual dimming of the OTHER side's pair in `TableNode`.
  //   2. `roleSideByTable` (new: per role) tells the React Flow edge
  //      which exact handle id to anchor to (`<col>-source-<side>` /
  //      `<col>-target-<side>`).
  const handleSideByTable = new Map<string, Record<string, 'left' | 'right'>>();
  const roleSideByTable = new Map<
    string,
    Record<string, { source?: 'left' | 'right'; target?: 'left' | 'right' }>
  >();
  for (const entry of positions.values()) {
    const t = tableById.get(entry.node.id);
    if (!t) continue;
    const width = entry.node.width ?? 0;
    const ports = entry.node.ports ?? [];
    const map: Record<string, 'left' | 'right'> = {};
    const roleMap: Record<string, { source?: 'left' | 'right'; target?: 'left' | 'right' }> = {};
    for (const p of ports) {
      const parsed = parsePortId(p.id ?? '');
      if (!parsed) continue;
      const side: 'left' | 'right' = (p.x ?? 0) >= width / 2 ? 'right' : 'left';
      // Per-role side (used by edges to pick the right anchor).
      if (!roleMap[parsed.columnId]) roleMap[parsed.columnId] = {};
      roleMap[parsed.columnId][parsed.role] = side;
      // Single-side hint (used by TableNode dimming). Prefer the source
      // port's side because that's where the column "outputs" visually.
      if (parsed.role === 'source' || map[parsed.columnId] === undefined) {
        map[parsed.columnId] = side;
      }
    }
    handleSideByTable.set(t.id, map);
    roleSideByTable.set(t.id, roleMap);
  }

  // ── Nodes ──────────────────────────────────────────────────────────
  const nodes: Node[] = [];

  // 1. Namespace background nodes.
  if (namespaces && namespaces.length > 0) {
    for (const ns of namespaces) {
      const entry = positions.get(`ns:${ns.id}`);
      if (!entry) continue;
      nodes.push({
        id: `ns:${ns.id}`,
        type: 'namespace',
        position: { x: entry.absX, y: entry.absY },
        data: {
          label: ns.label,
          engine: ns.engine,
          width: entry.node.width ?? 0,
          height: entry.node.height ?? 0,
          tintIndex: ns.tintIndex ?? 0,
        },
        width: entry.node.width ?? 0,
        height: entry.node.height ?? 0,
        draggable: false,
        selectable: false,
        zIndex: -1,
      });
    }
  }

  // 2. Table nodes.
  for (const t of tables) {
    const entry = positions.get(t.id);
    if (!entry) continue;
    nodes.push({
      id: t.id,
      type: 'erTable',
      position: { x: entry.absX, y: entry.absY },
      data: {
        table: t,
        handleSideByColumn: handleSideByTable.get(t.id) ?? {},
      },
      width: entry.node.width,
    });
  }

  // 3. View nodes.
  for (const v of views) {
    const entry = positions.get(v.id);
    if (!entry) continue;
    const srcTable = tableById.get(v.sourceTableId);
    nodes.push({
      id: v.id,
      type: 'erView',
      position: { x: entry.absX, y: entry.absY },
      data: {
        view: v,
        sourceTableName: srcTable?.name ?? '',
        selected: false,
      },
      width: entry.node.width,
    });
  }

  // ── Edges ──────────────────────────────────────────────────────────
  // Walk the laidOut tree collecting every edge (they can live at root
  // or inside a namespace compound). Offset edges by the parent's abs
  // position so waypoints are in canvas coordinates.
  const edges: Edge[] = [];

  function walkEdges(
    node: ElkNode,
    parentAbsX = 0,
    parentAbsY = 0,
  ): void {
    // `node.children` already has x/y relative to `node`; edges inside
    // `node.edges` use those same coordinates, so the offset we apply
    // is the ABSOLUTE position of `node` itself.
    const myAbsX = parentAbsX;
    const myAbsY = parentAbsY;
    const ownEdges = (node.edges ?? []) as ElkExtendedEdge[];
    for (const e of ownEdges) {
      const rel = relationships.find((r) => r.id === e.id);
      if (rel) {
        const pm = (() => {
          // Reconstruct the source/target column from the port ids; if
          // the port id doesn't parse (e.g. view edge), fall back to
          // `rel`.
          const srcPort = e.sources?.[0] ?? '';
          const tgtPort = e.targets?.[0] ?? '';
          const sParsed = parsePortId(srcPort);
          const tParsed = parsePortId(tgtPort);
          return {
            sourceTableId: sParsed?.tableId ?? rel.sourceTable,
            sourceColumnId: sParsed?.columnId ?? rel.sourceColumn,
            targetTableId: tParsed?.tableId ?? rel.targetTable,
            targetColumnId: tParsed?.columnId ?? rel.targetColumn,
          };
        })();

        const cardinality = cardinalityByRelId.get(rel.id) ?? {
          source: 'one-only' as CrowsFootCardinality,
          target: 'one-only' as CrowsFootCardinality,
        };

        const waypoints = edgeToWaypoints(e, myAbsX, myAbsY);

        // Resolve the side ELK chose for each end so React Flow anchors
        // the edge to the right handle (`<col>-source-<side>`,
        // `<col>-target-<side>`). Default to 'right' for source / 'left'
        // for target if the lookup somehow misses (matches the legacy
        // ELK direction RIGHT default).
        const sourceSide =
          roleSideByTable.get(pm.sourceTableId)?.[pm.sourceColumnId]?.source ?? 'right';
        const targetSide =
          roleSideByTable.get(pm.targetTableId)?.[pm.targetColumnId]?.target ?? 'left';

        edges.push({
          id: rel.id,
          source: pm.sourceTableId,
          target: pm.targetTableId,
          sourceHandle: `${pm.sourceColumnId}-source-${sourceSide}`,
          targetHandle: `${pm.targetColumnId}-target-${targetSide}`,
          type: 'crowsFootER',
          data: {
            waypoints,
            cardinality,
            crossModel: crossModelEdgeIds?.has(rel.id) ?? false,
          } satisfies CrowsFootEdgeData,
        });
      } else if (e.id.startsWith('view-edge-')) {
        const waypoints = edgeToWaypoints(e, myAbsX, myAbsY);
        const viewId = e.id.replace('view-edge-', '');
        const srcId = e.targets?.[0] ?? '';
        const v = viewById.get(viewId);
        edges.push({
          id: e.id,
          source: viewId,
          target: srcId,
          type: 'viewDerived',
          data: { waypoints, view: v },
        });
      }
    }
    // Recurse into children's own edges.
    for (const child of node.children ?? []) {
      const childAbsX = myAbsX + (child.x ?? 0);
      const childAbsY = myAbsY + (child.y ?? 0);
      walkEdges(child, childAbsX, childAbsY);
    }
  }
  walkEdges(laidOut);

  return { nodes, edges, handleSideByTable };
}
