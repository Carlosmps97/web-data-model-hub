'use client';

import React, { useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
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

  // ── Sync tables → React Flow nodes ──
  useEffect(() => {
    const currFP = getStructFingerprint(tables);
    const structChanged = currFP !== prevStructRef.current;
    prevStructRef.current = currFP;

    setNodes(prev => {
      const existingMap = new Map(prev.map(n => [n.id, n]));
      const tableIds = new Set(tables.map(t => t.id));

      // Remove nodes that no longer exist
      const result: RFNode[] = [];

      tables.forEach(table => {
        const existing = existingMap.get(table.id);
        if (existing && !structChanged) {
          // Position-only change or selection change — just update data
          result.push({
            ...existing,
            data: { table, selected: table.id === selectedTableId },
          });
        } else {
          // New node or structure changed
          result.push({
            id: table.id,
            type: 'erTable',
            position: existing
              ? existing.position // preserve dragged position
              : { x: table.position?.x || 50, y: table.position?.y || 50 },
            data: { table, selected: table.id === selectedTableId },
            width: NODE_WIDTH,
          });
        }
      });

      return result;
    });
  }, [tables, selectedTableId, setNodes, getStructFingerprint]);

  // ── Sync relationships → React Flow edges ──
  useEffect(() => {
    const newEdges: RFEdge[] = [];

    relationships.forEach(rel => {
      const src = tables.find(t => t.name === rel.sourceTable || t.id === rel.sourceTable);
      const tgt = tables.find(t => t.name === rel.targetTable || t.id === rel.targetTable);
      if (!src || !tgt) return;

      const isConnectedToSelected =
        selectedTableId === src.id || selectedTableId === tgt.id;
      const hasSomeSelected = selectedTableId !== null;

      const sourceLabel = rel.type === 'one-to-one' ? '1' : rel.type === 'one-to-many' ? '*' : '*';
      const targetLabel = rel.type === 'one-to-one' ? '1' : rel.type === 'one-to-many' ? '0..1' : '*';

      newEdges.push({
        id: rel.id,
        source: src.id,
        target: tgt.id,
        sourceHandle: `${rel.sourceColumn}-source`,
        targetHandle: `${rel.targetColumn}-target`,
        type: 'animatedER',
        data: {
          highlighted: isConnectedToSelected,
          dimmed: hasSomeSelected && !isConnectedToSelected,
          sourceLabel,
          targetLabel,
        },
      });
    });

    setEdges(newEdges);
  }, [relationships, tables, selectedTableId, setEdges]);

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
        />
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
