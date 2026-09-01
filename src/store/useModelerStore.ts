import { create } from 'zustand';
import { toast } from 'sonner';
import type { ReactFlowInstance } from '@xyflow/react';
import * as mod from '@/features/modeler/services/modeler.service';
// Estructura (projects/folders/canvases) changeset-aware (doc 16): en sesión
// de edición registra al changeset; con changeset activo lee estado efectivo.
import * as struct from '@/features/modeler/services/structure.service';
import * as schemasSvc from '@/features/modeler/services/schemas.service';
import type { DbSchema } from '@/features/modeler/services/schemas.service';
import type { Diagram, Drawing, DrawingType, Folder, Project, SubjectArea } from '@/features/modeler/services/modeler.service';
import * as gov from '@/features/governance/services/governance.service';
import type { CanonicalColumn, CanonicalTable } from '@/features/governance/services/governance.service';
import { copyNameBase, copyTableToBulk, nextCopyNames } from '@/features/modeler/lib/copyTable';
import { nextPkPosition, pkInKeyOrder } from '@/features/modeler/lib/keyOrder';
import { canonicalDefaultType } from '@/features/modeler/lib/typePick';
import {
  removeColumnSource, syncNewColumnToMirrorViews, syncRemovedColumnFromViews, syncRenamedColumnInViews,
} from '@/features/modeler/lib/viewSync';
import * as viewsSvc from '@/services/views.service';
import type { View } from '@/services/views.service';
import { useSessionStore } from '@/store/useSessionStore';
import { useChangesetStore } from '@/store/useChangesetStore';
import { pushUndo, useUndoStore } from '@/store/useUndoStore';

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

/** Alta de columna (popup "New column", doc 40): además del nombre/dominio/
 *  tipo, el popup captura la metadata completa — definición funcional, flags
 *  y UDPs — para no obligar a pasar por Properties · Columns tras crear. */
export interface AddColumnInput {
  logicalName: string;
  mode: 'logical' | 'physical';
  parentDomainId?: string;
  dataType?: string;
  description?: string;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  isNullable?: boolean;
  isPartition?: boolean;
  udpValues?: Record<string, string>;
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
  /** Esquemas EFECTIVOS de la versión activa (doc 18): alimenta los dropdowns
   *  de esquema y el SchemaManager. Se recarga con el contexto (refreshExplorer)
   *  y tras cada mutación de esquemas. */
  schemas: DbSchema[];
  loadSchemas: () => Promise<void>;
  activeProjectId: string | null;
  activeFolderId: string | null;
  activeSaId: string | null;
  diagram: Diagram | null;
  columnTarget: string | null;
  selectedTableId: string | null;
  selectedEdgeId: string | null;
  viewMode: 'logical' | 'physical';
  relPreset: { parent: gov.Cardinality; child: gov.Cardinality; identifying: boolean } | null;
  setRelPreset: (p: ModelerState['relPreset']) => void;
  /** Herramienta SUBCATEGORÍA armada (doc 53): drag desde la cabecera del
   *  supertipo (o desde un símbolo existente) hacia el subtipo. Exclusión
   *  mutua con `relPreset`; SOLO tiene sentido en modelo lógico — pasar a
   *  físico la desarma (setViewMode). */
  subcatArmed: boolean;
  setSubcatArmed: (on: boolean) => void;
  hoverEdgeId: string | null;
  hoverNodeId: string | null;
  setHoverEdge: (id: string | null) => void;
  setHoverNode: (id: string | null) => void;
  // ── Copy/paste de columnas entre bloques (doc 48) ──────────────────────
  /** Selección de filas en el bloque del canvas: UNA tabla fuente a la vez.
   *  `anchor` = última fila clickeada (extremo fijo del rango con Shift). */
  colSel: { tableId: string; ids: string[]; anchor: string } | null;
  toggleColSelect: (tableId: string, colId: string, mode: 'single' | 'toggle' | 'range') => void;
  clearColSel: () => void;
  /** Clipboard EN MEMORIA (snapshot por VALOR, orden físico de la fuente) —
   *  no es el portapapeles del SO. Sobrevive al cambio de canvas dentro del
   *  proyecto (decisión owner iii); muere al cambiar de proyecto o changeset. */
  colClipboard: { source: { logicalName: string; physicalName: string }; cols: CanonicalColumn[] } | null;
  /** Copia la selección actual al clipboard. Devuelve cuántas columnas. */
  copySelectedColumns: () => number;
  /** Clipboard de TABLA completa (doc 50): snapshot por valor (tabla + sus
   *  columnas en orden físico). Mutuamente excluyente con `colClipboard` —
   *  un solo "contenido copiado", Ctrl/Cmd+V nunca es ambiguo. Mismo ciclo de
   *  vida doc 48: sobrevive al cambio de canvas, muere con proyecto/changeset. */
  tblClipboard: { table: CanonicalTable; cols: CanonicalColumn[] } | null;
  /** Copia el bloque al clipboard de tabla. Devuelve el nombre a mostrar, o
   *  null si la tabla no está en el diagrama. Copiar es lectura (vale en
   *  readonly), igual que el copy de columnas. */
  copyTable: (tableId: string) => string | null;
  /** Pega el clipboard de tabla como tabla NUEVA en el canvas activo (doc 50):
   *  nombres `_copy_n` libres GLOBALMENTE (§2), misma metadata, SIN relaciones
   *  ni flag FK, en UN lote. Devuelve el físico creado, o null si ya hay un
   *  paste en vuelo. */
  pasteTable: () => Promise<string | null>;
  /** Menú contextual del canvas (fila: colId; bloque: colId null). */
  colMenu: { x: number; y: number; tableId: string; colId: string | null } | null;
  openColMenu: (m: { x: number; y: number; tableId: string; colId: string | null }) => void;
  closeColMenu: () => void;
  /** Tabla destino del paste en confirmación (monta PasteColumnsPopup). */
  pasteTarget: string | null;
  setPasteTarget: (id: string | null) => void;
  /** Deep-link del panel de TABLA (doc 48, ajustado en doc 49): columna a
   *  poner A LA VISTA en Properties · Columns (pestaña + scroll, sin expandir
   *  — la edición vive en el panel de columna). Su productor es el botón Back
   *  del ColumnPropertiesPanel; el panel de tabla la consume (vuelve a null)
   *  al navegar — una sola vez. */
  panelFocusColId: string | null;
  setPanelFocusCol: (id: string | null) => void;
  /** Columna con su Properties abierto (doc 49): cuando no es null, el sidebar
   *  muestra el ColumnPropertiesPanel en lugar del panel de tabla. Siempre
   *  pertenece a `selectedTableId` (los gestos que la setean parten de una
   *  tabla concreta). */
  selectedColumnId: string | null;
  setSelectedColumn: (id: string | null) => void;
  /** Vista con su Properties abierto (doc 61): cuando no es null, el sidebar
   *  muestra el ViewPropertiesPanel (exclusión mutua con tabla/columna/edge —
   *  los setters cruzados se limpian entre sí). */
  selectedViewId: string | null;
  setSelectedView: (id: string | null) => void;
  /** Click simple en una fila del canvas (doc 49): selecciona la tabla y abre
   *  DIRECTO el Properties de esa columna (antes navegaba el panel de tabla). */
  focusColumnInPanel: (tableId: string, colId: string) => void;
  /** Instancia de React Flow del canvas activo (la setea ModelerCanvas en onInit). */
  flow: ReactFlowInstance | null;
  setFlow: (rf: ReactFlowInstance | null) => void;
  /** LOD (doc 33): bajo el umbral de zoom los nodos se pintan COMPACTOS (misma
   *  caja, tamaño y colores; sin las filas, que a ese zoom miden <1px). Default
   *  true: el fitView inicial de un canvas grande arranca alejado y la primera
   *  pintura ya sale liviana; si el canvas es chico, el primer onMove lo apaga
   *  al instante. `lodLock` lo congela en detalle durante el export SVG. */
  lod: boolean;
  setLod: (v: boolean) => void;
  lodLock: boolean;
  setLodLock: (v: boolean) => void;
  /** Centra el canvas sobre la tabla (Find a table… del toolbar). No-op si no hay nodo. */
  focusTable: (tableId: string) => void;
  /** Tabla a centrar en cuanto MONTE el canvas destino (Finder cross-canvas del
   *  Database Explorer). Lo consume ModelerCanvas tras cargar el diagrama. */
  pendingFocusTableId: string | null;
  setPendingFocus: (tableId: string | null) => void;
  /** Abre el canvas `canvasId` (de `projectId`) y centra sobre `tableId` cuando
   *  monte (Finder cross-canvas). Si ese canvas ya está abierto, centra directo. */
  openCanvasAndFocus: (canvasId: string, projectId: string | null | undefined, tableId: string) => Promise<void>;
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
   * Re-arma el explorer para el CONTEXTO actual (versión/changeset activo):
   * purga el cache de árboles, re-fetch bajo su overlay y re-abre el canvas
   * activo si sigue existiendo (o limpia la selección). Sin esto, al cambiar
   * de versión el árbol quedaba PEGADO al contexto anterior — los proyectos/
   * canvases draft de la versión abierta no aparecían (doc 16).
   */
  refreshExplorer: () => Promise<void>;
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
  createTable: (input: { logicalName: string; physicalName?: string; schema?: string; mode?: 'logical' | 'physical'; description?: string; udpValues?: Record<string, string> }) => Promise<void>;
  addColumn: (tableId: string, input: AddColumnInput) => Promise<void>;
  // createRelationship se retiró (doc 47): la creación es popup-gated — el
  // RelationshipCreatePopup graba el lote (columnas + relación) directamente.
  updateRelationship: (r: gov.Relationship) => Promise<void>;
  deleteRelationship: (id: string) => Promise<void>;
  addExistingTables: (tableIds: string[]) => Promise<void>;
  // `sourceTable` (doc 51, opcional por columna): nombre de la tabla dueña en
  // el ORIGEN — procedencia para el historial de auditoría; no viaja al payload.
  createTableFromSources: (input: { logicalName: string; schema?: string; columns: (CanonicalColumn & { sourceTable?: string })[] }) => Promise<void>;
  setColumnTarget: (id: string | null) => void;
  setSelectedTable: (id: string | null) => void;
  setSelectedEdge: (id: string | null) => void;
  removeTableFromArea: (tableId: string) => Promise<void>;
  /** Borra la tabla del MODELO con cascada versionada: vistas, relaciones,
   *  columnas, membresía en TODOS los canvases, y la tabla. Todo en el changeset. */
  deleteTable: (tableId: string) => Promise<void>;
  updateTable: (id: string, fields: { logicalName?: string; physicalName?: string; schema?: string; description?: string; udpValues?: Record<string, string> }) => Promise<void>;
  /** Upsert changeset-aware de una columna (merge sobre la columna actual del diagrama) + reload. */
  updateColumn: (colId: string, fields: Partial<CanonicalColumn>) => Promise<void>;
  /** Reordena columnas de una tabla al nuevo orden de ids: recomputa `ordinal` y persiste cada movida. */
  reorderColumns: (tableId: string, orderedIds: string[]) => Promise<void>;
  /** Borra la columna en el changeset; con `relIds`, borra ANTES cada relación
   *  afectada (cascade del warning de impacto — spec 10 §8, cierra el caso
   *  columna del bug #21 de relaciones huérfanas). */
  deleteColumn: (colId: string, relIds?: string[]) => Promise<void>;
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

// rAF con fallback: los tests del store corren en entorno node (sin DOM).
const raf = (cb: () => void) =>
  (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(cb, 16));

// Debounce de la persistencia de drawings (PUT del array completo).
let _drawingsTimer: ReturnType<typeof setTimeout> | null = null;
// Paste de tabla en vuelo (doc 50): un Ctrl+V repetido no dispara otro.
let _pasteTableBusy = false;
// Secuencia de cargas del diagrama: descarta respuestas fuera de orden (dos
// clicks rápidos en el explorer, reload en vuelo al cambiar de canvas).
let _loadSeq = 0;

export const useModelerStore = create<ModelerState>((set, get) => ({
  projects: [],
  folders: [],
  subjectAreas: [],
  trees: {},
  openingSaId: null,
  schemas: [],
  loadSchemas: async () => { set({ schemas: await schemasSvc.listSchemas() }); },
  activeProjectId: null,
  activeFolderId: null,
  activeSaId: null,
  diagram: null,
  columnTarget: null,
  selectedTableId: null,
  selectedEdgeId: null,
  viewMode: 'physical',
  relPreset: null,
  // Armar una herramienta desarma la otra (un solo gesto de dibujo a la vez).
  setRelPreset: (p) => set(p ? { relPreset: p, subcatArmed: false } : { relPreset: p }),
  subcatArmed: false,
  setSubcatArmed: (on) => set(on ? { subcatArmed: true, relPreset: null } : { subcatArmed: false }),
  hoverEdgeId: null,
  hoverNodeId: null,
  setHoverEdge: (id) => set({ hoverEdgeId: id }),
  setHoverNode: (id) => set({ hoverNodeId: id }),
  colSel: null,
  toggleColSelect: (tableId, colId, mode) => {
    const cur = get().colSel;
    // Cambiar de tabla fuente (o click simple) reinicia la selección: el
    // contrato del doc 48 es UNA tabla fuente por copia.
    if (mode === 'single' || !cur || cur.tableId !== tableId) {
      set({ colSel: { tableId, ids: [colId], anchor: colId } });
      return;
    }
    if (mode === 'toggle') {
      const ids = cur.ids.includes(colId) ? cur.ids.filter((i) => i !== colId) : [...cur.ids, colId];
      set({ colSel: ids.length ? { tableId, ids, anchor: colId } : null });
      return;
    }
    // range: contra el orden VISUAL del nodo (bloque PK en orden de llave,
    // luego el resto) — es lo que el usuario ve al Shift-clickear.
    const tcols = (get().diagram?.columns ?? []).filter((c) => c.tableId === tableId);
    const visual = [...pkInKeyOrder(tcols), ...tcols.filter((c) => !c.isPrimaryKey)].map((c) => c.id);
    const a = visual.indexOf(cur.anchor);
    const b = visual.indexOf(colId);
    if (a < 0 || b < 0) { set({ colSel: { tableId, ids: [colId], anchor: colId } }); return; }
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    set({ colSel: { tableId, ids: visual.slice(lo, hi + 1), anchor: cur.anchor } });
  },
  clearColSel: () => { if (get().colSel) set({ colSel: null }); },
  colClipboard: null,
  copySelectedColumns: () => {
    const sel = get().colSel;
    const d = get().diagram;
    if (!sel || !d || !sel.ids.length) return 0;
    const t = d.tables.find((x) => x.id === sel.tableId);
    const wanted = new Set(sel.ids);
    // Snapshot por VALOR en el ORDEN FÍSICO de la fuente (contrato doc 48):
    // editar o borrar la fuente después no altera lo ya copiado.
    const cols = d.columns
      .filter((c) => c.tableId === sel.tableId && wanted.has(c.id))
      .sort((x, y) => x.ordinal - y.ordinal)
      .map((c) => ({ ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) }));
    if (!cols.length) return 0;
    // Copiar DESELECCIONA (fix prueba viva): tras el copy el estado que
    // importa es el clipboard; dejar las filas marcadas leía como "pegado".
    // tblClipboard se limpia: los clipboards son excluyentes (doc 50).
    set({
      colClipboard: { source: { logicalName: t?.logicalName ?? '', physicalName: t?.physicalName ?? '' }, cols },
      colSel: null,
      tblClipboard: null,
    });
    return cols.length;
  },
  tblClipboard: null,
  copyTable: (tableId) => {
    const d = get().diagram;
    const t = d?.tables.find((x) => x.id === tableId);
    if (!d || !t) return null;
    // Snapshot POR VALOR en orden físico (contrato doc 48): editar o borrar el
    // original después no altera lo ya copiado.
    const cols = d.columns
      .filter((c) => c.tableId === tableId)
      .slice().sort((a, b) => a.ordinal - b.ordinal)
      .map((c) => ({ ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) }));
    set({
      tblClipboard: { table: { ...t, ...(t.udpValues ? { udpValues: { ...t.udpValues } } : {}) }, cols },
      colClipboard: null, colSel: null,   // excluyentes (doc 50)
    });
    return t.physicalName || t.logicalName;
  },
  pasteTable: async () => {
    if (_pasteTableBusy) return null;   // Ctrl+V repetido con el paste en vuelo
    const clip = get().tblClipboard;
    const saId = get().activeSaId;
    if (!clip) throw new Error('Nothing to paste');
    if (!saId) throw new Error('Pick a Subject Area');
    _pasteTableBusy = true;
    try {
      get().markDirty();
      const basePhys = copyNameBase(clip.table.physicalName, 'physical');
      const baseLog = copyNameBase(clip.table.logicalName || clip.table.physicalName, 'logical');
      // Reintentos ante carrera multiusuario: si otro draft ganó el nombre
      // (409 del guard global, doc 50 §2), se recalcula `n` y se reintenta.
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        // Nombres tomados: pool GLOBAL efectivo (búsqueda server-side, doc 43)
        // + el diagrama local (por si un alta propia aún no entró al índice).
        const pool = await gov.searchTables(`${basePhys}_copy_`, 500).catch(() => [] as CanonicalTable[]);
        const taken = [
          ...pool.map((t) => t.physicalName),
          ...(get().diagram?.tables ?? []).map((t) => t.physicalName),
        ];
        const { physicalName, logicalName } = nextCopyNames(basePhys, baseLog, taken);
        const id = crypto.randomUUID();
        try {
          await gov.recordChangesBulk(copyTableToBulk({ table: clip.table, cols: clip.cols, id, physicalName, logicalName }));
        } catch (e) {
          lastErr = e;
          if (e instanceof Error && /already exists/i.test(e.message)) continue;
          throw e;
        }
        // Alta en el canvas + bloque al costado del original (si está acá);
        // si no, al centro del viewport.
        const sa = await struct.getSubjectArea(saId);
        await struct.setSubjectAreaTables(saId, [...sa.tableIds, id]);
        const rf = get().flow;
        const src = rf?.getNode(clip.table.id);
        const pos = src
          ? { x: Math.round(src.position.x + 36), y: Math.round(src.position.y + 36) }
          : rf
            ? (() => { const c = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }); return { x: Math.round(c.x), y: Math.round(c.y) }; })()
            : { x: 120, y: 120 };
        await struct.setSubjectAreaLayout(saId, { [id]: pos });
        await get().reload();
        set({ selectedTableId: id, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });   // al frente + visible
        pushUndo(`Paste table ${physicalName}`, () => get().deleteTable(id));
        return physicalName;
      }
      throw lastErr instanceof Error ? lastErr : new Error("Couldn't paste the table");
    } finally { _pasteTableBusy = false; }
  },
  colMenu: null,
  openColMenu: (m) => set({ colMenu: m }),
  closeColMenu: () => { if (get().colMenu) set({ colMenu: null }); },
  pasteTarget: null,
  setPasteTarget: (id) => set({ pasteTarget: id }),
  panelFocusColId: null,
  setPanelFocusCol: (id) => set({ panelFocusColId: id }),
  selectedColumnId: null, selectedViewId: null,
  setSelectedColumn: (id) => set({ selectedColumnId: id }),
  // Doc 61: click en un nodo VISTA abre su panel; cierra los demás contextos.
  setSelectedView: (id) => set({ selectedViewId: id, selectedTableId: null, selectedEdgeId: null, selectedColumnId: null }),
  focusColumnInPanel: (tableId, colId) =>
    set({ selectedTableId: tableId, selectedEdgeId: null, selectedColumnId: colId, selectedViewId: null }),
  flow: null,
  setFlow: (rf) => set({ flow: rf }),
  lod: true,
  setLod: (v) => { if (get().lod !== v) set({ lod: v }); },
  lodLock: false,
  setLodLock: (v) => set({ lodLock: v }),
  pendingFocusTableId: null,
  setPendingFocus: (tableId) => set({ pendingFocusTableId: tableId }),
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
      void struct.setSubjectAreaDrawings(saId, get().drawings).catch((e: unknown) => {
        toast.error(e instanceof Error && e.message ? e.message : "Couldn't save the drawings");
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
      await struct.setSubjectAreaDrawings(saId, drawings);
    }
    set({ dirty: false });
  },
  focusTable: (tableId) => {
    const rf = get().flow; if (!rf) return;
    const node = rf.getNode(tableId);
    if (!node) return;
    // Seleccionar PRIMERO: montar el PropertiesPanel encoge el canvas
    // (clase has-props) y el centrado debe computarse contra el ancho final.
    // Nodos VISTA (F3) nunca abren el panel (spec §3-5) y en solo-lectura se
    // centra sin seleccionar (viewer-lock).
    if (node.type !== 'view' && useSessionStore.getState().openMode !== 'readonly') {
      set({ selectedTableId: tableId, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });
    }
    // Centrar DESPUÉS de que el layout se asiente (doble rAF). setCenter en
    // vez de fitView: con onlyRenderVisibleElements un nodo fuera del viewport
    // no está montado ⇒ no está MEDIDO ⇒ fitView (que usa node.measured) no
    // movía el viewport en el primer Enter; position+tamaño (con fallback)
    // están siempre disponibles aunque el nodo no exista en el DOM.
    raf(() => raf(() => {
      const n = rf.getNode(tableId); if (!n) return;
      const w = n.measured?.width ?? n.width ?? 260;
      const h = n.measured?.height ?? n.height ?? 140;
      const zoom = Math.min(1.2, Math.max(0.8, rf.getZoom()));
      void rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom, duration: 420 });
    }));
  },
  openCanvasAndFocus: async (canvasId, projectId, tableId) => {
    // Ya abierto → el nodo está montado, centrar directo (sin pending).
    if (get().activeSaId === canvasId) { get().focusTable(tableId); return; }
    // Cambio de canvas: primero cargamos el diagrama destino y RECIÉN dejamos la
    // tabla pendiente (el diagrama ya es el nuevo cuando el efecto de
    // ModelerCanvas la consume ⇒ no centra sobre una tabla homónima del canvas
    // viejo). Los nodos aún no montaron, así que el efecto poll-ea por rAF.
    await get().selectSubjectArea(canvasId, projectId ?? undefined);
    set({ pendingFocusTableId: tableId });
  },
  loadProjects: async () => { set({ projects: await struct.listProjects() }); },
  selectProject: async (pid) => {
    const [folders, subjectAreas] = await Promise.all([struct.listFolders(pid), struct.listSubjectAreas(pid)]);
    set((s) => ({
      activeProjectId: pid, folders, subjectAreas, activeFolderId: null, activeSaId: null,
      diagram: null, selectedTableId: null, drawings: [],
      // Doc 48: cambiar de PROYECTO invalida también el clipboard de columnas.
      colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null, colClipboard: null, tblClipboard: null,
      trees: { ...s.trees, [pid]: { folders, subjectAreas } },
    }));
  },
  selectFolder: (folderId) => set({ activeFolderId: folderId }),
  loadProjectTree: async (pid) => {
    const [folders, subjectAreas] = await Promise.all([struct.listFolders(pid), struct.listSubjectAreas(pid)]);
    set((s) => ({ trees: { ...s.trees, [pid]: { folders, subjectAreas } } }));
  },
  refreshExplorer: async () => {
    const st = get();
    const prevTreeIds = Object.keys(st.trees);
    const prevSaId = st.activeSaId;
    set({ trees: {}, projects: [] });
    // Los dropdowns de esquema también dependen del overlay de la versión.
    void get().loadSchemas().catch(() => {});
    await get().loadProjects();
    const valid = new Set(get().projects.map((p) => p.id));
    let pid = get().activeProjectId;
    // El proyecto activo no existe en este contexto (p.ej. era un draft de
    // OTRA versión): limpiar la selección completa.
    if (pid && !valid.has(pid)) {
      pid = null;
      set({ activeProjectId: null, folders: [], subjectAreas: [], activeFolderId: null,
            activeSaId: null, diagram: null, selectedTableId: null, drawings: [],
            colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null, colClipboard: null, tblClipboard: null });
    }
    // Re-hidrata los árboles que ya estaban cargados (los proyectos expandidos
    // del explorer siguen mostrando su contenido, ahora bajo el overlay nuevo).
    await Promise.all(prevTreeIds.filter((tid) => valid.has(tid))
      .map((tid) => get().loadProjectTree(tid).catch(() => {})));
    if (pid) await get()._refreshProject(pid);   // depura activeSaId vs la nueva membresía
    const saId = get().activeSaId;
    if (saId && saId === prevSaId) {
      // El canvas sobrevive al cambio de contexto: re-cargarlo COMPLETO
      // (diagrama + drawings) bajo el overlay de la versión nueva.
      try { await get().selectSubjectArea(saId); }
      catch { set({ activeSaId: null, diagram: null, selectedTableId: null, drawings: [], colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null }); }
    }
  },
  selectSubjectArea: async (saId, projectId) => {
    // Flush inmediato de drawings pendientes del canvas ANTERIOR: el debounce
    // de 500ms perdería el último trazo al cambiar de canvas.
    const prevSa = get().activeSaId;
    if (_drawingsTimer && prevSa) {
      clearTimeout(_drawingsTimer); _drawingsTimer = null;
      void struct.setSubjectAreaDrawings(prevSa, get().drawings).catch(() => {});
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
          ?? { folders: await struct.listFolders(pid), subjectAreas: await struct.listSubjectAreas(pid) };
        // El fetch del árbol agrega awaits DESPUÉS del primer guard: re-chequear
        // antes del set final — otro select pudo ganar mientras tanto y esta
        // respuesta vieja pisaría su canvas.
        if (seq !== _loadSeq) return;
        crossProject = { activeProjectId: pid, folders: tree.folders, subjectAreas: tree.subjectAreas, activeFolderId: null };
      }
      // Doc 48: la selección/menú/popup son del canvas anterior; el CLIPBOARD
      // sobrevive al cambio de canvas (copiar en A, pegar en B — decisión iii).
      set({ ...crossProject, activeSaId: saId, diagram, selectedTableId: null,
            colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null,
            drawings: diagram.subjectArea.drawings ?? [] });
    } finally {
      // Sólo la llamada MÁS RECIENTE limpia el spinner: una vieja descartada
      // no debe apagar el openingSaId de la que sigue en vuelo.
      if (seq === _loadSeq) set({ openingSaId: null });
    }
  },
  // ── Folders / Canvas / Projects (gestión del Model Explorer) ───────────
  loadFolders: async (projectId) => { set({ folders: await struct.listFolders(projectId) }); },
  // Refresca folders+canvases del proyecto activo tras una mutación y deja
  // `activeSaId` inválido en null (su canvas pudo haberse borrado).
  createFolder: async (projectId, parentFolderId, name) => {
    await struct.createFolder(projectId, parentFolderId, name);
    await get()._refreshProject(projectId);
  },
  renameFolder: async (id, name, projectId) => {
    await struct.renameFolder(id, name);
    const pid = projectId ?? get().activeProjectId; if (pid) await get()._refreshProject(pid);
  },
  deleteFolder: async (id, projectId) => {
    await struct.deleteFolder(id);
    const pid = projectId ?? get().activeProjectId; if (pid) await get()._refreshProject(pid);
  },
  createCanvas: async (projectId, folderId, name) => {
    const sa = await struct.createSubjectArea(projectId, name, folderId);
    await get()._refreshProject(projectId);
    await get().selectSubjectArea(sa.id, projectId);
  },
  renameCanvas: async (id, name, projectId) => {
    const pid = projectId ?? get().activeProjectId; if (!pid) return;
    const pool = get().trees[pid]?.subjectAreas ?? get().subjectAreas;
    const sa = pool.find((s) => s.id === id);
    await struct.updateSubjectArea(id, { projectId: pid, name, folderId: sa?.folderId ?? null });
    await get()._refreshProject(pid);
  },
  deleteCanvas: async (id, projectId) => {
    await struct.deleteSubjectArea(id);
    const pid = projectId ?? get().activeProjectId; if (pid) await get()._refreshProject(pid);
  },
  moveCanvas: async (id, folderId) => {
    const pid = get().activeProjectId; if (!pid) return;
    const sa = get().subjectAreas.find((s) => s.id === id); if (!sa) return;
    await struct.updateSubjectArea(id, { projectId: pid, name: sa.name, folderId });
    await get()._refreshProject(pid);
  },
  renameProject: async (id, name) => {
    await struct.renameProject(id, name);
    set({ projects: get().projects.map((p) => (p.id === id ? { ...p, name } : p)) });
  },
  deleteProject: async (id) => {
    await struct.deleteProject(id);
    const wasActive = get().activeProjectId === id;
    const trees = { ...get().trees };
    delete trees[id];
    set({
      projects: get().projects.filter((p) => p.id !== id),
      trees,
      ...(wasActive ? { activeProjectId: null, folders: [], subjectAreas: [], activeFolderId: null, activeSaId: null, diagram: null, selectedTableId: null,
                        colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null, colClipboard: null, tblClipboard: null } : {}),
    });
  },
  // Helper interno: recarga folders+canvases del proyecto al cache `trees` y,
  // si es el proyecto ACTIVO, espeja los campos legacy y depura la selección
  // (el canvas activo pudo haberse borrado).
  _refreshProject: async (projectId) => {
    const [folders, subjectAreas] = await Promise.all([struct.listFolders(projectId), struct.listSubjectAreas(projectId)]);
    const st = get();
    const treesPatch = { trees: { ...st.trees, [projectId]: { folders, subjectAreas } } };
    if (projectId !== st.activeProjectId) { set(treesPatch); return; }
    const activeFolderId = st.activeFolderId && folders.some((f) => f.id === st.activeFolderId) ? st.activeFolderId : null;
    const saStillExists = st.activeSaId != null && subjectAreas.some((s) => s.id === st.activeSaId);
    set({
      ...treesPatch,
      folders, subjectAreas, activeFolderId,
      ...(saStillExists ? {} : { activeSaId: null, diagram: null, selectedTableId: null, drawings: [], colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null }),
    });
  },
  reload: async () => {
    const id = get().activeSaId; if (!id) return;
    const seq = ++_loadSeq;
    let diagram: Diagram;
    try {
      diagram = await mod.loadDiagram(id);
    } catch {
      // El canvas no existe en el contexto actual (p.ej. draft de OTRA versión
      // tras cambiar de changeset): limpiar la selección en vez de dejar el
      // diagrama viejo pegado.
      if (seq === _loadSeq && get().activeSaId === id) {
        set({ activeSaId: null, diagram: null, selectedTableId: null, drawings: [], colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null });
      }
      return;
    }
    // Descarta respuestas viejas (cambio de canvas o carga más nueva en vuelo).
    if (seq !== _loadSeq || get().activeSaId !== id) return;
    set({ diagram });
  },
  saveLayout: async (tableId, pos) => {
    const saId = get().activeSaId; if (!saId) return;
    get().markDirty();
    await struct.setSubjectAreaLayout(saId, { [tableId]: pos });
  },
  saveAllLayout: async () => {
    const saId = get().activeSaId; const rf = get().flow;
    if (!saId || !rf) return;
    const layout: Record<string, { x: number; y: number }> = {};
    // Tablas Y vistas (F3: la posición de una vista vive en layout[viewId],
    // misma estructura) Y símbolos de subcategoría (doc 53: layout[symbolId]);
    // los shapes NO — sus posiciones viven en `drawings`.
    for (const n of rf.getNodes()) if (n.type === 'table' || n.type === 'view' || n.type === 'subcat') layout[n.id] = { x: n.position.x, y: n.position.y };
    await struct.setSubjectAreaLayout(saId, layout); // MERGEA en backend (M3a)
  },
  autoOrganize: async () => {
    const dia = get().diagram; const saId = get().activeSaId;
    if (!dia || !saId) return;
    get().markDirty();
    // Grafo + ELK + símbolos de subcategoría en `arrangeGraph.ts` (doc 55:
    // lo comparte el arrange headless de la carga masiva). Tamaños MEDIDOS de
    // los nodos vivos: ELK con tamaño fijo superponía las tablas altas (30
    // columnas ≈ 700px); un nodo sin medir cae a la estimación LOD.
    const { arrangeDiagram } = await import('@/features/modeler/lib/arrangeGraph');
    const measured = new Map((get().flow?.getNodes() ?? []).map((n) => [n.id, n.measured]));
    const pos = await arrangeDiagram(dia, (id) => {
      const m = measured.get(id);
      return m?.width != null && m?.height != null ? { width: m.width, height: m.height } : undefined;
    }, get().viewMode);
    await struct.setSubjectAreaLayout(saId, pos);   // setSubjectAreaLayout MERGEA (M3a)
    await get().reload();
  },
  createTable: async (input: { logicalName: string; physicalName?: string; schema?: string; mode?: 'logical' | 'physical'; description?: string; udpValues?: Record<string, string> }) => {
    const saId = get().activeSaId; if (!saId) throw new Error('Pick a Subject Area');
    get().markDirty();
    const id = crypto.randomUUID();
    // Físico: explícito (New table modal, ya auto-physicalizado scope:'table') →
    // si no, modo legacy ('physical' = tal cual; 'logical'/undefined = derivar).
    const physical = (input.physicalName?.trim())
      || (input.mode === 'physical' ? input.logicalName : (await gov.physicalize(input.logicalName, 'table')).physical);
    const schema = input.schema?.trim() || undefined;
    // Doc 64 §6: el alta captura definición funcional y UDPs (payload limpio,
    // solo con contenido — mismo criterio del alta de columna, doc 40).
    const description = input.description?.trim() || undefined;
    const udpValues = input.udpValues && Object.keys(input.udpValues).length ? input.udpValues : undefined;
    await gov.createTable({
      id, logicalName: input.logicalName, physicalName: physical, schema,
      ...(description ? { description } : {}),
      ...(udpValues ? { udpValues } : {}),
    });
    // referenciar la nueva tabla en la Subject Area
    const sa = await struct.getSubjectArea(saId);
    await struct.setSubjectAreaTables(saId, [...sa.tableIds, id]);
    await get().reload();
    // La tabla nueva queda SELECCIONADA → sube al frente (zIndex) y no cae oculta
    // detrás de un bloque que ya estaba en el canvas (pedido owner).
    set({ selectedTableId: id, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });
    // Undo (doc 50): tabla recién creada — la cascada del delete es trivial.
    pushUndo(`Create table ${physical}`, () => get().deleteTable(id));
  },
  addColumn: async (tableId: string, input: AddColumnInput) => {
    get().markDirty();
    const id = crypto.randomUUID();
    const physical = input.mode === 'logical' ? (await gov.physicalize(input.logicalName)).physical : input.logicalName;
    const domains = await gov.listDomains();
    const dom = domains.find((d) => d.id === input.parentDomainId);
    const override = (input.dataType ?? '').trim();
    // Doc 64 r2: el default del dominio se HOMOLOGA a la grafía canónica
    // (espejo de canonicalize_default_type, doc 62) — un dominio legacy con
    // `Array` hereda `ARRAY<>`, no el texto crudo de la BD sin homologar.
    const domDefault = canonicalDefaultType(dom?.defaultDataType);
    const dataType = override || domDefault || '';
    // Al FINAL del orden físico (antes: ordinal 0 → la columna nueva caía al
    // INICIO de la tabla) — coherente con la propagación a vistas de abajo.
    const siblings = (get().diagram?.columns ?? []).filter((c) => c.tableId === tableId);
    const ordinal = siblings.length ? Math.max(...siblings.map((c) => c.ordinal)) + 1 : 0;
    // Metadata del alta (doc 40): payload LIMPIO como en edición — flags solo
    // cuando se apartan del default (nullable true ES el default: no viaja),
    // description/udpValues solo con contenido. Una PK nueva entra AL FINAL de
    // la llave si la tabla maneja orden explícito (doc 19 §12b, como patchCol).
    const description = (input.description ?? '').trim();
    const pkPosition = input.isPrimaryKey ? nextPkPosition(siblings) : null;
    await gov.createColumn({
      id, tableId, logicalName: input.logicalName, physicalName: physical,
      // Doc 64 §1: el popup ahora muestra el default del dominio en el campo de
      // tipo — "mandaron dataType" ya no equivale a override. Con dominio, el
      // override real es tipo ≠ default (regla doc 46); sin dominio, un tipo
      // tipeado conserva la semántica previa (override).
      parentDomainId: input.parentDomainId || undefined, dataType,
      typeOverridden: dom ? dataType.trim() !== domDefault : !!override,
      ordinal,
      ...(description ? { description } : {}),
      ...(input.isPrimaryKey ? { isPrimaryKey: true } : {}),
      ...(input.isForeignKey ? { isForeignKey: true } : {}),
      ...(input.isNullable === false ? { isNullable: false } : {}),
      ...(input.isPartition ? { isPartition: true } : {}),
      ...(input.udpValues && Object.keys(input.udpValues).length ? { udpValues: input.udpValues } : {}),
      ...(pkPosition != null ? { pkPosition } : {}),
    });
    // V1 (doc 19 §12b): la columna nueva entra AUTOMÁTICAMENTE a las vistas
    // ESPEJO de la tabla (las que reflejan TODAS sus columnas), al final. Las
    // vistas curadas (subset deliberado) no se tocan. Best-effort: un fallo
    // acá no bloquea el alta (queda "Match physical order" para alinear).
    try {
      const touched = await syncNewColumnToMirrorViews(
        { listViews: viewsSvc.listViews, updateView: viewsSvc.updateView },
        tableId, physical, siblings,
      );
      if (touched) toast.success(`Column also added to ${touched} mirror view(s)`);
    } catch { /* la vista se alinea después con "Match physical order" */ }
    await get().reload();
    // Undo (doc 50): la inversa es el delete del store — limpia también las
    // vistas espejo y el panel de columna si quedó abierto sobre ella.
    pushUndo(`Add column ${physical}`, () => get().deleteColumn(id));
  },
  updateRelationship: async (r) => {
    get().markDirty();
    const pre0 = get().diagram?.relationships.find((x) => x.id === r.id);
    const pre = pre0 ? { ...pre0, pairs: pre0.pairs.map((p) => ({ ...p })) } : null;
    await gov.updateRelationship(r);
    if (pre) pushUndo('Edit relationship', async () => { await gov.updateRelationship(pre); await get().reload(); });
    await get().reload();
  },
  deleteRelationship: async (id) => {
    get().markDirty();
    const rel = get().diagram?.relationships.find((r) => r.id === id);
    // Pre-imágenes para el Undo (doc 50): la relación por valor + las FKs que
    // la limpieza de abajo apaga.
    const relPre = rel ? { ...rel, pairs: rel.pairs.map((p) => ({ ...p })) } : null;
    const fkClearedPre: CanonicalColumn[] = [];
    await gov.deleteRelationship(id);
    // Limpieza del flag FK (inverso de markForeignKey en create): si una columna
    // HIJA de algún par de la relación borrada ya NO es hija en NINGUNA otra
    // relación del pool (global, no sólo las visibles en este canvas), se le
    // quita isForeignKey. Conservador a propósito; isPrimaryKey nunca se toca.
    if (rel) {
      for (const colId of rel.pairs.map((p) => p.childColumnId)) {
        const col = get().diagram?.columns.find((c) => c.id === colId);
        if (!col?.isForeignKey) continue;
        // Slice server-side: sólo las relaciones que tocan la TABLA de la
        // columna (una relación siempre referencia la tabla de sus columnas).
        const near = (await gov.listRelationships(col.tableId)).filter((r) => r.id !== id);
        const stillLinked = near.some((r) => r.pairs.some((p) => p.childColumnId === colId));
        if (!stillLinked) {
          fkClearedPre.push({ ...col });
          await gov.updateColumn({ ...col, isForeignKey: false });
        }
      }
    }
    if (relPre) {
      pushUndo('Delete relationship', async () => {
        await gov.recordChangesBulk([
          ...fkClearedPre.map((c) => gov.bulk.createColumn(c)),
          gov.bulk.upsertRelationship(relPre),
        ]);
        await get().reload();
      });
    }
    await get().reload();
  },
  addExistingTables: async (tableIds: string[]) => {
    const saId = get().activeSaId; if (!saId || tableIds.length === 0) return;
    get().markDirty();
    const sa = await struct.getSubjectArea(saId);
    // Solo las REALMENTE agregadas (el merge ignora las que ya estaban): la
    // inversa del Undo no debe sacar del canvas una tabla que ya vivía acá.
    const added = tableIds.filter((t) => !sa.tableIds.includes(t));
    const merged = Array.from(new Set([...sa.tableIds, ...tableIds]));
    await struct.setSubjectAreaTables(saId, merged);
    await get().reload();
    // Selecciona la primera importada → al frente (zIndex) y visible (owner).
    set({ selectedTableId: tableIds[0], selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });
    if (added.length) {
      pushUndo(`Add ${added.length} table${added.length === 1 ? '' : 's'} to canvas`, async () => {
        for (const tid of added) await struct.removeTableFromCanvas(saId, tid);
        await get().reload();
      });
    }
  },
  createTableFromSources: async ({ logicalName, schema, columns }) => {
    const saId = get().activeSaId; if (!saId) throw new Error('Pick a Subject Area');
    get().markDirty();
    const id = crypto.randomUUID();
    const physical = (await gov.physicalize(logicalName, 'table')).physical;
    // Tabla + columnas EN UN LOTE (doc 39): el loop por columna eran N requests
    // secuenciales — importar cientos de columnas de tablas fuente demoraba
    // igual que el borrado. El backend valida el lote completo antes de
    // escribir: una columna inválida/duplicada ya no deja la tabla a medias.
    // Cada columna hereda su metadata INDIVIDUAL del origen (doc 45):
    // definición, PK/FK/nullable/partition, UDPs, dominio y tipo. Lo que NO
    // se arrastra: relaciones (isForeignKey queda como marca individual, sin
    // relationship en la tabla nueva) ni vistas. pkPosition se RE-NUMERA
    // secuencial en el orden heredado — los del origen podrían chocar entre
    // fuentes distintas. Claves opcionales solo si aportan (payload limpio,
    // patrón addColumn del doc 40).
    let ordinal = 0;
    let pk = 0;
    await gov.recordChangesBulk([
      gov.bulk.createTable(
        { id, logicalName, physicalName: physical, schema: schema?.trim() || undefined },
        { kind: 'ctas' }),
      ...columns.map((c) => {
        const description = (c.description ?? '').trim();
        const pkPosition = c.isPrimaryKey ? pk++ : null;
        return gov.bulk.createColumn({
          id: crypto.randomUUID(), tableId: id,
          logicalName: c.logicalName, physicalName: c.physicalName,
          parentDomainId: c.parentDomainId, dataType: c.dataType, typeOverridden: c.typeOverridden,
          isPrimaryKey: c.isPrimaryKey, ordinal: ordinal++,
          ...(description ? { description } : {}),
          ...(c.isForeignKey ? { isForeignKey: true } : {}),
          ...(c.isNullable === false ? { isNullable: false } : {}),
          ...(c.isPartition ? { isPartition: true } : {}),
          ...(c.udpValues && Object.keys(c.udpValues).length ? { udpValues: { ...c.udpValues } } : {}),
          ...(pkPosition != null ? { pkPosition } : {}),
        // Procedencia (doc 51): "Created from source <tabla>.<col> (CTAS)".
        }, { kind: 'ctas', ...(c.sourceTable ? { sourceTable: c.sourceTable } : {}), sourceColumn: c.physicalName });
      }),
    ]);
    const sa = await struct.getSubjectArea(saId);
    await struct.setSubjectAreaTables(saId, [...sa.tableIds, id]);
    await get().reload();
    set({ selectedTableId: id, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });   // al frente + visible (owner)
    pushUndo(`Create table ${physical}`, () => get().deleteTable(id));
  },
  setColumnTarget: (id: string | null) => set({ columnTarget: id }),
  // Seleccionar tabla o edge cambia de contexto: cierra el panel de columna.
  setSelectedTable: (id) => set({ selectedTableId: id, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null }),
  setSelectedEdge: (id) => set({ selectedEdgeId: id, selectedTableId: null, selectedColumnId: null, selectedViewId: null }),
  removeTableFromArea: async (tableId) => {
    get().markDirty();
    const saId = get().activeSaId; if (!saId) return;
    // Para el Undo (doc 50): nombre y posición ANTES de quitarla (el remove
    // también borra su entrada del layout).
    const name = get().diagram?.tables.find((t) => t.id === tableId)?.physicalName ?? 'table';
    const node = get().flow?.getNode(tableId);
    const pos = node ? { x: Math.round(node.position.x), y: Math.round(node.position.y) } : null;
    await struct.removeTableFromCanvas(saId, tableId);   // quita de tableIds + layout
    pushUndo(`Remove ${name} from canvas`, async () => {
      const sa = await struct.getSubjectArea(saId);
      if (!sa.tableIds.includes(tableId)) await struct.setSubjectAreaTables(saId, [...sa.tableIds, tableId]);
      if (pos) { try { await struct.setSubjectAreaLayout(saId, { [tableId]: pos }); } catch { /* layout best-effort */ } }
      await get().reload();
    });
    if (get().selectedTableId === tableId) set({ selectedTableId: null, selectedColumnId: null, selectedViewId: null });
    await get().reload();
  },
  deleteTable: async (tableId) => {
    get().markDirty();
    // Cascada COMPLETA en el changeset (versionada), grabada EN LOTE (doc 39):
    // el camino cambio-por-cambio eran ~1 request por columna — a 4k columnas
    // (tablas DDV reales) el borrado tomaba minutos. Las LECTURAS van primero
    // (estado pre-borrado, como el loop viejo: ninguna afecta a las otras),
    // luego UN bulk con vistas + relaciones + columnas, y la tabla AL FINAL
    // fuera del lote — mismo orden observable: si algo se interrumpe, la tabla
    // sigue viva y repetir el delete converge. Un solo reload al terminar.
    const [views, rels, cols] = await Promise.all([
      // vistas que la usan (cualquier fuente: tableId o sourceTableIds)
      viewsSvc.listViews(tableId).catch(() => []),
      // relaciones donde es extremo (globales)
      gov.listRelationships(tableId).catch(() => []),
      gov.listColumns(tableId).catch(() => []),
    ]);
    // Pre-imágenes para el Undo (doc 50): las lecturas de arriba YA traen el
    // estado pre-borrado — se congelan por valor antes de tocar nada.
    const t0 = get().diagram?.tables.find((x) => x.id === tableId);
    const tPre = t0 ? { ...t0, ...(t0.udpValues ? { udpValues: { ...t0.udpValues } } : {}) } : null;
    const undoSaId = get().activeSaId;
    const undoNode = get().flow?.getNode(tableId);
    const undoPos = undoNode ? { x: Math.round(undoNode.position.x), y: Math.round(undoNode.position.y) } : null;
    const colsPre = cols.map((c) => ({ ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) }));
    const relsPre = rels.map((r) => ({ ...r, pairs: r.pairs.map((p) => ({ ...p })) }));
    const viewsPre = views.map((v) => JSON.parse(JSON.stringify(v)) as View);
    const fkClearedPre: CanonicalColumn[] = [];
    // Columnas HIJA de la OTRA tabla (sobrevive): FK huérfano a limpiar después.
    const orphanFk: { colId: string; tableId: string }[] = [];
    for (const r of rels) {
      if (r.parentTableId === tableId && r.childTableId !== tableId) {
        r.pairs.forEach((p) => orphanFk.push({ colId: p.childColumnId, tableId: r.childTableId }));
      }
    }
    await gov.recordChangesBulk([
      ...views.map((v) => gov.bulk.deleteView(v.id)),
      ...rels.map((r) => gov.bulk.deleteRelationship(r.id)),
      ...cols.map((c) => gov.bulk.deleteColumn(c.id)),
    ]);
    // FK huérfano en columnas HIJA sobrevivientes (misma regla conservadora
    // que deleteRelationship: si ya no participan en ninguna relación).
    const seen = new Set<string>();
    for (const { colId, tableId: ctid } of orphanFk) {
      if (seen.has(colId)) continue; seen.add(colId);
      const near = await gov.listRelationships(ctid).catch(() => []);
      if (near.some((r) => r.pairs.some((p) => p.childColumnId === colId))) continue;
      const c = (await gov.listColumns(ctid).catch(() => [])).find((x) => x.id === colId);
      if (c?.isForeignKey) {
        fkClearedPre.push({ ...c });
        await gov.updateColumn({ ...c, isForeignKey: false });
      }
    }
    // Sacar de TODOS los canvases que la contienen (tableIds + layout).
    const usage = await gov.tableUsage(tableId).then((u) => u.usage).catch(() => []);
    for (const u of usage) await struct.removeTableFromCanvas(u.canvasId, tableId);
    // La tabla.
    await gov.deleteTable(tableId);
    // Undo (doc 50): UN lote restaura tabla + columnas + FKs limpiadas +
    // relaciones + vistas (el guard N=N resuelve la llave con las columnas del
    // mismo lote), y después las membresías de canvas. La posición solo se
    // restaura en el canvas ACTIVO (las demás vuelven con layout default).
    if (tPre) {
      pushUndo(`Delete table ${tPre.physicalName}`, async () => {
        await gov.recordChangesBulk([
          gov.bulk.createTable(tPre),
          ...colsPre.map((c) => gov.bulk.createColumn(c)),
          ...fkClearedPre.map((c) => gov.bulk.createColumn(c)),
          ...relsPre.map((r) => gov.bulk.upsertRelationship(r)),
          ...viewsPre.map((v) => gov.bulk.upsertView(v)),
        ]);
        for (const u of usage) {
          try {
            const sa = await struct.getSubjectArea(u.canvasId);
            if (!sa.tableIds.includes(tableId)) await struct.setSubjectAreaTables(u.canvasId, [...sa.tableIds, tableId]);
          } catch { /* el canvas pudo desaparecer */ }
        }
        if (undoSaId && undoPos) { try { await struct.setSubjectAreaLayout(undoSaId, { [tableId]: undoPos }); } catch { /* best-effort */ } }
        await get().reload();
      });
    }
    if (get().selectedTableId === tableId) set({ selectedTableId: null, selectedColumnId: null, selectedViewId: null });
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
    // Pre-imagen POR VALOR para el Undo (doc 50).
    const pre = { ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) };
    await gov.updateColumn({ ...c, ...fields }); // upsert por id = update (merge)
    pushUndo(`Edit column ${pre.physicalName}`, async () => {
      await gov.updateColumn(pre);
      // Si el cambio renombró el FÍSICO, las vistas quedaron re-apuntadas al
      // nombre nuevo (sync del panel): deshacer las devuelve al viejo.
      if (typeof fields.physicalName === 'string' && fields.physicalName !== pre.physicalName) {
        try {
          await syncRenamedColumnInViews(
            { listViews: viewsSvc.listViews, updateView: viewsSvc.updateView },
            pre.tableId, fields.physicalName, pre.physicalName);
        } catch { /* best-effort */ }
      }
      await get().reload();
    });
    await get().reload();
  },
  reorderColumns: async (tableId, orderedIds) => {
    get().markDirty();
    const dia = get().diagram; if (!dia) return;
    // Orden PREVIO para el Undo (doc 50): la inversa re-usa esta misma acción.
    const prevIds = dia.columns.filter((c) => c.tableId === tableId)
      .slice().sort((a, b) => a.ordinal - b.ordinal).map((c) => c.id);
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
    // que con varios usuarios satura el backend). El backend graba cada
    // cambio con $set atómico por entidad, así que no se pisan entre sí.
    const changed = orderedIds
      .map((id, ordinal) => ({ c: byId.get(id), ordinal }))
      .filter((x): x is { c: CanonicalColumn; ordinal: number } => !!x.c && x.c.ordinal !== x.ordinal);
    for (let i = 0; i < changed.length; i += 5) {
      await Promise.all(changed.slice(i, i + 5).map(({ c, ordinal }) => gov.updateColumn({ ...c, ordinal })));
    }
    if (changed.length) pushUndo('Reorder columns', () => get().reorderColumns(tableId, prevIds));
    await get().reload();
  },
  deleteColumn: async (colId, relIds = []) => {
    get().markDirty();
    // Primero las relaciones (elegidas en el dialog de impacto), después la
    // columna: el changeset nunca queda con pares colgando de una columna
    // borrada (spec 10 §8). v2 (doc 19): si la relación tiene MÁS pares, sólo
    // se quita el par de esta columna; si era el último, se borra completa.
    const col = get().diagram?.columns.find((c) => c.id === colId);
    const pool = relIds.length && col ? await gov.listRelationships(col.tableId) : [];
    // Pre-imágenes para el Undo (doc 50): columna, relaciones afectadas (por
    // valor), FKs que se limpian abajo y vistas que referencian la columna.
    const colPre = col ? { ...col, ...(col.udpValues ? { udpValues: { ...col.udpValues } } : {}) } : null;
    const relsPre = pool.filter((r) => relIds.includes(r.id))
      .map((r) => ({ ...r, pairs: r.pairs.map((p) => ({ ...p })) }));
    const fkClearedPre: CanonicalColumn[] = [];
    const viewsPre: View[] = col
      ? (await viewsSvc.listViews(col.tableId).catch(() => [] as View[]))
          .filter((v) => removeColumnSource(v, col.tableId, col.physicalName) != null)
          .map((v) => JSON.parse(JSON.stringify(v)) as View)
      : [];
    // Columnas HIJAS del otro extremo de los pares afectados: al caer el
    // par/relación pueden quedar con un isForeignKey huérfano (misma limpieza
    // conservadora que deleteRelationship — isPrimaryKey nunca se toca).
    const fkCandidates = new Set<string>();
    for (const rid of relIds) {
      const rel = pool.find((r) => r.id === rid);
      const dropped = rel?.pairs.filter(
        (p) => p.parentColumnId === colId || p.childColumnId === colId) ?? [];
      const remaining = rel?.pairs.filter(
        (p) => p.parentColumnId !== colId && p.childColumnId !== colId) ?? [];
      dropped.forEach((p) => { if (p.childColumnId !== colId) fkCandidates.add(p.childColumnId); });
      if (rel && remaining.length > 0 && remaining.length < rel.pairs.length) {
        await gov.updateRelationship({ ...rel, pairs: remaining });
      } else {
        await gov.deleteRelationship(rid);
      }
    }
    for (const cid of fkCandidates) {
      const c = get().diagram?.columns.find((x) => x.id === cid);
      if (!c?.isForeignKey) continue;
      const near = await gov.listRelationships(c.tableId);
      const still = near.some((r) => r.pairs.some((p) => p.childColumnId === cid));
      if (!still) {
        fkClearedPre.push({ ...c });
        await gov.updateColumn({ ...c, isForeignKey: false });
      }
    }
    await gov.deleteColumn(colId);
    // Undo (doc 50): UN lote restaura columna + FKs limpiadas + relaciones
    // (la columna va PRIMERO — el guard N=N del backend resuelve la llave del
    // padre con las columnas del MISMO lote); las vistas capturadas vuelven a
    // su doc previo (best-effort).
    if (colPre) {
      pushUndo(`Delete column ${colPre.physicalName}`, async () => {
        await gov.recordChangesBulk([
          gov.bulk.createColumn(colPre),
          ...fkClearedPre.map((c) => gov.bulk.createColumn(c)),
          ...relsPre.map((r) => gov.bulk.upsertRelationship(r)),
        ]);
        for (const v of viewsPre) { try { await viewsSvc.updateView(v.id, v); } catch { /* best-effort */ } }
        await get().reload();
      });
    }
    // Si la columna borrada tenía su Properties abierto (doc 49), se cierra —
    // el sidebar vuelve al Properties de la tabla.
    if (get().selectedColumnId === colId) set({ selectedColumnId: null, selectedViewId: null });
    // La columna eliminada sale de los sources de TODA vista que la
    // referenciaba (espejo o curada) — best-effort, no bloquea el borrado.
    if (col) {
      try {
        const n = await syncRemovedColumnFromViews(
          { listViews: viewsSvc.listViews, updateView: viewsSvc.updateView },
          col.tableId, col.physicalName);
        if (n) toast.success(`Column also removed from ${n} view(s)`);
      } catch { /* la vista se corrige a mano o con "Ordenar como la tabla" */ }
    }
    await get().reload();
  },
  // Doc 53: la subcategoría es exclusiva del modelo lógico — pasar a físico
  // desarma la herramienta (el botón del toolbar también se deshabilita).
  // Doc 63: las vistas son exclusivas del físico — entrar a lógico cierra
  // el panel de vista (su bloque desaparece del canvas).
  setViewMode: (m: 'logical' | 'physical') =>
    set(m === 'physical' ? { viewMode: m, subcatArmed: false } : { viewMode: m, selectedViewId: null }),
  createProject: async (name: string) => {
    const p = await struct.createProject(name);
    set({ projects: [...get().projects, p] });
    await get().selectProject(p.id);
  },
  createSubjectArea: async (name: string) => {
    const pid = get().activeProjectId;
    if (!pid) throw new Error('Pick a Project first');
    const sa = await struct.createSubjectArea(pid, name);
    await get()._refreshProject(pid);
    await get().selectSubjectArea(sa.id);
  },
}));

// Doc 48: el clipboard de columnas pertenece al changeset donde se copió —
// cambiar de changeset (o soltarlo) lo invalida, junto con la selección y el
// popup. Doc 50: ídem el clipboard de TABLA y la pila de Undo (las inversas
// apuntan al draft anterior). Suscripción a nivel de módulo (useChangesetStore
// no importa este store, así que no hay ciclo).
useChangesetStore.subscribe((s, prev) => {
  if (s.activeId === prev.activeId) return;
  useModelerStore.setState({ colClipboard: null, tblClipboard: null, colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null });
  useUndoStore.getState().clear();
});

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
