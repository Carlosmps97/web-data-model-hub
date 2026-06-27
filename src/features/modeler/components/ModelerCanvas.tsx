import { useCallback, useEffect, useState } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap,
  useNodesState, useEdgesState, type Node, type Edge, type Connection,
} from '@xyflow/react';
import { useModelerStore } from '@/store/useModelerStore';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useSessionStore } from '@/store/useSessionStore';
import TableNode from './TableNode';
import ShapeNode from './ShapeNode';
import CrowFootEdge from './CrowFootEdge';
import CrowFootMarkers from './CrowFootMarkers';
import RelationshipPopup from './RelationshipPopup';

const nodeTypes = { table: TableNode, shape: ShapeNode };
const edgeTypes = { crowfoot: CrowFootEdge };

export default function ModelerCanvas({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  const diagram = useModelerStore((s) => s.diagram);
  const drawings = useModelerStore((s) => s.drawings);
  const updateDrawing = useModelerStore((s) => s.updateDrawing);
  const saveLayout = useModelerStore((s) => s.saveLayout);
  const createRelationship = useModelerStore((s) => s.createRelationship);
  const setSelectedTable = useModelerStore((s) => s.setSelectedTable);
  const setSelectedEdge = useModelerStore((s) => s.setSelectedEdge);
  const setHoverEdge = useModelerStore((s) => s.setHoverEdge);
  const setHoverNode = useModelerStore((s) => s.setHoverNode);
  const setFlow = useModelerStore((s) => s.setFlow);
  const activeChangeset = useChangesetStore((s) => s.activeId);
  // Viewer-lock: en modo solo-lectura, clicar una tabla NO abre el PropertiesPanel.
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  // Estado interno de React Flow: con `onNodesChange` los nodos son arrastrables.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [editRelId, setEditRelId] = useState<string | null>(null);

  // Sincroniza el diagrama (store) → nodos/aristas de React Flow.
  useEffect(() => {
    if (!diagram) { setNodes([]); setEdges([]); return; }
    const colsByTable = new Map<string, typeof diagram.columns>();
    diagram.columns.forEach((c) => { const a = colsByTable.get(c.tableId) ?? []; a.push(c); colsByTable.set(c.tableId, a); });
    const layout = diagram.subjectArea.layout || {};
    const tableNodes: Node[] = diagram.tables.map((t, i) => ({
      id: t.id,
      type: 'table',
      position: layout[t.id] ?? { x: 60 + (i % 4) * 260, y: 60 + Math.floor(i / 4) * 220 },
      data: { table: t, columns: colsByTable.get(t.id) ?? [] },
    }));
    // Preserva los nodos de shapes ya presentes (los repuebla el efecto de drawings).
    setNodes((prev) => [...prev.filter((n) => n.type === 'shape'), ...tableNodes]);
    setEdges(diagram.relationships.map((r) => ({
      id: r.id, source: r.sourceTableId, target: r.targetTableId,
      sourceHandle: `${r.sourceColumnId}__src`, targetHandle: `${r.targetColumnId}__tgt`,
      type: 'crowfoot',
      data: { sourceCardinality: r.sourceCardinality, targetCardinality: r.targetCardinality, identifying: r.identifying },
    })));
  }, [diagram, setNodes, setEdges]);

  // Sincroniza la capa DRAWING (store) → nodos 'shape', detrás de las tablas (zIndex < 0).
  // Mantiene la posición que React Flow ya tenga del nodo (drag en curso) y sólo
  // refresca `data`/tamaño desde el store.
  useEffect(() => {
    setNodes((prev) => {
      const others = prev.filter((n) => n.type !== 'shape');
      const byId = new Map(prev.map((n) => [n.id, n]));
      const shapeNodes: Node[] = drawings.map((d) => {
        const existing = byId.get(d.id);
        return {
          id: d.id,
          type: 'shape',
          position: existing?.position ?? { x: d.x, y: d.y },
          width: d.w,
          height: d.h,
          zIndex: -1,
          data: { drawing: d },
        };
      });
      // Shapes primero ⇒ se pintan detrás de las tablas (refuerza el zIndex).
      return [...shapeNodes, ...others];
    });
  }, [drawings, setNodes]);

  const onConnect = useCallback((conn: Connection) => {
    // El changeset activo viene del Open model (modo `editing`) vía el bridge
    // session → changeset. Si falta, es read-only o una sesión inconsistente.
    if (!activeChangeset) { pushToast('Abrí el modelo en modo edición para crear relaciones', 'err'); return; }
    if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) return;
    void createRelationship({ source: conn.source, sourceHandle: conn.sourceHandle, target: conn.target, targetHandle: conn.targetHandle })
      .catch(() => pushToast('No se pudo crear la relación', 'err'));
  }, [activeChangeset, createRelationship, pushToast]);

  // Expone la instancia de React Flow al store (la usa el toolbar: focusTable / Save).
  useEffect(() => () => setFlow(null), [setFlow]);

  return (
    <div style={{ flex: 1, minHeight: 0 }}>
      <CrowFootMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={setFlow}
        onNodeClick={(_e, node) => { if (!readonly && node.type !== 'shape') setSelectedTable(node.id); }}
        onEdgeClick={(_e, edge) => setSelectedEdge(edge.id)}
        onEdgeDoubleClick={(_e, edge) => setEditRelId(edge.id)}
        onPaneClick={() => { setSelectedTable(null); setSelectedEdge(null); }}
        onEdgeMouseEnter={(_e, edge) => setHoverEdge(edge.id)}
        onEdgeMouseLeave={() => setHoverEdge(null)}
        onNodeMouseEnter={(_e, node) => setHoverNode(node.id)}
        onNodeMouseLeave={() => setHoverNode(null)}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        onNodeDragStop={(_e, node) => {
          if (readonly) return; // viewer-lock: no persistir movimientos
          if (node.type === 'shape') updateDrawing(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) });
          else void saveLayout(node.id, node.position);
        }}
      >
        {/* Dotted grid (Screen 04): #FBFCFD surface + #D6DBE6 dots, 22px gap. */}
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="#D6DBE6" bgColor="#FBFCFD" />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
      {editRelId && <RelationshipPopup relId={editRelId} onClose={() => setEditRelId(null)} pushToast={pushToast} />}
    </div>
  );
}
