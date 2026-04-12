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
  type OnNodeDrag,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import TableNodeComponent from './TableNode';
import AnimatedEREdge from './AnimatedEdge';
import AutoArrangePopover, { type LayoutAlgorithm } from './AutoArrangePopover';
import { layoutLeftRight, layoutSnowflake, layoutCompact } from '../utils/layoutAlgorithms';
import type { TableModel, Relationship } from '@/types/model';

// ── Layout constants (must match TableNode) ──
const NODE_WIDTH = 260;

// ── Register custom types once ──
const nodeTypes: NodeTypes = {
  erTable: TableNodeComponent,
};
const edgeTypes: EdgeTypes = {
  animatedER: AnimatedEREdge,
};

// ── Props ──
interface DiagramCanvasProps {
  tables: TableModel[];
  relationships: Relationship[];
  selectedTableId: string | null;
  onSelectTable: (id: string | null) => void;
  onUpdatePosition: (id: string, pos: { x: number; y: number }) => void;
}

function DiagramCanvasInner({
  tables,
  relationships,
  selectedTableId,
  onSelectTable,
  onUpdatePosition,
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
        return `${t.id}|${t.name}|${cols}|${t.functionalDefinition || ''}`;
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

  // ── Sync tables → React Flow nodes ──
  useEffect(() => {
    const currFP = getStructFingerprint(tables);
    const structChanged = currFP !== prevStructRef.current;
    prevStructRef.current = currFP;

    setNodes(prev => {
      const existingMap = new Map(prev.map(n => [n.id, n]));

      const result: RFNode[] = [];

      tables.forEach(table => {
        const existing = existingMap.get(table.id);
        const activeCols = activeColsByTable.get(table.id);
        const nodeData = {
          table,
          selected: table.id === selectedTableId || table.id === hoveredTableId,
          activeRelationColumns: activeCols ? Array.from(activeCols) : [],
        };

        if (existing && !structChanged) {
          result.push({ ...existing, data: nodeData });
        } else {
          result.push({
            id: table.id,
            type: 'erTable',
            position: existing
              ? existing.position
              : { x: table.position?.x || 50, y: table.position?.y || 50 },
            data: nodeData,
            width: NODE_WIDTH,
          });
        }
      });

      return result;
    });
  }, [tables, selectedTableId, hoveredTableId, activeColsByTable, setNodes, getStructFingerprint]);

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
        },
      });
    });

    setEdges(newEdges);
  }, [relationships, tables, activeTableId, setEdges]);

  // ── Event handlers ──
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: RFNode) => {
      onSelectTable(node.id);
    },
    [onSelectTable],
  );

  const handlePaneClick = useCallback(() => {
    onSelectTable(null);
  }, [onSelectTable]);

  const handleNodeDragStop: OnNodeDrag = useCallback(
    (_, node) => {
      onUpdatePosition(node.id, { x: node.position.x, y: node.position.y });
    },
    [onUpdatePosition],
  );

  const handleNodeMouseEnter = useCallback(
    (_: React.MouseEvent, node: RFNode) => {
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
          const pos = positions[n.id];
          return pos ? { ...n, position: pos } : n;
        }),
      );

      // Persist all new positions
      Object.entries(positions).forEach(([id, pos]) => {
        onUpdatePosition(id, pos);
      });

      // Fit view after layout with a small delay for rendering
      setTimeout(() => fitView({ padding: 0.3, maxZoom: 1.2, duration: 400 }), 50);
    },
    [tables, relationships, setNodes, onUpdatePosition, fitView],
  );

  // ── MiniMap node color ──
  const miniMapNodeColor = useCallback((node: RFNode) => {
    const data = node.data as { selected?: boolean } | undefined;
    return data?.selected ? '#468189' : '#B8CCCA';
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
        onNodeDragStop={handleNodeDragStop}
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
        style={{ background: '#FAFAF8' }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#d7d2c7"
        />
        <Controls
          showInteractive={false}
          position="bottom-center"
          style={{
            display: 'flex',
            flexDirection: 'row',
            gap: '2px',
            background: '#FFFFFF',
            border: '1px solid rgba(157,190,187,0.4)',
            borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(3,25,38,0.1)',
            padding: '4px',
            bottom: '16px',
          }}
        >
          <div className="divider-v" style={{ width: 1, height: 20, background: 'rgba(157,190,187,0.3)', margin: '0 2px' }} />
          <AutoArrangePopover onSelect={handleAutoArrange} />
        </Controls>
        <MiniMap
          nodeColor={miniMapNodeColor}
          nodeStrokeWidth={1}
          maskColor="rgba(251, 247, 238, 0.7)"
          style={{
            background: '#FFFFFF',
            border: '1px solid rgba(157,190,187,0.4)',
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
