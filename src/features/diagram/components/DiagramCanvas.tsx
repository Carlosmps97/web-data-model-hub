'use client';

import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
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
  type Connection,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import TableNodeComponent from './TableNode';
import ViewNodeComponent from './ViewNode';
import AnimatedEREdge from './AnimatedEdge';
import NamespaceNode from './NamespaceNode';
import AutoArrangePopover, { type LayoutAlgorithm } from './AutoArrangePopover';
import { layoutLeftRight, layoutSnowflake, layoutCompact } from '../utils/layoutAlgorithms';
import type { TableModel, Relationship, ViewModel, DatabaseEngine } from '@/types/model';

// ── Layout constants (must match TableNode) ──
const NODE_WIDTH = 260;
const VIEW_NODE_WIDTH = 280;

// ── Register custom types once ──
const nodeTypes: NodeTypes = {
  erTable: TableNodeComponent,
  erView: ViewNodeComponent,
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

type CanvasTool = 'select' | 'connect';

interface PendingConn {
  sourceNodeId: string;
  sourceColumn: string;
  targetNodeId: string;
  targetColumn: string;
}

interface DiagramCanvasProps {
  tables: TableModel[];
  relationships: Relationship[];
  views?: ViewModel[];
  selectedTableId: string | null;
  onSelectTable: (id: string | null) => void;
  onEditTable?: (id: string) => void;
  onEditView?: (id: string) => void;
  /** Called when user creates a new relationship by dragging column handles. */
  onAddRelationship?: (rel: Relationship) => void;
  /** Called when user selects an edge and presses Delete. */
  onRemoveRelationship?: (id: string) => void;
  namespaces?: NamespaceInfo[];
  tablePositions?: Record<string, { x: number; y: number }>;
}

function DiagramCanvasInner({
  tables,
  relationships,
  views = [],
  selectedTableId,
  onSelectTable,
  onEditTable,
  onEditView,
  onAddRelationship,
  onRemoveRelationship,
  namespaces,
  tablePositions,
}: DiagramCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<CanvasTool>('select');
  const [pendingConn, setPendingConn] = useState<PendingConn | null>(null);

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

      // 3. View nodes — placed below their source table
      views.forEach((view, vIdx) => {
        const srcTable = tables.find((t) => t.id === view.sourceTableId);
        const existingView = existingMap.get(view.id);
        const viewData = {
          view,
          sourceTableName: srcTable?.name ?? '',
          selected: false,
          onEditView,
        };
        const fallbackPos = srcTable
          ? { x: (autoPositions[srcTable.id]?.x ?? 50) + NODE_WIDTH + 60, y: (autoPositions[srcTable.id]?.y ?? 50) + vIdx * 40 }
          : { x: 50 + vIdx * (VIEW_NODE_WIDTH + 40), y: 400 };
        result.push({
          id: view.id,
          type: 'erView',
          position: existingView?.position ?? fallbackPos,
          data: viewData,
          width: VIEW_NODE_WIDTH,
        });
      });

      return result;
    });
  }, [tables, relationships, views, selectedTableId, hoveredTableId, activeColsByTable, setNodes, getStructFingerprint, onEditTable, onEditView, namespaces, namespaceFP, tablePositions]);

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

    // View → source table: dashed edges
    views.forEach((view) => {
      const srcTable = tables.find((t) => t.id === view.sourceTableId);
      if (!srcTable) return;
      newEdges.push({
        id: `view-edge-${view.id}`,
        source: view.id,
        target: srcTable.id,
        type: 'default',
        animated: false,
        style: {
          stroke: '#94a3b8',
          strokeWidth: 1.5,
          strokeDasharray: '5 4',
        },
        label: 'derived from',
        labelStyle: { fontSize: 9, fill: '#94a3b8' },
        labelBgStyle: { fill: '#f8fafc', fillOpacity: 0.8 },
      });
    });

    setEdges(newEdges);
  }, [relationships, tables, views, activeTableId, setEdges, tableNamespace]);

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

  // ── Connection handlers ──

  /** Fires when user drags from a column handle to another. */
  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return; // no self-loops

    const sourceCol = connection.sourceHandle?.replace(/-source$/, '') ?? '';
    const targetCol = connection.targetHandle?.replace(/-target$/, '') ?? '';
    if (!sourceCol || !targetCol) return;

    // Only allow table → table connections (not view nodes)
    const srcIsTable = tables.some((t) => t.id === connection.source);
    const tgtIsTable = tables.some((t) => t.id === connection.target);
    if (!srcIsTable || !tgtIsTable) return;

    setPendingConn({
      sourceNodeId: connection.source,
      sourceColumn: sourceCol,
      targetNodeId: connection.target,
      targetColumn: targetCol,
    });
  }, [tables]);

  /** Called when user confirms relationship type in the picker. */
  const confirmConnection = useCallback((type: Relationship['type']) => {
    if (!pendingConn) return;
    const srcTable = tables.find((t) => t.id === pendingConn.sourceNodeId);
    const tgtTable = tables.find((t) => t.id === pendingConn.targetNodeId);
    if (!srcTable || !tgtTable) { setPendingConn(null); return; }

    onAddRelationship?.({
      id: uuidv4(),
      sourceTable: srcTable.name,
      sourceColumn: pendingConn.sourceColumn,
      targetTable: tgtTable.name,
      targetColumn: pendingConn.targetColumn,
      type,
    });
    setPendingConn(null);
    setActiveTool('select');
  }, [pendingConn, tables, onAddRelationship]);

  /** Fires when user selects an edge and presses Delete. */
  const handleEdgesDelete = useCallback((deleted: RFEdge[]) => {
    deleted.forEach((edge) => {
      if (!edge.id.startsWith('view-edge-')) {
        onRemoveRelationship?.(edge.id);
      }
    });
  }, [onRemoveRelationship]);

  /** Validates whether a dragged connection is allowed. */
  const isValidConnection = useCallback((connection: Connection | RFEdge) => {
    if (connection.source === connection.target) return false;
    return tables.some((t) => t.id === connection.source) &&
           tables.some((t) => t.id === connection.target);
  }, [tables]);

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

  // Derive names for the pending connection label
  const pendingSrcName = pendingConn ? tables.find(t => t.id === pendingConn.sourceNodeId)?.name : null;
  const pendingTgtName = pendingConn ? tables.find(t => t.id === pendingConn.targetNodeId)?.name : null;

  return (
    <div className={`diagram-canvas-wrapper ${activeTool === 'connect' ? 'canvas--connect-mode' : ''}`}>

      {/* ── Tool sidebar ─────────────────────────────────────────────── */}
      <div className="canvas-tool-sidebar" role="toolbar" aria-label="Herramientas del canvas">
        <button
          type="button"
          className={`canvas-tool-btn ${activeTool === 'select' ? 'active' : ''}`}
          onClick={() => { setActiveTool('select'); setPendingConn(null); }}
          title="Seleccionar · mover nodos (V)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 3l14 9-7 1-4 7-3-17z"/>
          </svg>
        </button>

        <div className="canvas-tool-sep" />

        <button
          type="button"
          className={`canvas-tool-btn ${activeTool === 'connect' ? 'active' : ''}`}
          onClick={() => setActiveTool(activeTool === 'connect' ? 'select' : 'connect')}
          title="Conectar columnas · arrastrá de una columna a otra para crear relación (E)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
        </button>

        {activeTool === 'connect' && (
          <div className="canvas-tool-hint">
            Arrastrá entre columnas para conectar
          </div>
        )}
      </div>

      {/* ── Connection type picker ────────────────────────────────────── */}
      {pendingConn && (
        <div className="conn-picker-overlay" onClick={() => setPendingConn(null)}>
          <div className="conn-picker" onClick={(e) => e.stopPropagation()}>
            <div className="conn-picker-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
              Nueva relación
            </div>
            <div className="conn-picker-route">
              <code>{pendingSrcName}.{pendingConn.sourceColumn}</code>
              <span>→</span>
              <code>{pendingTgtName}.{pendingConn.targetColumn}</code>
            </div>
            <p className="conn-picker-label">Tipo de relación</p>
            <div className="conn-picker-options">
              {([
                { type: 'one-to-one',  label: '1 : 1',  desc: 'Uno a uno' },
                { type: 'one-to-many', label: '1 : N',  desc: 'Uno a muchos' },
                { type: 'many-to-many',label: 'N : M',  desc: 'Muchos a muchos' },
              ] as const).map(({ type, label, desc }) => (
                <button
                  key={type}
                  type="button"
                  className="conn-picker-btn"
                  onClick={() => confirmConnection(type)}
                >
                  <span className="conn-picker-rel">{label}</span>
                  <span className="conn-picker-desc">{desc}</span>
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 6 }} onClick={() => setPendingConn(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

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
        onConnect={handleConnect}
        onEdgesDelete={handleEdgesDelete}
        isValidConnection={isValidConnection}
        connectionMode={'loose' as never}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
        minZoom={0.15}
        maxZoom={2.5}
        deleteKeyCode="Delete"
        defaultEdgeOptions={{ type: 'animatedER' }}
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
