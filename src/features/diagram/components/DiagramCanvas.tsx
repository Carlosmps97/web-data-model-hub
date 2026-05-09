'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import NamespaceNode from './NamespaceNode';
import CrowsFootEdge from './CrowsFootEdge';
import CrowsFootMarkers from '../markers/CrowsFootMarkers';
import AutoArrangePopover, { type LayoutAlgorithm } from './AutoArrangePopover';

import { useElkLayout, type UseElkLayoutNamespace } from '../hooks/useElkLayout';
import { useHighlightController } from '../hooks/useHighlightController';
import { useLayoutPersistence } from '../hooks/useLayoutPersistence';

import type {
  DatabaseEngine,
  NodePosition,
  Relationship,
  TableModel,
  ViewModel,
} from '@/types/model';

/**
 * Stable empty-array singleton used as the default for optional array
 * props. Without this, a literal `= []` in destructuring creates a new
 * reference per render that propagates through `useElkLayout`'s
 * fingerprint and triggers spurious layout reruns.
 */
const EMPTY_VIEWS: ViewModel[] = [];

// ── Register custom types once ──
const nodeTypes: NodeTypes = {
  erTable: TableNodeComponent,
  erView: ViewNodeComponent,
  namespace: NamespaceNode,
};
const edgeTypes: EdgeTypes = {
  /** Crow's Foot ER edge with ELK-computed orthogonal waypoints. */
  crowsFootER: CrowsFootEdge,
};

// ── Props ──
/**
 * Namespace = a logical grouping (usually a model) rendered as a
 * background rect on the canvas.
 *
 * Position + width + height are now optional: ELK's hierarchy mode
 * computes them when `tableIds` is provided. They are only honoured as
 * hints for legacy callers that still pre-place namespaces (none today
 * after the ELK migration, kept to ease external integration).
 */
export interface NamespaceInfo {
  id: string;
  label: string;
  engine?: DatabaseEngine;
  tableIds: string[];
  position?: { x: number; y: number };
  width?: number;
  height?: number;
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
  onDeleteTable?: (id: string) => void;
  onEditView?: (id: string) => void;
  /** Called when user creates a new relationship by dragging column handles. */
  onAddRelationship?: (rel: Relationship) => void;
  /** Called when user selects an edge and presses Delete. */
  onRemoveRelationship?: (id: string) => void;
  namespaces?: NamespaceInfo[];
  /**
   * Model id for canvas position persistence. When absent — and no
   * `resolveModelIdForTable` is provided — drag/auto-layout writes are
   * suppressed (preview canvases / read-only views).
   */
  modelId?: string | null;
  /**
   * Multi-model resolver. Used by the global project view where each
   * table belongs to a different model. Takes precedence over `modelId`
   * when present.
   */
  resolveModelIdForTable?: (tableId: string) => string | null;
}

function DiagramCanvasInner({
  tables,
  relationships,
  views = EMPTY_VIEWS,
  selectedTableId,
  onSelectTable,
  onEditTable,
  onDeleteTable,
  onEditView,
  onAddRelationship,
  onRemoveRelationship,
  namespaces,
  modelId,
  resolveModelIdForTable,
}: DiagramCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  const [activeTool, setActiveTool] = useState<CanvasTool>('select');
  const [pendingConn, setPendingConn] = useState<PendingConn | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutAlgorithm>('horizontal');

  // ── Persisted positions (from DataModel.tables[*].position) ────────
  const persistedPositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const t of tables) if (t.position) map.set(t.id, t.position);
    for (const v of views) if (v.position) map.set(v.id, v.position);
    return map.size > 0 ? map : undefined;
  }, [tables, views]);

  // ── Namespaces adapter for the layout hook ─────────────────────────
  const elkNamespaces: UseElkLayoutNamespace[] | undefined = useMemo(() => {
    if (!namespaces || namespaces.length === 0) return undefined;
    return namespaces.map((n) => ({
      id: n.id,
      label: n.label,
      engine: n.engine,
      tintIndex: n.tintIndex,
      tableIds: n.tableIds,
    }));
  }, [namespaces]);

  // ── Run ELK layout — returns nodes, edges, handle sides, runLayout fn
  const elk = useElkLayout({
    tables,
    relationships,
    views,
    namespaces: elkNamespaces,
    persistedPositions,
    mode: layoutMode,
    autoRun: true,
  });

  // ── Highlight (hover / selection) ──────────────────────────────────
  const highlight = useHighlightController(tables, relationships, selectedTableId);

  // ── Persistence (drag + auto-layout) ───────────────────────────────
  const persistence = useLayoutPersistence({
    modelId,
    resolveModelId: resolveModelIdForTable,
  });

  // ── Stable callback refs ───────────────────────────────────────────
  // The decoration effect below would re-fire on every render if it
  // closed over the prop callbacks directly (parents may pass fresh
  // arrow functions). Routing through a ref keeps the effect stable
  // while still calling whatever the latest function is.
  const callbackRefs = useRef({ onEditTable, onDeleteTable, onEditView });
  useEffect(() => {
    callbackRefs.current = { onEditTable, onDeleteTable, onEditView };
  }, [onEditTable, onDeleteTable, onEditView]);

  // ── Track the last ELK runVersion we applied ───────────────────────
  // The decoration effect must NEVER blow away node positions — those
  // are owned by either ELK (initial run / auto-layout) or by the
  // user (drag). This ref lets us tell `(structural change)` apart
  // from `(hover change)` cheaply.
  const lastAppliedRunVersionRef = useRef(-1);

  // ── Effect 1: STRUCTURAL — runs only when ELK produces a fresh
  // layout (`elk.runVersion` ticks). Reseeds React Flow's node/edge
  // state with the new layout, preserving identity for nodes that
  // already exist (so React Flow keeps its measured / dragged state).
  // ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (elk.runVersion === lastAppliedRunVersionRef.current) return;
    lastAppliedRunVersionRef.current = elk.runVersion;

    if (elk.nodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return elk.nodes.map((next) => {
        const existing = prevById.get(next.id);
        // Keep the existing node's identity + measured flag whenever
        // possible. Replace position with ELK's and merge data.
        if (existing) {
          return {
            ...existing,
            type: next.type,
            position: next.position,
            // `width`/`height` come from ELK based on column count; if
            // the table grew/shrank we want the new size.
            width: next.width,
            height: next.height,
            data: { ...(existing.data ?? {}), ...(next.data ?? {}) },
            // Preserve the `selectable`, `draggable` etc. from the
            // freshly-built node (ELK adapter sets these per type).
            selectable: next.selectable,
            draggable: next.draggable,
            zIndex: next.zIndex,
            parentId: next.parentId,
            extent: next.extent,
          } as RFNode;
        }
        return next;
      });
    });

    setEdges((prev) => {
      const prevById = new Map(prev.map((e) => [e.id, e]));
      return elk.edges.map((next) => {
        const existing = prevById.get(next.id);
        if (existing) {
          return {
            ...existing,
            type: next.type,
            source: next.source,
            target: next.target,
            sourceHandle: next.sourceHandle,
            targetHandle: next.targetHandle,
            data: { ...(existing.data ?? {}), ...(next.data ?? {}) },
          } as RFEdge;
        }
        return next;
      });
    });
  }, [elk.runVersion, elk.nodes, elk.edges, setNodes, setEdges]);

  // ── Effect 2: DECORATION — runs on hover/selection. Only updates
  // the `data` field on each node/edge; never touches position,
  // identity, or React Flow's internal handle map. This is what
  // prevents the previous flicker + `error#015` (drag of an
  // un-initialised node) — the React Flow store keeps the same node
  // refs across hovers.
  // ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.type === 'erTable') {
          const tableId = n.id;
          const activeCols = highlight.state.activeColumnIdsByTable.get(tableId);
          const isHl = highlight.state.highlightedTableIds.has(tableId);
          const isDimmed = highlight.state.hasActive && !isHl;
          const next = {
            ...(n.data ?? {}),
            selected:
              tableId === selectedTableId ||
              tableId === highlight.state.activeTableId,
            dimmed: isDimmed,
            activeRelationColumns: activeCols ? Array.from(activeCols) : [],
            onEditTable: callbackRefs.current.onEditTable,
            onDeleteTable: callbackRefs.current.onDeleteTable,
          };
          return { ...n, data: next };
        }
        if (n.type === 'erView') {
          const next = {
            ...(n.data ?? {}),
            onEditView: callbackRefs.current.onEditView,
          };
          return { ...n, data: next };
        }
        return n;
      }),
    );

    setEdges((prev) =>
      prev.map((e) => {
        if (e.type !== 'crowsFootER') return e;
        const isHl = highlight.state.highlightedEdgeIds.has(e.id);
        const isDimmed = highlight.state.hasActive && !isHl;
        return {
          ...e,
          data: {
            ...(e.data ?? {}),
            highlighted: isHl,
            dimmed: isDimmed,
          },
        };
      }),
    );
  }, [highlight.state, selectedTableId, setNodes, setEdges]);

  // ── Event handlers ─────────────────────────────────────────────────
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: RFNode) => {
      if (node.type === 'namespace') return;
      onSelectTable(node.id);
    },
    [onSelectTable],
  );

  const handlePaneClick = useCallback(() => {
    onSelectTable(null);
    highlight.clearHover();
  }, [onSelectTable, highlight]);

  const handleNodeMouseEnter = useCallback(
    (_: React.MouseEvent, node: RFNode) => {
      if (node.type === 'namespace') return;
      highlight.onNodeHover(node.id);
    },
    [highlight],
  );

  const handleNodeMouseLeave = useCallback(() => {
    highlight.onNodeHover(null);
  }, [highlight]);

  const handleEdgeMouseEnter = useCallback(
    (_: React.MouseEvent, edge: RFEdge) => {
      if (edge.type === 'crowsFootER') highlight.onEdgeHover(edge.id);
    },
    [highlight],
  );

  const handleEdgeMouseLeave = useCallback(() => {
    highlight.onEdgeHover(null);
  }, [highlight]);

  // ── Drag — start, persistence, smoothstep takeover ─────────────────
  //
  // dbdiagram.io-style fluid drag: while a node is being dragged, every
  // incident edge has its ELK-baked `data.waypoints` cleared. With an
  // empty waypoints array, `CrowsFootEdge` falls back to React Flow's
  // live `getSmoothStepPath`, which recomputes geometry from the node's
  // current `sourceX/Y` / `targetX/Y` on every frame. The wire follows
  // the cursor at 60 fps with zero per-frame work on our side.
  //
  // After `onNodeDragStop`, the waypoints stay empty — we deliberately
  // do NOT restore the ELK-routed path. Re-routing is reserved for
  // explicit user actions (`Auto arrange` button, or reopening the
  // model), which `runVersion` will signal and Effect 1 will pick up.
  //
  // We also `abort()` any layout that may be in flight when the drag
  // begins. Otherwise a layout that resolves mid-drag would push fresh
  // ELK waypoints into the structural effect and snap the wire back to
  // its old route while the user is still moving the table.
  const handleNodeDragStart = useCallback(
    (_: React.MouseEvent, node: RFNode) => {
      if (node.type === 'namespace') return;
      elk.abort();
      const draggedId = node.id;
      setEdges((prev) => {
        let mutated = false;
        const next = prev.map((e) => {
          if (e.source !== draggedId && e.target !== draggedId) return e;
          const data = (e.data ?? {}) as { waypoints?: unknown };
          // Skip work when the edge is already in smoothstep mode.
          if (Array.isArray(data.waypoints) && data.waypoints.length === 0) return e;
          mutated = true;
          return { ...e, data: { ...e.data, waypoints: [] } };
        });
        return mutated ? next : prev;
      });
    },
    [elk, setEdges],
  );

  const handleNodeDragStop = useCallback(
    (_: React.MouseEvent, node: RFNode) => {
      // Persist tables and views — never the namespace background.
      if (node.type === 'namespace') return;
      const pos: NodePosition = { x: node.position.x, y: node.position.y };
      persistence.persistSinglePosition(node.id, pos);
      // Intentionally NOT restoring waypoints — the wire stays in
      // smoothstep mode until the next ELK run (Auto arrange / reload).
    },
    [persistence],
  );

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

    // Use the table's stable `id` (not `name`). Old relationships
    // could carry names because of legacy code paths; the post-clean
    // codebase only emits ids so the FK is rename-safe out of the
    // box. The column refs already are ids (handles are keyed by id).
    onAddRelationship?.({
      id: uuidv4(),
      sourceTable: srcTable.id,
      sourceColumn: pendingConn.sourceColumn,
      targetTable: tgtTable.id,
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

  // ── Auto arrange ───────────────────────────────────────────────────
  const { fitView } = useReactFlow();

  /**
   * Re-runs ELK with the chosen mode, ignoring the persisted positions
   * so the layout reflows from scratch. The `useEffect` that consumes
   * `elk.nodes` will pick up the new positions and re-render. We then
   * persist the new positions in bulk so they survive a reload.
   */
  const handleAutoArrange = useCallback(
    async (algorithm: LayoutAlgorithm) => {
      setLayoutMode(algorithm);
      await elk.runLayout({ mode: algorithm, ignorePersisted: true });

      // After the engine resolves, `elk.nodes` carries the fresh
      // positions. Persist them so the layout sticks across reloads.
      const positions = new Map<string, NodePosition>();
      // Read straight from the in-memory result; `elk.nodes` is already
      // up-to-date because `runLayout` awaits the engine.
      for (const n of elk.nodes) {
        if (n.type === 'namespace') continue;
        positions.set(n.id, { x: n.position.x, y: n.position.y });
      }
      void persistence.persistAllPositions(positions);

      // Fit view after layout with a small delay for rendering
      setTimeout(() => fitView({ padding: 0.3, maxZoom: 1.2, duration: 400 }), 50);
    },
    [elk, persistence, fitView],
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

      {/* Crow's Foot SVG markers — must be mounted once per canvas
          so `url(#cf-…)` resolves on every CrowsFootEdge. */}
      <CrowsFootMarkers />

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
        onEdgeMouseEnter={handleEdgeMouseEnter}
        onEdgeMouseLeave={handleEdgeMouseLeave}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onEdgesDelete={handleEdgesDelete}
        isValidConnection={isValidConnection}
        connectionMode={'loose' as never}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
        minZoom={0.15}
        maxZoom={2.5}
        deleteKeyCode="Delete"
        defaultEdgeOptions={{ type: 'crowsFootER' }}
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
