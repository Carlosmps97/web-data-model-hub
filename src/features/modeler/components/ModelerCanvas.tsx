import { useCallback, useEffect, useRef, useState } from 'react';
import { facetNouns } from '@/lib/facets';
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap, ConnectionMode,
  useNodesState, useEdgesState, type Node, type Edge, type Connection,
} from '@xyflow/react';
import { useModelerStore } from '@/store/useModelerStore';
import { useSessionStore } from '@/store/useSessionStore';
import TableNode from './TableNode';
import ShapeNode from './ShapeNode';
import ViewNode from './ViewNode';
import SubtypeSymbolNode from './SubtypeSymbolNode';
import CrowFootEdge from './CrowFootEdge';
import DerivationEdge from './DerivationEdge';
import SubtypeEdge from './SubtypeEdge';
import CrowFootMarkers from './CrowFootMarkers';
import RelationshipPopup from './RelationshipPopup';
import RelationshipCreatePopup, { type RelDraft } from './RelationshipCreatePopup';
import SubcategoryCreatePopup, { type SubcatDraft } from './SubcategoryCreatePopup';
import SubcategoryPopup from './SubcategoryPopup';
import ColumnContextMenu, { copiedMessage, copiedTableMessage } from './ColumnContextMenu';
import { useUndoStore } from '@/store/useUndoStore';
import PasteColumnsPopup from './PasteColumnsPopup';
import ViewEditor from './ViewEditor';
import { buildViewGraph } from '../lib/viewGraph';
import { buildSubtypeGraph, childSubtypeMembership, isSubcategory, subtypeGroups } from '../lib/subtypeGraph';
import { nextLod } from '../lib/lodSize';
import { pkInKeyOrder } from '../lib/keyOrder';
import { relationshipDrift } from '../lib/relationshipPairs';
import { fanSlots, HEADER_H, ROW_H } from '../lib/edgeFanout';
import { effectiveLayout } from '../lib/viewerLayout';

const nodeTypes = { table: TableNode, shape: ShapeNode, view: ViewNode, subcat: SubtypeSymbolNode };
const edgeTypes = { crowfoot: CrowFootEdge, derivation: DerivationEdge, subcat: SubtypeEdge };

export default function ModelerCanvas({ pushToast }: { pushToast: (m: string, k?: 'err') => void }) {
  const diagram = useModelerStore((s) => s.diagram);
  const drawings = useModelerStore((s) => s.drawings);
  const updateDrawing = useModelerStore((s) => s.updateDrawing);
  const saveLayout = useModelerStore((s) => s.saveLayout);
  // Doc 84 E: layout efímero del visor (mover/arreglar sin persistir).
  const setViewerPos = useModelerStore((s) => s.setViewerPos);
  const markViewerHint = useModelerStore((s) => s.markViewerHint);
  const setSelectedTable = useModelerStore((s) => s.setSelectedTable);
  const setSelectedEdge = useModelerStore((s) => s.setSelectedEdge);
  const setHoverEdge = useModelerStore((s) => s.setHoverEdge);
  const setHoverNode = useModelerStore((s) => s.setHoverNode);
  const setFlow = useModelerStore((s) => s.setFlow);
  const reload = useModelerStore((s) => s.reload);
  const selectedTableId = useModelerStore((s) => s.selectedTableId);
  const pasteTarget = useModelerStore((s) => s.pasteTarget);
  const setPasteTarget = useModelerStore((s) => s.setPasteTarget);
  const focusTable = useModelerStore((s) => s.focusTable);
  const pendingFocusTableId = useModelerStore((s) => s.pendingFocusTableId);
  const setPendingFocus = useModelerStore((s) => s.setPendingFocus);
  const activeChangeset = useSessionStore((s) => s.activeChangesetId);
  // Viewer-lock: en read-only se puede VER (click abre PropertiesPanel en modo
  // reader) pero no mutar: sin drag de nodos y sin conexiones; las escrituras
  // del panel ya están gateadas por el changeset activo (canEdit).
  const readonly = useSessionStore((s) => s.openMode === 'readonly');
  // Estado interno de React Flow: con `onNodesChange` los nodos son arrastrables.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [editRelId, setEditRelId] = useState<string | null>(null);
  // Borrador de relación en confirmación (doc 47): drop hecho, popup abierto,
  // NADA persistido — el edge fantasma `ghostId` vive mientras se decide.
  const [relDraft, setRelDraft] = useState<RelDraft | null>(null);
  // Doc 53: borrador de SUBCATEGORÍA en confirmación (mismo patrón fantasma) y
  // símbolo cuyo popup de gestión está abierto (doble click).
  const [subcatDraft, setSubcatDraft] = useState<SubcatDraft | null>(null);
  const [subcatManage, setSubcatManage] = useState<string | null>(null);
  // Doc 53: las subcategorías existen SOLO en el modelo lógico — en físico ni
  // el símbolo ni sus aristas se construyen (el efecto de abajo depende de esto).
  const viewMode = useModelerStore((s) => s.viewMode);
  // Vista en edición desde el lápiz del ViewNode (F3). El editor vive acá y no
  // en el PropertiesPanel: el click en un nodo view NO abre el panel.
  const [editViewId, setEditViewId] = useState<string | null>(null);
  // Callback ESTABLE para el data de los nodos view (evita rearmar el grafo).
  const onEditView = useCallback((id: string) => setEditViewId(id), []);

  // Sincroniza el diagrama (store) → nodos/aristas de React Flow.
  useEffect(() => {
    if (!diagram) { setNodes([]); setEdges([]); return; }
    const colsByTable = new Map<string, typeof diagram.columns>();
    diagram.columns.forEach((c) => { const a = colsByTable.get(c.tableId) ?? []; a.push(c); colsByTable.set(c.tableId, a); });
    // Doc 84 E: en modo visor, lo movido/arreglado en ESTA sesión pisa el layout
    // publicado (viewerLayout, por canvas); en edición manda el persistido.
    const layout = effectiveLayout(
      diagram.subjectArea.layout,
      readonly ? useModelerStore.getState().viewerLayout[diagram.subjectArea.id] : undefined,
    );
    // LOD (doc 33): columnas ancladas por wires (par 0 de cada relación) por
    // tabla — el nodo compacto les deja handles fantasma con el MISMO id que
    // la fila detallada, así los edges no se re-arman al cruzar el umbral.
    const lodNow = useModelerStore.getState().lod;
    const refColsByTable = new Map<string, string[]>();
    const addRef = (tid: string, cid: string | null | undefined) => {
      if (!cid) return;
      const arr = refColsByTable.get(tid);
      if (arr) arr.push(cid);
      else refColsByTable.set(tid, [cid]);
    };
    for (const r of diagram.relationships) {
      const p0 = r.pairs[0];
      if (!p0) continue;
      // Doc 47: el ancla del PADRE es __hdr_src (existe también en LOD) — sólo
      // el lado HIJO necesita handle fantasma por columna en modo compacto.
      addRef(r.childTableId, p0.childColumnId);
    }
    // zIndex inicial desde la selección actual (getState evita re-armar el
    // diagrama en cada click; los cambios de selección los aplica el efecto de
    // abajo). El seleccionado sube al frente para no quedar oculto.
    const selNow = useModelerStore.getState().selectedTableId;
    const tableNodes: Node[] = diagram.tables.map((t, i) => ({
      id: t.id,
      type: 'table',
      position: layout[t.id] ?? { x: 60 + (i % 4) * 260, y: 60 + Math.floor(i / 4) * 220 },
      zIndex: t.id === selNow ? 10 : 0,
      data: { table: t, columns: colsByTable.get(t.id) ?? [], lod: lodNow, refCols: refColsByTable.get(t.id) ?? [] },
    }));
    // F3: nodos 'view' + edges 'derivation' desde diagram.views (solo vistas
    // showOnCanvas con ≥1 fuente en el canvas — ya filtradas por el backend).
    // Posición: layout[viewId] o default junto a su primera fuente presente.
    const tablePos = new Map(tableNodes.map((n) => [n.id, n.position]));
    // Doc 63: vistas SOLO en modelo físico — en lógico ni bloques ni wires
    // de derivación (el toggle re-arma el diagrama: viewMode está en deps).
    const views = buildViewGraph(viewMode === 'physical' ? diagram.views ?? [] : [], diagram.tables, diagram.columns, layout, tablePos, onEditView);
    const viewNodes = views.nodes.map((n) => ({ ...n, data: { ...n.data, lod: lodNow } }));
    // Doc 53: las SUBCATEGORÍAS van por su propio subgrafo (símbolo + aristas
    // sólidas sin crow's-foot) y SOLO en modelo lógico; el resto de relaciones
    // sigue el camino crowfoot de siempre.
    const stdRels = diagram.relationships.filter((r) => !isSubcategory(r));
    const subRels = viewMode === 'logical' ? diagram.relationships.filter(isSubcategory) : [];
    // Fan-out (doc 47): slot/count por relación agrupando por PADRE, orden por
    // posición del hijo (menos cruces). Drift: pares vs llave efectiva del padre.
    const pkIdsByTable = new Map<string, Set<string>>();
    diagram.columns.forEach((c) => {
      if (!c.isPrimaryKey) return;
      const s = pkIdsByTable.get(c.tableId);
      if (s) s.add(c.id); else pkIdsByTable.set(c.tableId, new Set([c.id]));
    });
    const sub = buildSubtypeGraph(
      subRels, layout, tablePos,
      (tid) => ({ w: 230, h: HEADER_H + Math.max(1, colsByTable.get(tid)?.length ?? 1) * ROW_H }),
      (r) => relationshipDrift(r, [...(pkIdsByTable.get(r.parentTableId) ?? new Set<string>())]) != null,
    );
    // Preserva los nodos de shapes ya presentes (los repuebla el efecto de drawings).
    setNodes((prev) => [...prev.filter((n) => n.type === 'shape'), ...tableNodes, ...viewNodes, ...sub.nodes]);
    const slots = fanSlots(stdRels.map((r) => {
      const tp = tablePos.get(r.childTableId) ?? { x: 0, y: 0 };
      return { id: r.id, parentId: r.parentTableId, targetY: tp.y, targetX: tp.x };
    }));
    setEdges([
      // v2 (doc 19) + doc 47: el edge SIEMPRE va padre → hijo; SALE de la
      // cabecera del padre (fan-out en la zona de llave) y ENTRA por la
      // columna del PRIMER par (orden de llave). Los pares viven en el popup.
      ...stdRels.map((r) => {
        const fan = slots.get(r.id);
        const pkIds = pkIdsByTable.get(r.parentTableId) ?? new Set<string>();
        return {
          id: r.id, source: r.parentTableId, target: r.childTableId,
          sourceHandle: '__hdr_src',
          targetHandle: `${r.pairs[0]?.childColumnId}__tgt`,
          type: 'crowfoot',
          data: {
            parentCardinality: r.parentCardinality, childCardinality: r.childCardinality,
            identifying: r.identifying, pairCount: r.pairs.length,
            fanSlot: fan?.slot ?? 0, fanCount: fan?.count ?? 1, parentPkRows: pkIds.size,
            drifted: relationshipDrift(r, [...pkIds]) != null,
          },
        };
      }),
      ...views.edges,
      ...sub.edges,
    ]);
  }, [diagram, viewMode, readonly, setNodes, setEdges, onEditView]);

  // LOD (doc 33): al cruzar el umbral de zoom se parchea SOLO data.lod de los
  // nodos (posiciones y edges intactos — los handles fantasma del modo
  // compacto usan los mismos ids que las filas, así que las anclas de los
  // wires existen en ambos modos y el cambio es atómico en un commit).
  const lod = useModelerStore((s) => s.lod);
  useEffect(() => {
    // Los shapes y el símbolo de subcategoría (doc 53) quedan FUERA del LOD:
    // son chicos y de tamaño fijo — no tienen filas que colapsar.
    setNodes((prev) => prev.map((n) =>
      n.type === 'shape' || n.type === 'subcat' || (n.data as { lod?: boolean }).lod === lod
        ? n
        : { ...n, data: { ...n.data, lod } }));
  }, [lod, setNodes]);

  // Histéresis del umbral en onMove: entra compacto bajo LOD_ENTER, vuelve a
  // detalle sobre LOD_EXIT; setLod solo escribe al CRUZAR (cero renders en el
  // pan normal). lodLock lo congela durante el export SVG (detalle completo).
  const onMove = useCallback((_e: unknown, viewport: { zoom: number }) => {
    const st = useModelerStore.getState();
    if (st.lodLock) return;
    st.setLod(nextLod(st.lod, viewport.zoom));
  }, []);

  // El nodo seleccionado (incl. una tabla recién creada/importada) sube al
  // frente: React Flow pinta por orden de array ⇒ una tabla nueva podía quedar
  // DETRÁS de un bloque existente. Update liviano (sólo zIndex), sin re-armar.
  useEffect(() => {
    setNodes((prev) => prev.map((n) => {
      if (n.type === 'shape') return n;               // shapes siempre atrás (zIndex -1)
      const z = n.id === selectedTableId ? 10 : 0;
      return n.zIndex === z ? n : { ...n, zIndex: z };
    }));
  }, [selectedTableId, setNodes]);

  // Finder cross-canvas (Database Explorer): tras abrir el canvas destino,
  // centra sobre la tabla PENDIENTE en cuanto su nodo monta. selectSubjectArea
  // resuelve ANTES de que React monte los nodos ⇒ poll por rAF hasta que exista
  // (o se rinde). focusTable, además, tiene su propio doble-rAF de medición.
  useEffect(() => {
    const id = pendingFocusTableId;
    if (!id) return;
    let tries = 0;
    let handle = 0;
    const tryFocus = () => {
      const rf = useModelerStore.getState().flow;
      if (rf?.getNode(id)) {
        // Doc 70 §11: un hit de COLUMNA del buscador centra la tabla y abre la columna.
        const colId = useModelerStore.getState().pendingFocusColId;
        if (colId) useModelerStore.getState().focusColumn(id, colId); else focusTable(id);
        setPendingFocus(null);
        return;
      }
      if (tries++ < 40) handle = requestAnimationFrame(tryFocus);   // ~0.6s techo
      else setPendingFocus(null);
    };
    handle = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(handle);
  }, [pendingFocusTableId, diagram, focusTable, setPendingFocus]);

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
          draggable: !readonly,
          width: d.w,
          height: d.h,
          zIndex: -1,
          data: { drawing: d },
        };
      });
      // Shapes primero ⇒ se pintan detrás de las tablas (refuerza el zIndex).
      return [...shapeNodes, ...others];
    });
  }, [drawings, setNodes, readonly]);

  // Atajos del canvas (docs 48 + 50), agnósticos al SO (`metaKey || ctrlKey` =
  // ⌘ en macOS, Ctrl en Windows/Linux): Ctrl/Cmd+C copia la selección de
  // filas — o el BLOQUE seleccionado si no hay filas —, Ctrl/Cmd+V pega
  // (clipboard de tabla → tabla nueva; de columnas → confirmación sobre la
  // tabla seleccionada), Ctrl/Cmd+Z deshace la última acción y Esc limpia
  // menú/selección. Guardas: cualquier modal abierto (.dmh-backdrop), foco en
  // un campo editable (ahí mandan el copy/undo NATIVOS del input), o texto
  // seleccionado en la página (ahí manda el Ctrl+C nativo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.dmh-backdrop')) return;
      const st = useModelerStore.getState();
      if (e.key === 'Escape') {
        if (st.colMenu) st.closeColMenu();
        else if (st.colSel) st.clearColSel();
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== 'c' && k !== 'v' && k !== 'z') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (k === 'z') {
        // Doc 50: deshacer la última acción instrumentada. Shift+Z (redo) no
        // existe; sin edición o sin pila, el atajo no hace nada.
        if (e.shiftKey || readonly || !activeChangeset) return;
        const undo = useUndoStore.getState();
        if (undo.busy || !undo.stack.length) return;
        e.preventDefault();
        void undo.undoLast()
          .then((label) => { if (label) pushToast(`Undid: ${label}`); })
          .catch((err) => pushToast(err instanceof Error && err.message ? err.message : "Couldn't undo", 'err'));
        return;
      }
      if (k === 'c') {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return;
        const n = st.copySelectedColumns();
        if (n > 0) { pushToast(copiedMessage(n)); return; }
        // Doc 50: sin filas seleccionadas, con un bloque seleccionado el copy
        // toma la TABLA completa (columnas + metadata; sin relaciones).
        if (st.selectedTableId) {
          const name = st.copyTable(st.selectedTableId);
          if (name) pushToast(copiedTableMessage(name));
        }
        return;
      }
      // Doc 50: el clipboard de TABLA tiene prioridad (son excluyentes) y no
      // necesita destino — pega una tabla NUEVA en este canvas.
      if (st.tblClipboard) {
        if (readonly || !activeChangeset) { pushToast('Open the model in edit mode to paste', 'err'); return; }
        void st.pasteTable()
          .then((name) => { if (name) pushToast(`${facetNouns(useModelerStore.getState().viewMode).One} pasted as ${name}`); })
          .catch((err) => pushToast(err instanceof Error && err.message ? err.message : "Couldn't paste the table", 'err'));
        return;
      }
      if (!st.colClipboard?.cols.length) return;
      if (readonly || !activeChangeset) { pushToast('Open the model in edit mode to paste columns', 'err'); return; }
      if (!st.selectedTableId) { pushToast(`Select the target ${facetNouns(st.viewMode).one}, then paste`, 'err'); return; }
      st.setPasteTarget(st.selectedTableId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readonly, activeChangeset, pushToast]);

  // Extremo donde EMPEZÓ el gesto de conexión. React Flow normaliza la conexión
  // (source = siempre el extremo con handle `source`), así que si el usuario
  // arrancó desde un handle `target` (lado izquierdo), la dirección normalizada
  // queda invertida respecto del gesto. Guardamos el inicio para reorientar.
  const connectStart = useRef<{ nodeId: string | null; handleId: string | null } | null>(null);

  const onConnect = useCallback((conn: Connection) => {
    // En modo visor puede haber changeset activo (se está VIENDO un request):
    // nunca habilita mutaciones.
    if (readonly) { pushToast("The model is read-only: relationships can't be created", 'err'); return; }
    // El changeset activo viene del Open model (modo `editing`) vía el bridge
    // session → changeset. Si falta, es read-only o una sesión inconsistente.
    if (!activeChangeset) { pushToast('Open the model in edit mode to create relationships', 'err'); return; }
    if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) return;
    // ── Doc 53: herramienta SUBCATEGORÍA armada — flujo propio ──────────────
    if (useModelerStore.getState().subcatArmed) {
      const st = useModelerStore.getState();
      const dia = st.diagram;
      if (!dia) return;
      const start = connectStart.current;
      const startedAtSource = !start || (conn.source === start.nodeId && conn.sourceHandle === start.handleId);
      const startId = startedAtSource ? conn.source : conn.target;
      const startHandle = startedAtSource ? conn.sourceHandle : conn.targetHandle;
      const childId = startedAtSource ? conn.target : conn.source;
      const endHandle = startedAtSource ? conn.targetHandle : conn.sourceHandle;
      // Drag desde el SÍMBOLO (flujo Erwin "click en el círculo"): agrega otro
      // subtipo al grupo existente; desde la cabecera, supertipo = esa tabla.
      const fromSymbol = startHandle === '__sym_src';
      const symbolId = fromSymbol ? startId : null;
      const group = symbolId ? subtypeGroups(dia.relationships).find((g) => g.symbolId === symbolId) : null;
      if (fromSymbol && !group) return;
      const parentId = fromSymbol ? group!.parentTableId : startId;
      if (!dia.tables.some((t) => t.id === childId)) {
        pushToast('A subtype must be a table on this canvas', 'err');
        return;
      }
      if (parentId === childId) {
        pushToast('A table cannot be a subtype of itself', 'err');
        return;
      }
      const parentTable = dia.tables.find((t) => t.id === parentId);
      // Guard D1 (doc 47): sin llave en el supertipo no hay nada que heredar.
      if (!pkInKeyOrder(dia.columns.filter((c) => c.tableId === parentId)).length) {
        pushToast(`"${parentTable?.physicalName ?? parentId}" has no primary key — define the supertype's key first`, 'err');
        return;
      }
      // Regla Erwin: un subtipo pertenece a UN solo grupo (chequeo local; el
      // popup repite el chequeo GLOBAL draft-aware antes de habilitar Confirm).
      if (childSubtypeMembership(dia.relationships, childId)) {
        const c = dia.tables.find((t) => t.id === childId);
        pushToast(`"${c?.physicalName ?? childId}" is already a subtype in another subcategory group`, 'err');
        return;
      }
      const dropColumnId = endHandle === '__hdr_src' || endHandle === '__sym_tgt'
        ? null : endHandle.replace(/__src$|__tgt$/, '');
      const ghostId = `pending-${crypto.randomUUID()}`;
      setEdges((eds) => [...eds, {
        id: ghostId,
        source: fromSymbol ? (symbolId as string) : parentId,
        target: childId,
        sourceHandle: fromSymbol ? '__sym_src' : '__hdr_src',
        targetHandle: dropColumnId ? `${dropColumnId}__tgt` : '__hdr_src',
        type: 'subcat',
        data: { pending: true },
      }]);
      setSubcatDraft({ parentTableId: parentId, childTableId: childId, dropColumnId, symbolId, ghostId });
      return;
    }
    // Guard defensivo: sin la herramienta "Dibujar relación" armada, los handles
    // no son conectables (TableNode) — si algo llega igual, no crear nada.
    const preset = useModelerStore.getState().relPreset;
    if (!preset) { pushToast('Arm "Draw relationship" in the toolbar to create relationships', 'err'); return; }
    // Doc 47: el gesto SIEMPRE nace en la CABECERA del padre (las columnas ya
    // no inician conexiones); si React Flow normalizó al revés, se reorienta.
    const start = connectStart.current;
    const startedAtSource = !start || (conn.source === start.nodeId && conn.sourceHandle === start.handleId);
    const parentId = startedAtSource ? conn.source : conn.target;
    const childId = startedAtSource ? conn.target : conn.source;
    const dropHandle = startedAtSource ? conn.targetHandle : conn.sourceHandle;

    const st = useModelerStore.getState();
    const cols = st.diagram?.columns ?? [];
    const parentTable = st.diagram?.tables.find((t) => t.id === parentId);
    // Guard doc 47 (D1): sin llave en el padre no hay nada que migrar.
    if (!pkInKeyOrder(cols.filter((c) => c.tableId === parentId)).length) {
      pushToast(`"${parentTable?.physicalName ?? parentId}" has no primary key — define its key before drawing a relationship`, 'err');
      return;
    }
    // Recursivas: solo non-identifying (una llave no puede contenerse a sí misma).
    if (parentId === childId && preset.identifying) {
      pushToast('A table cannot have an identifying relationship with itself', 'err');
      return;
    }
    const dropColumnId = dropHandle === '__hdr_src' ? null : dropHandle.replace(/__src$|__tgt$/, '');
    // Edge FANTASMA mientras el popup confirma (nada persistido aún): sale de
    // la cabecera del padre; si el drop fue en una columna, ancla ahí.
    const ghostId = `pending-${crypto.randomUUID()}`;
    setEdges((eds) => [...eds, {
      id: ghostId, source: parentId, target: childId,
      sourceHandle: '__hdr_src', targetHandle: dropColumnId ? `${dropColumnId}__tgt` : '__hdr_src',
      type: 'crowfoot',
      data: { parentCardinality: preset.parent, childCardinality: preset.child, identifying: preset.identifying, pending: true },
    }]);
    setRelDraft({
      parentTableId: parentId, childTableId: childId, dropColumnId,
      identifying: preset.identifying, parentCardinality: preset.parent, childCardinality: preset.child,
      ghostId,
    });
  }, [readonly, activeChangeset, setEdges, pushToast]);

  // Expone la instancia de React Flow al store (la usa el toolbar: focusTable / Save).
  useEffect(() => () => setFlow(null), [setFlow]);

  // Vista en edición (lápiz del ViewNode) resuelta contra el diagrama vivo.
  const editView = editViewId ? (diagram?.views ?? []).find((v) => v.id === editViewId) : undefined;

  return (
    <div style={{ flex: 1, minHeight: 0 }}>
      <CrowFootMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={(_e, params) => { connectStart.current = { nodeId: params.nodeId, handleId: params.handleId }; }}
        onConnectEnd={() => { connectStart.current = null; }}
        onMove={onMove}
        onInit={(rf) => {
          setFlow(rf);
          // Estado LOD correcto desde el arranque: se evalúa ya y de nuevo tras
          // el fitView inicial (doble rAF) — sin depender de que React Flow
          // emita onMove por el movimiento programático del fit.
          onMove(null, rf.getViewport());
          requestAnimationFrame(() => requestAnimationFrame(() => onMove(null, rf.getViewport())));
        }}
        onNodeClick={(_e, node) => {
          // Doc 48 fix: cualquier click FUERA de una fila suelta la selección
          // de columnas (las filas hacen stopPropagation, así que acá solo
          // llegan cuerpo/cabecera del nodo) — deseleccionar es trivial.
          const st = useModelerStore.getState();
          st.clearColSel(); st.closeColMenu();
          // Nodo VISTA (doc 61): abre su Properties — paridad con tablas.
          // (Antes era selección visual solamente; el lápiz del header sigue
          // abriendo el ViewEditor.)
          if (node.type === 'view') { st.setSelectedView(node.id); return; }
          // Símbolo de subcategoría (doc 53): su gestión es doble click.
          if (node.type === 'subcat') { setSelectedTable(null); return; }
          if (node.type !== 'shape') setSelectedTable(node.id);
        }}
        onNodeDoubleClick={(_e, node) => {
          if (node.type === 'subcat') setSubcatManage(node.id);
        }}
        onEdgeClick={(_e, edge) => setSelectedEdge(edge.id)}
        // El popup de relación es SOLO para wires crowfoot (una derivación no
        // tiene cardinalidades que editar); las aristas de subcategoría abren
        // el popup de gestión de su grupo (doc 53).
        onEdgeDoubleClick={(_e, edge) => {
          if (edge.type === 'crowfoot') setEditRelId(edge.id);
          else if (edge.type === 'subcat') {
            const sid = (edge.data as { symbolId?: string } | undefined)?.symbolId;
            if (sid) setSubcatManage(sid);
          }
        }}
        onPaneClick={() => {
          setSelectedTable(null); setSelectedEdge(null);
          const st = useModelerStore.getState();
          st.clearColSel(); st.closeColMenu();
        }}
        // Docs 48 + 50: menú contextual del BLOQUE — siempre ofrece "Copy
        // table" (copiar es lectura, vale también en readonly) y, si hay
        // clipboard + edición, las entradas de paste. El menú de FILA (copy de
        // columnas) lo abre TableNode con stopPropagation.
        onNodeContextMenu={(e, node) => {
          if (node.type !== 'table') return;
          const st = useModelerStore.getState();
          if (st.relPreset) return;
          e.preventDefault();
          st.openColMenu({ x: e.clientX, y: e.clientY, tableId: node.id, colId: null });
        }}
        onEdgeMouseEnter={(_e, edge) => setHoverEdge(edge.id)}
        onEdgeMouseLeave={() => setHoverEdge(null)}
        onNodeMouseEnter={(_e, node) => setHoverNode(node.id)}
        onNodeMouseLeave={() => setHoverNode(null)}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // Virtualización del viewport: con 100 tablas × ~30 columnas hay ~3.000
        // filas y ~6.000 handles — sólo montan DOM los nodos visibles.
        onlyRenderVisibleElements
        // Loose: una relación puede EMPEZAR y TERMINAR en cualquier lado (cada
        // columna tiene handle a izq. y der.). En Strict sólo source(der)→target(izq),
        // así que "de la izquierda sólo llegaba a la derecha" (pedido owner). El
        // ruteo del edge ya elige el mejor lado por posición (CrowFootEdge), y el
        // onConnect ya orienta padre/hijo por el gesto — nada más cambia.
        connectionMode={ConnectionMode.Loose}
        // Doc 84 E: también en modo visor se pueden mover bloques (y auto-
        // arreglar) para leer mejor el diagrama — sin persistir nunca (ver
        // onNodeDragStop). Los shapes de dibujo siguen fijos en visor.
        nodesDraggable
        // Sin delete por teclado: el default de React Flow (Backspace) borraba
        // tablas/wires SÓLO en pantalla (sin persistir, el reload los restaura)
        // — engañoso en edición y una violación del viewer-lock en readonly.
        // Los borrados reales van por la UI explícita (panel / popup de relación).
        deleteKeyCode={null}
        // Doc 48 fix (prueba viva): con los defaults de React Flow, 1px de
        // movimiento ya es DRAG (nodeDragThreshold 1) y el click del gesto se
        // SUPRIME (clickDistance) — en trackpad "a veces el click no
        // selecciona" la fila. A 4px, el click con jitter sigue siendo click;
        // mover la tabla exige un arrastre real (bonus: mueren los saves de
        // layout por micro-drags accidentales). paneClickDistance hace
        // robusto el click en el fondo (deseleccionar).
        nodeDragThreshold={4}
        paneClickDistance={4}
        // Zoom-out amplio: canvases enormes (auto-arrange de 100 tablas ≈
        // 14000×19000px) necesitan bajar del default minZoom 0.5 para verse
        // completos. fitViewOptions hace que el auto-fit inicial respete ese piso.
        minZoom={0.02}
        fitView
        fitViewOptions={{ padding: 0.12, minZoom: 0.02 }}
        onNodeDragStop={(_e, node) => {
          if (readonly) {
            // Doc 84 E: modo visor — el movimiento vive sólo en esta sesión
            // (viewerLayout); nada viaja al backend. Aviso una vez por sesión.
            if (node.type === 'shape' || !diagram) return;
            setViewerPos(diagram.subjectArea.id, node.id, node.position);
            if (!useModelerStore.getState().viewerHintShown) {
              markViewerHint();
              pushToast('Moves in view mode are not saved. Open the model for editing to keep a layout.');
            }
            return;
          }
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
      {relDraft && (
        <RelationshipCreatePopup
          draft={relDraft}
          onClose={(created) => {
            // Cancel: se quita el fantasma. Confirm: el reload rearma los
            // edges desde el diagrama y el fantasma muere solo.
            if (!created) setEdges((eds) => eds.filter((e) => e.id !== relDraft.ghostId));
            setRelDraft(null);
          }}
          pushToast={pushToast}
        />
      )}
      {subcatDraft && (
        <SubcategoryCreatePopup
          draft={subcatDraft}
          onClose={(created) => {
            if (!created) setEdges((eds) => eds.filter((e) => e.id !== subcatDraft.ghostId));
            setSubcatDraft(null);
          }}
          pushToast={pushToast}
        />
      )}
      {subcatManage && (
        <SubcategoryPopup symbolId={subcatManage} onClose={() => setSubcatManage(null)} pushToast={pushToast} />
      )}
      {editView && <ViewEditor view={editView} onClose={() => setEditViewId(null)} onSaved={() => void reload()} pushToast={pushToast} />}
      <ColumnContextMenu pushToast={pushToast} />
      {pasteTarget && (
        <PasteColumnsPopup targetId={pasteTarget} onClose={() => setPasteTarget(null)} pushToast={pushToast} />
      )}
    </div>
  );
}
