import { create } from 'zustand';
import { toast } from 'sonner';
import type { ReactFlowInstance } from '@xyflow/react';
import * as mod from '@/features/modeler/services/modeler.service';
import type { Diagram, Drawing, DrawingType, Folder, Project, SubjectArea } from '@/features/modeler/services/modeler.service';
import * as gov from '@/features/governance/services/governance.service';
import type { CanonicalColumn } from '@/features/governance/services/governance.service';
import { useSessionStore } from '@/store/useSessionStore';

// ── Árbol del Model Explorer ──────────────────────────────────────────
// Nodo recursivo: una carpeta con sus subcarpetas y los canvases que cuelgan
// directamente de ella. Los canvases de `folderId=null` cuelgan de la raíz del
// proyecto (ver `selectModelerTree`).
export interface FolderNode {
  folder: Folder;
  folders: FolderNode[];
  canvases: SubjectArea[];
}
export interface ProjectTree {
  project: Project;
  folders: FolderNode[];   // carpetas de nivel raíz (parentFolderId === null)
  canvases: SubjectArea[]; // canvases sin carpeta (folderId == null)
}

interface ModelerState {
  projects: Project[];
  folders: Folder[];
  subjectAreas: SubjectArea[];
  /**
   * Cache por-proyecto del árbol del explorer (folders + canvases), independiente
   * del proyecto ACTIVO: permite expandir varios proyectos a la vez sin tocar la
   * sesión del canvas. `folders`/`subjectAreas` (legacy) siguen espejando el activo.
   */
  trees: Record<string, { folders: Folder[]; subjectAreas: SubjectArea[] }>;
  /** Canvas cuya apertura está en vuelo (spinner en el explorer). */
  openingSaId: string | null;
  activeProjectId: string | null;
  activeFolderId: string | null;
  activeSaId: string | null;
  diagram: Diagram | null;
  columnTarget: string | null;
  selectedTableId: string | null;
  selectedEdgeId: string | null;
  viewMode: 'logical' | 'physical';
  relPreset: { source: gov.Cardinality; target: gov.Cardinality; identifying: boolean } | null;
  setRelPreset: (p: ModelerState['relPreset']) => void;
  hoverEdgeId: string | null;
  hoverNodeId: string | null;
  setHoverEdge: (id: string | null) => void;
  setHoverNode: (id: string | null) => void;
  /** Instancia de React Flow del canvas activo (la setea ModelerCanvas en onInit). */
  flow: ReactFlowInstance | null;
  setFlow: (rf: ReactFlowInstance | null) => void;
  /** Centra el canvas sobre la tabla (Find a table… del toolbar). No-op si no hay nodo. */
  focusTable: (tableId: string) => void;
  // ── Capa DRAWING (R6d): formas libres detrás de las tablas ──
  drawings: Drawing[];
  /** Crea una forma con tamaño default en el centro del viewport actual. */
  addDrawing: (type: DrawingType) => void;
  updateDrawing: (id: string, patch: Partial<Drawing>) => void;
  deleteDrawing: (id: string) => void;
  /** Persiste el array de drawings (debounced) vía el endpoint del canvas activo. */
  persistDrawings: () => void;
  /**
   * Cambios de la sesión de edición desde el último Save/Publish (checkpoint).
   * Alimenta el guard de salida: navegar a otro módulo o cerrar la pestaña con
   * `dirty` pide confirmación (guardar y salir / salir sin guardar).
   */
  dirty: boolean;
  markDirty: () => void;
  clearDirty: () => void;
  /** Save integral (botón Save / "Guardar y salir"): layout completo + drawings (flush) y limpia `dirty`. */
  saveAll: () => Promise<void>;
  loadProjects: () => Promise<void>;
  selectProject: (pid: string) => Promise<void>;
  selectFolder: (folderId: string | null) => void;
  /** Carga el árbol (folders+canvases) de CUALQUIER proyecto al cache `trees` sin tocar la selección. */
  loadProjectTree: (pid: string) => Promise<void>;
  /**
   * Abre un canvas (de cualquier proyecto cargado). Si pertenece a otro proyecto,
   * ese proyecto pasa a ser el activo. `openingSaId` marca la apertura en vuelo.
   */
  selectSubjectArea: (saId: string, projectId?: string) => Promise<void>;
  // ── Folders / Canvas / Projects (gestión del Model Explorer) ──
  loadFolders: (projectId: string) => Promise<void>;
  createFolder: (projectId: string, parentFolderId: string | null, name: string) => Promise<void>;
  renameFolder: (id: string, name: string, projectId?: string) => Promise<void>;
  deleteFolder: (id: string, projectId?: string) => Promise<void>;
  createCanvas: (projectId: string, folderId: string | null, name: string) => Promise<void>;
  renameCanvas: (id: string, name: string, projectId?: string) => Promise<void>;
  deleteCanvas: (id: string, projectId?: string) => Promise<void>;
  moveCanvas: (id: string, folderId: string | null) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  /** @internal recarga folders+canvases del proyecto y depura la selección. */
  _refreshProject: (projectId: string) => Promise<void>;
  reload: () => Promise<void>;
  saveLayout: (tableId: string, pos: { x: number; y: number }) => Promise<void>;
  /** Persiste la posición de TODOS los nodos del canvas activo (botón Save del toolbar). */
  saveAllLayout: () => Promise<void>;
  autoOrganize: () => Promise<void>;
  createTable: (input: { logicalName: string; physicalName?: string; schema?: string; mode?: 'logical' | 'physical' }) => Promise<void>;
  addColumn: (tableId: string, input: { logicalName: string; mode: 'logical' | 'physical'; parentDomainId?: string; dataType?: string }) => Promise<void>;
  createRelationship: (conn: { source: string; sourceHandle: string; target: string; targetHandle: string }) => Promise<void>;
  updateRelationship: (r: gov.Relationship) => Promise<void>;
  deleteRelationship: (id: string) => Promise<void>;
  addExistingTables: (tableIds: string[]) => Promise<void>;
  createTableFromSources: (input: { logicalName: string; schema?: string; columns: CanonicalColumn[] }) => Promise<void>;
  setColumnTarget: (id: string | null) => void;
  setSelectedTable: (id: string | null) => void;
  setSelectedEdge: (id: string | null) => void;
  removeTableFromArea: (tableId: string) => Promise<void>;
  updateTable: (id: string, fields: { logicalName?: string; physicalName?: string; schema?: string; description?: string; udpValues?: Record<string, string> }) => Promise<void>;
  /** Upsert changeset-aware de una columna (merge sobre la columna actual del diagrama) + reload. */
  updateColumn: (colId: string, fields: Partial<CanonicalColumn>) => Promise<void>;
  /** Reordena columnas de una tabla al nuevo orden de ids: recomputa `ordinal` y persiste cada movida. */
  reorderColumns: (tableId: string, orderedIds: string[]) => Promise<void>;
  deleteColumn: (colId: string) => Promise<void>;
  setViewMode: (m: 'logical' | 'physical') => void;
  createProject: (name: string) => Promise<void>;
  createSubjectArea: (name: string) => Promise<void>;
}

// Tamaño default por tipo de forma al crearla (R6d). El centrado usa el viewport.
const DRAWING_DEFAULT_SIZE: Record<DrawingType, { w: number; h: number }> = {
  rect: { w: 200, h: 120 }, square: { w: 140, h: 140 },
  circle: { w: 140, h: 140 }, ellipse: { w: 200, h: 130 },
  line: { w: 200, h: 2 }, star: { w: 120, h: 120 },
  diamond: { w: 160, h: 120 }, text: { w: 180, h: 40 },
};
const DRAWING_DEFAULT_COLOR = '#2E5BFF';

// Debounce de la persistencia de drawings (PUT del array completo).
let _drawingsTimer: ReturnType<typeof setTimeout> | null = null;
// Secuencia de cargas del diagrama: descarta respuestas fuera de orden (dos
// clicks rápidos en el explorer, reload en vuelo al cambiar de canvas).
let _loadSeq = 0;

export const useModelerStore = create<ModelerState>((set, get) => ({
  projects: [],
  folders: [],
  subjectAreas: [],
  trees: {},
  openingSaId: null,
  activeProjectId: null,
  activeFolderId: null,
  activeSaId: null,
  diagram: null,
  columnTarget: null,
  selectedTableId: null,
  selectedEdgeId: null,
  viewMode: 'physical',
  relPreset: null,
  setRelPreset: (p) => set({ relPreset: p }),
  hoverEdgeId: null,
  hoverNodeId: null,
  setHoverEdge: (id) => set({ hoverEdgeId: id }),
  setHoverNode: (id) => set({ hoverNodeId: id }),
  flow: null,
  setFlow: (rf) => set({ flow: rf }),
  drawings: [],
  addDrawing: (type) => {
    const saId = get().activeSaId; if (!saId) return;
    const rf = get().flow;
    const { w, h } = DRAWING_DEFAULT_SIZE[type];
    // Centro del viewport actual en coordenadas de flujo (cae al origen sin instancia).
    const c = rf
      ? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      : { x: 120, y: 120 };
    const drawing: Drawing = {
      id: crypto.randomUUID(), type,
      x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2),
      w, h, color: DRAWING_DEFAULT_COLOR,
      ...(type === 'text' ? { text: 'Text' } : {}),
    };
    set({ drawings: [...get().drawings, drawing] });
    get().persistDrawings();
  },
  updateDrawing: (id, patch) => {
    set({ drawings: get().drawings.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
    get().persistDrawings();
  },
  deleteDrawing: (id) => {
    set({ drawings: get().drawings.filter((d) => d.id !== id) });
    get().persistDrawings();
  },
  persistDrawings: () => {
    const saId = get().activeSaId; if (!saId) return;
    get().markDirty();
    if (_drawingsTimer) clearTimeout(_drawingsTimer);
    _drawingsTimer = setTimeout(() => {
      _drawingsTimer = null;
      // Canvas capturado al AGENDAR el flush: si el usuario cambió de canvas
      // dentro del debounce, los drawings actuales ya son del canvas nuevo y
      // no deben escribirse con este disparo (selectSubjectArea hace el flush
      // del canvas anterior al cambiar).
      if (get().activeSaId !== saId) return;
      // El guardado es en background (debounce): si falla, avisar — un error
      // silencioso deja al usuario creyendo que sus dibujos persistieron.
      void mod.setSubjectAreaDrawings(saId, get().drawings).catch((e: unknown) => {
        toast.error(e instanceof Error && e.message ? e.message : 'No se pudieron guardar los dibujos');
      });
    }, 500);
  },
  dirty: false,
  markDirty: () => { if (!get().dirty) set({ dirty: true }); },
  clearDirty: () => { if (get().dirty) set({ dirty: false }); },
  saveAll: async () => {
    const saId = get().activeSaId;
    // Capturados JUNTO con saId: si durante el await del layout el usuario
    // cambia de canvas, get().drawings ya sería el canvas NUEVO y el flush
    // los escribiría bajo el saId viejo (pisando sus dibujos persistidos).
    const drawings = get().drawings;
    await get().saveAllLayout();
    // Flush inmediato de drawings (cancela el debounce pendiente).
    if (saId) {
      if (_drawingsTimer) { clearTimeout(_drawingsTimer); _drawingsTimer = null; }
      await mod.setSubjectAreaDrawings(saId, drawings);
    }
    set({ dirty: false });
  },
  focusTable: (tableId) => {
    const rf = get().flow; if (!rf) return;
    const node = rf.getNode(tableId); if (!node) return;
    const w = node.measured?.width ?? node.width ?? 212;
    const h = node.measured?.height ?? node.height ?? 120;
    void rf.setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: 1, duration: 420 });
    // Viewer-lock: en solo-lectura centramos sin abrir el PropertiesPanel.
    if (useSessionStore.getState().openMode === 'readonly') return;
    set({ selectedTableId: tableId, selectedEdgeId: null });
  },
  loadProjects: async () => { set({ projects: await mod.listProjects() }); },
  selectProject: async (pid) => {
    const [folders, subjectAreas] = await Promise.all([mod.listFolders(pid), mod.listSubjectAreas(pid)]);
    set((s) => ({
      activeProjectId: pid, folders, subjectAreas, activeFolderId: null, activeSaId: null,
      diagram: null, selectedTableId: null, drawings: [],
      trees: { ...s.trees, [pid]: { folders, subjectAreas } },
    }));
  },
  selectFolder: (folderId) => set({ activeFolderId: folderId }),
  loadProjectTree: async (pid) => {
    const [folders, subjectAreas] = await Promise.all([mod.listFolders(pid), mod.listSubjectAreas(pid)]);
    set((s) => ({ trees: { ...s.trees, [pid]: { folders, subjectAreas } } }));
  },
  selectSubjectArea: async (saId, projectId) => {
    // Flush inmediato de drawings pendientes del canvas ANTERIOR: el debounce
    // de 500ms perdería el último trazo al cambiar de canvas.
    const prevSa = get().activeSaId;
    if (_drawingsTimer && prevSa) {
      clearTimeout(_drawingsTimer); _drawingsTimer = null;
      void mod.setSubjectAreaDrawings(prevSa, get().drawings).catch(() => {});
    }
    const seq = ++_loadSeq;
    set({ openingSaId: saId });
    try {
      const diagram = await mod.loadDiagram(saId);
      // Descarta respuestas VIEJAS: si mientras cargaba el usuario seleccionó
      // otro canvas (o corrió otro reload), pisar el diagrama con esta
      // respuesta dejaría el canvas mostrando un subject area ajeno.
      if (seq !== _loadSeq) return;
      // Si el canvas es de OTRO proyecto, ése pasa a ser el activo y se espejan
      // los campos legacy (folders/subjectAreas) desde el cache del árbol.
      let crossProject = {};
      const pid = projectId ?? null;
      if (pid && pid !== get().activeProjectId) {
        const tree = get().trees[pid]
          ?? { folders: await mod.listFolders(pid), subjectAreas: await mod.listSubjectAreas(pid) };
        // El fetch del árbol agrega awaits DESPUÉS del primer guard: re-chequear
        // antes del set final — otro select pudo ganar mientras tanto y esta
        // respuesta vieja pisaría su canvas.
        if (seq !== _loadSeq) return;
        crossProject = { activeProjectId: pid, folders: tree.folders, subjectAreas: tree.subjectAreas, activeFolderId: null };
      }
      set({ ...crossProject, activeSaId: saId, diagram, selectedTableId: null, drawings: diagram.subjectArea.drawings ?? [] });
    } finally {
      // Sólo la llamada MÁS RECIENTE limpia el spinner: una vieja descartada
      // no debe apagar el openingSaId de la que sigue en vuelo.
      if (seq === _loadSeq) set({ openingSaId: null });
    }
  },
  // ── Folders / Canvas / Projects (gestión del Model Explorer) ───────────
  loadFolders: async (projectId) => { set({ folders: await mod.listFolders(projectId) }); },
  // Refresca folders+canvases del proyecto activo tras una mutación y deja
  // `activeSaId` inválido en null (su canvas pudo haberse borrado).
  createFolder: async (projectId, parentFolderId, name) => {
    await mod.createFolder(projectId, parentFolderId, name);
    await get()._refreshProject(projectId);
  },
  renameFolder: async (id, name, projectId) => {
    await mod.renameFolder(id, name);
    const pid = projectId ?? get().activeProjectId; if (pid) await get()._refreshProject(pid);
  },
  deleteFolder: async (id, projectId) => {
    await mod.deleteFolder(id);
    const pid = projectId ?? get().activeProjectId; if (pid) await get()._refreshProject(pid);
  },
  createCanvas: async (projectId, folderId, name) => {
    const sa = await mod.createSubjectArea(projectId, name, folderId);
    await get()._refreshProject(projectId);
    await get().selectSubjectArea(sa.id, projectId);
  },
  renameCanvas: async (id, name, projectId) => {
    const pid = projectId ?? get().activeProjectId; if (!pid) return;
    const pool = get().trees[pid]?.subjectAreas ?? get().subjectAreas;
    const sa = pool.find((s) => s.id === id);
    await mod.updateSubjectArea(id, { projectId: pid, name, folderId: sa?.folderId ?? null });
    await get()._refreshProject(pid);
  },
  deleteCanvas: async (id, projectId) => {
    await mod.deleteSubjectArea(id);
    const pid = projectId ?? get().activeProjectId; if (pid) await get()._refreshProject(pid);
  },
  moveCanvas: async (id, folderId) => {
    const pid = get().activeProjectId; if (!pid) return;
    const sa = get().subjectAreas.find((s) => s.id === id); if (!sa) return;
    await mod.updateSubjectArea(id, { projectId: pid, name: sa.name, folderId });
    await get()._refreshProject(pid);
  },
  renameProject: async (id, name) => {
    await mod.renameProject(id, name);
    set({ projects: get().projects.map((p) => (p.id === id ? { ...p, name } : p)) });
  },
  deleteProject: async (id) => {
    await mod.deleteProject(id);
    const wasActive = get().activeProjectId === id;
    const trees = { ...get().trees };
    delete trees[id];
    set({
      projects: get().projects.filter((p) => p.id !== id),
      trees,
      ...(wasActive ? { activeProjectId: null, folders: [], subjectAreas: [], activeFolderId: null, activeSaId: null, diagram: null, selectedTableId: null } : {}),
    });
  },
  // Helper interno: recarga folders+canvases del proyecto al cache `trees` y,
  // si es el proyecto ACTIVO, espeja los campos legacy y depura la selección
  // (el canvas activo pudo haberse borrado).
  _refreshProject: async (projectId) => {
    const [folders, subjectAreas] = await Promise.all([mod.listFolders(projectId), mod.listSubjectAreas(projectId)]);
    const st = get();
    const treesPatch = { trees: { ...st.trees, [projectId]: { folders, subjectAreas } } };
    if (projectId !== st.activeProjectId) { set(treesPatch); return; }
    const activeFolderId = st.activeFolderId && folders.some((f) => f.id === st.activeFolderId) ? st.activeFolderId : null;
    const saStillExists = st.activeSaId != null && subjectAreas.some((s) => s.id === st.activeSaId);
    set({
      ...treesPatch,
      folders, subjectAreas, activeFolderId,
      ...(saStillExists ? {} : { activeSaId: null, diagram: null, selectedTableId: null, drawings: [] }),
    });
  },
  reload: async () => {
    const id = get().activeSaId; if (!id) return;
    const seq = ++_loadSeq;
    const diagram = await mod.loadDiagram(id);
    // Descarta respuestas viejas (cambio de canvas o carga más nueva en vuelo).
    if (seq !== _loadSeq || get().activeSaId !== id) return;
    set({ diagram });
  },
  saveLayout: async (tableId, pos) => {
    const saId = get().activeSaId; if (!saId) return;
    get().markDirty();
    await mod.setSubjectAreaLayout(saId, { [tableId]: pos });
  },
  saveAllLayout: async () => {
    const saId = get().activeSaId; const rf = get().flow;
    if (!saId || !rf) return;
    const layout: Record<string, { x: number; y: number }> = {};
    // Sólo nodos de TABLA: las posiciones de los shapes viven en `drawings`;
    // escribirlas también en `layout` contaminaba el doc de la subject area.
    for (const n of rf.getNodes()) if (n.type === 'table') layout[n.id] = { x: n.position.x, y: n.position.y };
    await mod.setSubjectAreaLayout(saId, layout); // MERGEA en backend (M3a)
  },
  autoOrganize: async () => {
    const dia = get().diagram; const saId = get().activeSaId;
    if (!dia || !saId) return;
    get().markDirty();
    const { elkLayout } = await import('@/features/modeler/lib/elkLayout');
    // Tamaños MEDIDOS de los nodos vivos: ELK con tamaño fijo superponía las
    // tablas altas (30 columnas ≈ 700px).
    const measured = new Map((get().flow?.getNodes() ?? []).map((n) => [n.id, n.measured]));
    const nodes = dia.tables.map((t) => ({
      id: t.id, position: { x: 0, y: 0 }, data: {}, measured: measured.get(t.id),
    })) as never;
    const edges = dia.relationships.map((r) => ({ id: r.id, source: r.sourceTableId, target: r.targetTableId })) as never;
    const pos = await elkLayout(nodes, edges);
    await mod.setSubjectAreaLayout(saId, pos);   // setSubjectAreaLayout MERGEA (M3a)
    await get().reload();
  },
  createTable: async (input: { logicalName: string; physicalName?: string; schema?: string; mode?: 'logical' | 'physical' }) => {
    const saId = get().activeSaId; if (!saId) throw new Error('Elegí una Subject Area');
    get().markDirty();
    const id = crypto.randomUUID();
    // Físico: explícito (New table modal, ya auto-physicalizado scope:'table') →
    // si no, modo legacy ('physical' = tal cual; 'logical'/undefined = derivar).
    const physical = (input.physicalName?.trim())
      || (input.mode === 'physical' ? input.logicalName : (await gov.physicalize(input.logicalName, 'table')).physical);
    const schema = input.schema?.trim() || undefined;
    await gov.createTable({ id, logicalName: input.logicalName, physicalName: physical, schema });
    // referenciar la nueva tabla en la Subject Area
    const sa = await mod.getSubjectArea(saId);
    await mod.setSubjectAreaTables(saId, [...sa.tableIds, id]);
    await get().reload();
  },
  addColumn: async (tableId: string, input: { logicalName: string; mode: 'logical' | 'physical'; parentDomainId?: string; dataType?: string }) => {
    get().markDirty();
    const id = crypto.randomUUID();
    const physical = input.mode === 'logical' ? (await gov.physicalize(input.logicalName)).physical : input.logicalName;
    const domains = await gov.listDomains();
    const dom = domains.find((d) => d.id === input.parentDomainId);
    const override = (input.dataType ?? '').trim();
    const dataType = override || dom?.defaultDataType || '';
    await gov.createColumn({
      id, tableId, logicalName: input.logicalName, physicalName: physical,
      parentDomainId: input.parentDomainId || undefined, dataType, typeOverridden: !!override, ordinal: 0,
    });
    await get().reload();
  },
  createRelationship: async (conn: { source: string; sourceHandle: string; target: string; targetHandle: string }) => {
    get().markDirty();
    const preset = get().relPreset; // {source,target,identifying} o null
    const identifying = preset?.identifying ?? false;
    const sourceCardinality = preset?.source ?? 'one';
    const targetCardinality = preset?.target ?? 'many';
    const srcCol = conn.sourceHandle.replace(/__src$|__tgt$/, '');
    const tgtCol = conn.targetHandle.replace(/__src$|__tgt$/, '');
    await gov.createRelationship({
      sourceTableId: conn.source, sourceColumnId: srcCol,
      targetTableId: conn.target, targetColumnId: tgtCol,
      sourceCardinality, targetCardinality, identifying,
    });
    // Marca la columna hija (target) como FK (y PK si identificadora).
    const child = get().diagram?.columns.find((c) => c.id === tgtCol);
    if (child) await gov.markForeignKey(child, identifying);
    await get().reload();
  },
  updateRelationship: async (r) => { get().markDirty(); await gov.updateRelationship(r); await get().reload(); },
  deleteRelationship: async (id) => {
    get().markDirty();
    const rel = get().diagram?.relationships.find((r) => r.id === id);
    await gov.deleteRelationship(id);
    // Limpieza del flag FK (inverso de markForeignKey en create): si una columna
    // extremo de la relación borrada ya NO participa en NINGUNA relación del pool
    // (global, no sólo las visibles en este canvas), se le quita isForeignKey.
    // Conservador a propósito: si sigue siendo extremo de otra relación (aunque
    // sea en otro canvas), el flag se mantiene. isPrimaryKey nunca se toca.
    if (rel) {
      for (const colId of [rel.targetColumnId, rel.sourceColumnId]) {
        const col = get().diagram?.columns.find((c) => c.id === colId);
        if (!col?.isForeignKey) continue;
        // Slice server-side: sólo las relaciones que tocan la TABLA de la
        // columna (una relación siempre referencia la tabla de sus columnas
        // extremo) — antes se bajaba el pool GLOBAL de relaciones por borrado.
        const near = (await gov.listRelationships(col.tableId)).filter((r) => r.id !== id);
        const stillLinked = near.some((r) => r.sourceColumnId === colId || r.targetColumnId === colId);
        if (!stillLinked) await gov.updateColumn({ ...col, isForeignKey: false });
      }
    }
    await get().reload();
  },
  addExistingTables: async (tableIds: string[]) => {
    const saId = get().activeSaId; if (!saId || tableIds.length === 0) return;
    get().markDirty();
    const sa = await mod.getSubjectArea(saId);
    const merged = Array.from(new Set([...sa.tableIds, ...tableIds]));
    await mod.setSubjectAreaTables(saId, merged);
    await get().reload();
  },
  createTableFromSources: async ({ logicalName, schema, columns }) => {
    const saId = get().activeSaId; if (!saId) throw new Error('Elegí una Subject Area');
    get().markDirty();
    const id = crypto.randomUUID();
    const physical = (await gov.physicalize(logicalName, 'table')).physical;
    await gov.createTable({ id, logicalName, physicalName: physical, schema: schema?.trim() || undefined });
    let ordinal = 0;
    for (const c of columns) {
      await gov.createColumn({
        id: crypto.randomUUID(), tableId: id,
        logicalName: c.logicalName, physicalName: c.physicalName,
        parentDomainId: c.parentDomainId, dataType: c.dataType, typeOverridden: c.typeOverridden,
        isPrimaryKey: c.isPrimaryKey, ordinal: ordinal++,
      });
    }
    const sa = await mod.getSubjectArea(saId);
    await mod.setSubjectAreaTables(saId, [...sa.tableIds, id]);
    await get().reload();
  },
  setColumnTarget: (id: string | null) => set({ columnTarget: id }),
  setSelectedTable: (id) => set({ selectedTableId: id, selectedEdgeId: null }),
  setSelectedEdge: (id) => set({ selectedEdgeId: id, selectedTableId: null }),
  removeTableFromArea: async (tableId) => {
    get().markDirty();
    const saId = get().activeSaId; if (!saId) return;
    const sa = await mod.getSubjectArea(saId);
    await mod.setSubjectAreaTables(saId, sa.tableIds.filter((t) => t !== tableId));
    await get().reload();
  },
  updateTable: async (id, fields) => {
    get().markDirty();
    const t = get().diagram?.tables.find((x) => x.id === id);
    if (!t) return;
    await gov.createTable({ ...t, ...fields }); // upsert por id = update
    await get().reload();
  },
  updateColumn: async (colId, fields) => {
    const c = get().diagram?.columns.find((x) => x.id === colId);
    if (!c) return;
    get().markDirty();
    await gov.updateColumn({ ...c, ...fields }); // upsert por id = update (merge)
    await get().reload();
  },
  reorderColumns: async (tableId, orderedIds) => {
    get().markDirty();
    const dia = get().diagram; if (!dia) return;
    const byId = new Map(dia.columns.filter((c) => c.tableId === tableId).map((c) => [c.id, c]));
    // OPTIMISTA: la UI reordena al soltar (ordinal = índice nuevo, local); la
    // persistencia corre detrás y el reload final reconcilia con el overlay.
    set({
      diagram: {
        ...dia,
        columns: dia.columns.map((c) => {
          const idx = orderedIds.indexOf(c.id);
          return idx >= 0 && c.ordinal !== idx ? { ...c, ordinal: idx } : c;
        }),
      },
    });
    // Persistí SOLO las columnas cuyo ordinal cambió, en TANDAS de 5: mover una
    // columna al tope de una tabla de 30 disparaba 30 PUT simultáneos (ráfaga
    // que con varios usuarios satura backend/Cosmos). El backend graba cada
    // cambio con $set atómico por entidad, así que no se pisan entre sí.
    const changed = orderedIds
      .map((id, ordinal) => ({ c: byId.get(id), ordinal }))
      .filter((x): x is { c: CanonicalColumn; ordinal: number } => !!x.c && x.c.ordinal !== x.ordinal);
    for (let i = 0; i < changed.length; i += 5) {
      await Promise.all(changed.slice(i, i + 5).map(({ c, ordinal }) => gov.updateColumn({ ...c, ordinal })));
    }
    await get().reload();
  },
  deleteColumn: async (colId) => { get().markDirty(); await gov.deleteColumn(colId); await get().reload(); },
  setViewMode: (m: 'logical' | 'physical') => set({ viewMode: m }),
  createProject: async (name: string) => {
    const p = await mod.createProject(name);
    set({ projects: [...get().projects, p] });
    await get().selectProject(p.id);
  },
  createSubjectArea: async (name: string) => {
    const pid = get().activeProjectId;
    if (!pid) throw new Error('Elegí un Project primero');
    const sa = await mod.createSubjectArea(pid, name);
    await get()._refreshProject(pid);
    await get().selectSubjectArea(sa.id);
  },
}));

/**
 * Arma el árbol del Model Explorer del proyecto activo a partir del estado plano
 * `folders`/`subjectAreas`: project → carpetas anidadas (por `parentFolderId`) →
 * canvases (por `folderId`; los de `folderId == null` cuelgan de la raíz). Las
 * carpetas y los canvases se ordenan por `order`/nombre para un render estable.
 */
export function buildProjectTree(project: Project, folders: Folder[], canvases: SubjectArea[]): ProjectTree {
  const byParent = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const key = f.parentFolderId ?? null;
    (byParent.get(key) ?? byParent.set(key, []).get(key)!).push(f);
  }
  const byFolder = new Map<string | null, SubjectArea[]>();
  for (const c of canvases) {
    const key = c.folderId ?? null;
    (byFolder.get(key) ?? byFolder.set(key, []).get(key)!).push(c);
  }
  const sortF = (a: Folder, b: Folder) => a.order - b.order || a.name.localeCompare(b.name);
  const sortC = (a: SubjectArea, b: SubjectArea) => a.name.localeCompare(b.name);
  const build = (parentId: string | null): FolderNode[] =>
    [...(byParent.get(parentId) ?? [])].sort(sortF).map((folder) => ({
      folder,
      folders: build(folder.id),
      canvases: [...(byFolder.get(folder.id) ?? [])].sort(sortC),
    }));
  return {
    project,
    folders: build(null),
    canvases: [...(byFolder.get(null) ?? [])].sort(sortC),
  };
}

/** Selector: árbol del proyecto activo, o null si no hay proyecto seleccionado. */
export function selectActiveTree(s: ModelerState): ProjectTree | null {
  const project = s.projects.find((p) => p.id === s.activeProjectId);
  if (!project) return null;
  return buildProjectTree(project, s.folders, s.subjectAreas);
}

// re-export para los componentes
export { gov };
