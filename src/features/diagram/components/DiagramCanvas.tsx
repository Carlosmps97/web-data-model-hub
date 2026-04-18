'use client';

import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  BackgroundVariant,
  type Node as RFNode,
  type Edge as RFEdge,
  type NodeTypes,
  type EdgeTypes,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import TableNodeComponent from './TableNode';
import AnimatedEREdge from './AnimatedEdge';
import NamespaceNode from './NamespaceNode';
import AutoArrangePopover, { type LayoutAlgorithm } from './AutoArrangePopover';
import { layoutLeftRight, layoutSnowflake, layoutCompact } from '../utils/layoutAlgorithms';
import type { TableModel, Relationship, DatabaseEngine } from '@/types/model';

// ── Layout constants (must match TableNode) ──
const NODE_WIDTH = 260;

// ── Register custom types once ──
const nodeTypes: NodeTypes = {
  erTable: TableNodeComponent,
  namespace: NamespaceNode,
};
const edgeTypes: EdgeTypes = {
  animatedER: AnimatedEREdge,
};

// ── Props ──
/** Namespace = a logical grouping (usually a model) rendered as a background rect on the canvas. */
export interface NamespaceInfo {
  id: string;
  label: string;
  engine?: DatabaseEngine;
  tableIds: string[];
  position: { x: number; y: number };
  width: number;
  height: number;
  /** Optional palette index for tint. */
  tintIndex?: number;
}

interface DiagramCanvasProps {
  tables: TableModel[];
  relationships: Relationship[];
  selectedTableId: string | null;
  onSelectTable: (id: string | null) => void;
  onEditTable?: (id: string) => void;
  /**
   * Optional namespace groups to render as background panels.
   * When provided, tables without an explicit position will be placed inside their namespace.
   */
  namespaces?: NamespaceInfo[];
  /** Map of tableId -> pre-computed position (used by global canvas to place tables within namespaces). */
  tablePositions?: Record<string, { x: number; y: number }>;
}

function DiagramCanvasInner({
  tables,
  relationships,
  selectedTableId,
  onSelectTable,
  onEditTable,
  namespaces,
  tablePositions,
}: DiagramCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null);

  // Hover takes visual priority over click selection
  const activeTableId = hoveredTableId ?? selectedTableId;

  // Track structural changes to avoid re-syncing on position-only updates
  const prevStructRef = useRef<string>('');

  const getStructFingerprint = useCallback((tbls: TableModel[]) => {
    return tbls
      .map(t => {
        const cols = t.columns.map(c => `${c.name}:${c.dataType}:${c.isPrimaryKey}:${c.isForeignKey}`).join(',');
        return `${t.id}|${t.name}|${cols}|${t.functionalDefinition || ''}|${t.color || ''}`;
      })
      .sort()
      .join('||');
  }, []);

  // ── Derive active relation columns per table ──
  const activeColsByTable = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!activeTableId) return map;

    relationships.forEach(rel => {
      const src = tables.find(t => t.name === rel.sourceTable || t.id === rel.sourceTable);
      const tgt = tables.find(t => t.name === rel.targetTable || t.id === rel.targetTable);
      if (!src || !tgt) return;

      const srcConnected = src.id === activeTableId;
      const tgtConnected = tgt.id === activeTableId;
      if (!srcConnected && !tgtConnected) return;

      if (!map.has(src.id)) map.set(src.id, new Set());
      map.get(src.id)!.add(rel.sourceColumn);

      if (!map.has(tgt.id)) map.set(tgt.id, new Set());
      map.get(tgt.id)!.add(rel.targetColumn);
    });

    return map;
  }, [activeTableId, tables, relationships]);

  // ── Fingerprint for namespaces (structural) ──
  const namespaceFP = useMemo(() => {
    if (!namespaces) return '';
    return namespaces
      .map(n => `${n.id}|${n.label}|${n.engine ?? ''}|${n.position.x},${n.position.y}|${n.width}x${n.height}`)
      .join('||');
  }, [namespaces]);

  // ── Sync tables + namespaces → React Flow nodes ──
  useEffect(() => {
    const currFP = getStructFingerprint(tables) + '::' + namespaceFP;
    const structChanged = currFP !== prevStructRef.current;
    prevStructRef.current = currFP;

    // Compute smart positions when structure changes and no explicit positions given
    const autoPositions = structChanged && !tablePositions ? layoutLeftRight(tables, relationships) : {};

    setNodes(prev => {
      const existingMap = new Map(prev.map(n => [n.id, n]));

      const result: RFNode[] = [];

      // 1. Namespace background nodes (render first → behind tables)
      if (namespaces && namespaces.length > 0) {
        namespaces.forEach((ns, idx) => {
          const existing = existingMap.get(`ns:${ns.id}`);
          result.push({
            id: `ns:${ns.id}`,
            type: 'namespace',
            position: existing?.position ?? ns.position,
            data: {
              label: ns.label,
              engine: ns.engine,
              width: ns.width,
              height: ns.height,
              tintIndex: ns.tintIndex ?? idx,
            },
            width: ns.width,
            height: ns.height,
            draggable: false,
            selectable: false,
            zIndex: -1,
          });
        });
      }

      // 2. Table nodes
      tables.forEach(table => {
        const existing = existingMap.get(table.id);
        const activeCols = activeColsByTable.get(table.id);
        const nodeData = {
          table,
          selected: table.id === selectedTableId || table.id === hoveredTableId,
          activeRelationColumns: activeCols ? Array.from(activeCols) : [],
          onEditTable,
        };

        if (existing && !structChanged) {
          result.push({ ...existing, data: nodeData });
        } else {
          // Priority: explicit position override (from global view) > existing (drag) > auto layout
          const explicit = tablePositions?.[table.id];
          const position = explicit ?? existing?.position ?? autoPositions[table.id] ?? { x: 50, y: 50 };
          result.push({
            id: table.id,
            type: 'erTable',
            position,
            data: nodeData,
            width: NODE_WIDTH,
          });
        }
      });

      return result;
    });
  }, [tables, relationships, selectedTableId, hoveredTableId, activeColsByTable, setNodes, getStructFingerprint, onEditTable, namespaces, namespaceFP, tablePositions]);

  // ── Build tableId → namespaceId map for cross-model detection ──
  const tableNamespace = useMemo(() => {
    const map = new Map<string, string>();
    namespaces?.forEach(ns => ns.tableIds.forEach(tid => map.set(tid, ns.id)));
    return map;
  }, [namespaces]);

  // ── Sync relationships → React Flow edges ──
  useEffect(() => {
    const newEdges: RFEdge[] = [];
    // Track edge index per node-pair to offset overlapping wires
    const pairCounter = new Map<string, number>();

    relationships.forEach(rel => {
      const src = tables.find(t => t.name === rel.sourceTable || t.id === rel.sourceTable);
      const tgt = tables.find(t => t.name === rel.targetTable || t.id === rel.targetTable);
      if (!src || !tgt) return;

      const isConnectedToActive =
        activeTableId === src.id || activeTableId === tgt.id;
      const hasSomeActive = activeTableId !== null;

      const sourceLabel = rel.type === 'one-to-one' ? '1' : rel.type === 'one-to-many' ? '*' : '*';
      const targetLabel = rel.type === 'one-to-one' ? '1' : rel.type === 'one-to-many' ? '0..1' : '*';

      // Cross-model = source and target belong to different namespaces
      const srcNs = tableNamespace.get(src.id);
      const tgtNs = tableNamespace.get(tgt.id);
      const crossModel = !!srcNs && !!tgtNs && srcNs !== tgtNs;

      // Compute edge index for this node pair (order-independent key)
      const pairKey = [src.id, tgt.id].sort().join('::');
      const edgeIndex = pairCounter.get(pairKey) ?? 0;
      pairCounter.set(pairKey, edgeIndex + 1);

      newEdges.push({
        id: rel.id,
        source: src.id,
        target: tgt.id,
        sourceHandle: `${rel.sourceColumn}-source`,
        targetHandle: `${rel.targetColumn}-target`,
        type: 'animatedER',
        data: {
          highlighted: isConnectedToActive,
          dimmed: hasSomeActive && !isConnectedToActive,
          sourceLabel,
          targetLabel,
          edgeIndex,
          crossModel,
        },
      });
    });

    setEdges(newEdges);
  }, [relationships, tables, activeTableId, setEdges, tableNamespace]);

  // ── Event handlers ──
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: RFNode) => {
      // Namespace nodes are purely visual ─ don't affect selection
      if (node.type === 'namespace') return;
      onSelectTable(node.id);
    },
    [onSelectTable],
  );

  const handlePaneClick = useCallback(() => {
    onSelectTable(null);
  }, [onSelectTable]);

  const handleNodeMouseEnter = useCallback(
    (_: React.MouseEvent, node: RFNode) => {
      if (node.type === 'namespace') return;
      setHoveredTableId(node.id);
    },
    [],
  );

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredTableId(null);
  }, []);

  // ── Auto arrange ──
  const { fitView } = useReactFlow();

  const handleAutoArrange = useCallback(
    (algorithm: LayoutAlgorithm) => {
      let positions: Record<string, { x: number; y: number }>;
      switch (algorithm) {
        case 'left-right':
          positions = layoutLeftRight(tables, relationships);
          break;
        case 'snowflake':
          positions = layoutSnowflake(tables, relationships);
          break;
        case 'compact':
          positions = layoutCompact(tables, relationships);
          break;
      }

      setNodes(prev =>
        prev.map(n => {
          if (n.type === 'namespace') return n; // keep namespace positions
          const pos = positions[n.id];
          return pos ? { ...n, position: pos } : n;
        }),
      );

      // Fit view after layout with a small delay for rendering
      setTimeout(() => fitView({ padding: 0.3, maxZoom: 1.2, duration: 400 }), 50);
    },
    [tables, relationships, setNodes, fitView],
  );

  // ── MiniMap node color ──
  const miniMapNodeColor = useCallback((node: RFNode) => {
    if (node.type === 'namespace') return 'transparent';
    const data = node.data as { selected?: boolean } | undefined;
    return data?.selected ? '#0d9488' : '#cbd5e1';
  }, []);

  return (
    <div className="diagram-canvas-wrapper">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
        minZoom={0.15}
        maxZoom={2.5}
        defaultEdgeOptions={{
          type: 'animatedER',
        }}
        proOptions={{ hideAttribution: true }}
        snapToGrid
        snapGrid={[16, 16]}
        style={{ background: '#f1f5f9' }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#94a3b8"
        />
        <Controls
          showInteractive={false}
          position="bottom-center"
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: '2px',
            background: '#FFFFFF',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(15,23,42,0.08)',
            padding: '4px',
            bottom: '16px',
          }}
        >
          <div className="divider-v" style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 2px' }} />
          <AutoArrangePopover onSelect={handleAutoArrange} />
        </Controls>
        <MiniMap
          nodeColor={miniMapNodeColor}
          nodeStrokeWidth={1}
          maskColor="rgba(241, 245, 249, 0.8)"
          style={{
            background: '#FFFFFF',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
          }}
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}

// Wrap in ReactFlowProvider for contexts
export default function DiagramCanvas(props: DiagramCanvasProps) {
  return (
    <ReactFlowProvider>
      <DiagramCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
