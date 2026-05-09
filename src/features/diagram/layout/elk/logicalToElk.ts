/**
 * Build an ELK input graph from the logical data model.
 *
 * The output is a single root `ElkNode` that the engine hands directly
 * to `elk.layout(root)`. Design decisions:
 *
 * 1. Tables become leaf nodes (when `hierarchy=false`) or children of
 *    a namespace compound node (when `hierarchy=true`).
 * 2. Only columns involved in at least one FK get a port pair — purely
 *    "decorative" columns would bloat the port list and confuse ELK's
 *    port-side placement without any visual benefit.
 * 3. Ports carry `FIXED_ORDER` constraints so ELK preserves the column
 *    order we declared; it only gets to pick left vs right side.
 * 4. Relationships that cannot resolve both endpoints (dangling FK) are
 *    silently skipped and reported on `warnings` for the caller.
 * 5. Tables with zero edges stay in the graph but are collected in
 *    `islands` so the canvas can optionally re-pack them with potpack
 *    instead of letting ELK stack them in empty layers.
 */

import type { ElkNode } from 'elkjs/lib/elk-api';

import type { Relationship, TableModel, ViewModel } from '@/types/model';
import { resolveColumn } from '@/lib/columnRef';

import { columnRowCenterY, estimateTableSize, estimateViewSize } from '../utils/estimateNodeSize';
import {
  NAMESPACE_NODE_OPTIONS,
  TABLE_NODE_OPTIONS,
  resolveLayoutOptions,
} from './config';
import { buildPortId } from './types';
import type { ElkLayoutMode } from './types';

export interface LogicalToElkInput {
  tables: TableModel[];
  relationships: Relationship[];
  views?: ViewModel[];
  /** When true, wrap tables inside namespace compound nodes. */
  hierarchy?: boolean;
  /** tableId → namespaceId. Only used when hierarchy=true. */
  namespaceByTableId?: Map<string, string>;
  /** Namespace metadata (label, tint) — passed through to the render layer. */
  namespaces?: Array<{ id: string; label: string; tintIndex?: number }>;
  /** Layout mode — governs the `elk.direction` + spacing preset. */
  mode: ElkLayoutMode;
  /** Previously persisted positions — when present, we hint ELK to
   *  respect them via semiInteractive + per-node x/y. */
  persistedPositions?: Map<string, { x: number; y: number }>;
}

export interface LogicalToElkResult {
  /** Root node ready for `elk.layout`. */
  graph: ElkNode;
  /** Relationship.id → ports used to emit the edge, so the adapter can
   *  rehydrate the correct React Flow `sourceHandle` / `targetHandle`. */
  edgeIndex: Map<
    string,
    {
      sourceTableId: string;
      sourceColumnId: string;
      targetTableId: string;
      targetColumnId: string;
    }
  >;
  /** Table ids that have zero edges — candidates for island packing. */
  islands: string[];
  /** Non-fatal issues (e.g. dangling FKs) surfaced to the caller. */
  warnings: string[];
}

export function buildElkGraph(input: LogicalToElkInput): LogicalToElkResult {
  const { tables, relationships, views = [], mode } = input;

  const warnings: string[] = [];
  const edgeIndex: LogicalToElkResult['edgeIndex'] = new Map();
  const islands: string[] = [];

  // 1. Figure out which columns participate in at least one FK → only
  //    those columns get ports.
  const portsByTable = new Map<string, Set<string>>();
  for (const rel of relationships) {
    const srcCol = resolveColumn(tables, rel.sourceTable, rel.sourceColumn);
    const tgtCol = resolveColumn(tables, rel.targetTable, rel.targetColumn);
    const srcTable = tables.find(
      (t) => t.id === rel.sourceTable || t.name === rel.sourceTable,
    );
    const tgtTable = tables.find(
      (t) => t.id === rel.targetTable || t.name === rel.targetTable,
    );
    if (!srcCol || !tgtCol || !srcTable || !tgtTable) {
      warnings.push(
        `Relationship ${rel.id} could not be resolved (source=${rel.sourceTable}.${rel.sourceColumn}, target=${rel.targetTable}.${rel.targetColumn})`,
      );
      continue;
    }
    if (!portsByTable.has(srcTable.id)) portsByTable.set(srcTable.id, new Set());
    if (!portsByTable.has(tgtTable.id)) portsByTable.set(tgtTable.id, new Set());
    portsByTable.get(srcTable.id)!.add(srcCol.id);
    portsByTable.get(tgtTable.id)!.add(tgtCol.id);

    edgeIndex.set(rel.id, {
      sourceTableId: srcTable.id,
      sourceColumnId: srcCol.id,
      targetTableId: tgtTable.id,
      targetColumnId: tgtCol.id,
    });
  }

  // 2. Build ELK table nodes with ports. Direction RIGHT ⇒ outgoing
  //    edges leave EAST and incoming arrive WEST by default. We drop
  //    both a source (east) and a target (west) port per participating
  //    column so any direction of FK works without re-computing.
  const tableNodes: ElkNode[] = tables.map((t) => {
    const dims = estimateTableSize(t);
    const cols = portsByTable.get(t.id);

    const ports: ElkNode['ports'] = [];
    if (cols) {
      // Iterate in declaration order so `port.index` mirrors column row order.
      t.columns.forEach((col, idx) => {
        if (!cols.has(col.id)) return;
        const y = columnRowCenterY(idx);
        ports.push({
          id: buildPortId(t.id, col.id, 'source'),
          width: 8,
          height: 8,
          // Position the port at the right edge, aligned with the row center.
          x: dims.width,
          y,
          layoutOptions: {
            'elk.port.side': 'EAST',
            'elk.port.index': String(idx * 2 + 1),
          },
        });
        ports.push({
          id: buildPortId(t.id, col.id, 'target'),
          width: 8,
          height: 8,
          x: 0,
          y,
          layoutOptions: {
            'elk.port.side': 'WEST',
            'elk.port.index': String(idx * 2),
          },
        });
      });
    }

    const node: ElkNode = {
      id: t.id,
      width: dims.width,
      height: dims.height,
      ports,
      layoutOptions: { ...TABLE_NODE_OPTIONS },
    };

    // Hint ELK with the previously-persisted position so the layout is
    // stable across reloads / incremental structural edits.
    const prev = input.persistedPositions?.get(t.id);
    if (prev) {
      node.x = prev.x;
      node.y = prev.y;
    }

    return node;
  });

  // 3. Views don't enter the layered graph (their relationship to a
  //    source table is 1:1 and mostly visual). We still include them as
  //    leaf nodes with no ports so the engine reserves real estate, and
  //    we emit a dashed edge `view → sourceTable`.
  const viewNodes: ElkNode[] = views.map((v) => {
    const dims = estimateViewSize(v);
    const node: ElkNode = {
      id: v.id,
      width: dims.width,
      height: dims.height,
    };
    const prev = input.persistedPositions?.get(v.id);
    if (prev) {
      node.x = prev.x;
      node.y = prev.y;
    }
    return node;
  });

  // 4. Edges.
  const edges: ElkNode['edges'] = [];
  for (const [relId, pm] of edgeIndex) {
    edges.push({
      id: relId,
      sources: [buildPortId(pm.sourceTableId, pm.sourceColumnId, 'source')],
      targets: [buildPortId(pm.targetTableId, pm.targetColumnId, 'target')],
    });
  }
  // view → source table edges (dashed). These don't need Crow's Foot.
  for (const v of views) {
    if (!v.sourceTableId) continue;
    const src = tables.find((t) => t.id === v.sourceTableId);
    if (!src) continue;
    edges.push({
      id: `view-edge-${v.id}`,
      sources: [v.id],
      targets: [src.id],
    });
  }

  // 5. Islands: any table whose id never appears in `edgeIndex` on
  //    either side.
  const connectedTableIds = new Set<string>();
  for (const pm of edgeIndex.values()) {
    connectedTableIds.add(pm.sourceTableId);
    connectedTableIds.add(pm.targetTableId);
  }
  for (const t of tables) {
    if (!connectedTableIds.has(t.id)) islands.push(t.id);
  }

  // 6. Compose root. Hierarchy mode wraps tables in namespace compound
  //    nodes so ELK lays out each model's tables inside its rect, plus
  //    cross-model edges at the root.
  const rootLayoutOptions = resolveLayoutOptions(mode);

  let children: ElkNode[];
  if (input.hierarchy && input.namespaceByTableId && input.namespaces) {
    const grouped = new Map<string, ElkNode[]>();
    for (const tn of tableNodes) {
      const nsId = input.namespaceByTableId.get(tn.id);
      if (!nsId) continue;
      if (!grouped.has(nsId)) grouped.set(nsId, []);
      grouped.get(nsId)!.push(tn);
    }
    children = input.namespaces.map((ns) => ({
      id: `ns:${ns.id}`,
      layoutOptions: { ...NAMESPACE_NODE_OPTIONS },
      children: grouped.get(ns.id) ?? [],
    }));
    // Views live at the root (not nested in a namespace) so we don't
    // force ELK to tangle them into layered reasoning.
    children.push(...viewNodes);
    rootLayoutOptions['elk.hierarchyHandling'] = 'INCLUDE_CHILDREN';
  } else {
    children = [...tableNodes, ...viewNodes];
  }

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: rootLayoutOptions,
    children,
    edges,
  };

  return { graph, edgeIndex, islands, warnings };
}
