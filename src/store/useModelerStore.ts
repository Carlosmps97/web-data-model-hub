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
import * as gov from '@/services/governance.service';
import type { CanonicalColumn, CanonicalTable } from '@/services/governance.service';
import { getNamingConfig, type NamingConfig } from '@/services/naming.service';
import { applyNamingCase } from '@/features/modeler/lib/physicalCase';
import { diagramSignature } from '@/features/modeler/lib/diagramSignature';
import { copyNameBase, copyTableToBulk, nextCopyNames } from '@/features/modeler/lib/copyTable';
import { keyLayoutBulk } from '@/features/modeler/lib/keyLayout';
import { canonicalDefaultType } from '@/features/modeler/lib/typePick';
import { mirrorComplex } from '@/features/modeler/lib/facetTypes';
import { isComplexTypeStart } from '@/features/modeler/lib/complexTypes';
import { orphanViewIds } from '@/features/modeler/lib/canvasViews';
import { isPkFirst, orderColumns, persistReorder, pkFirstOrdinals, reorderPlan, sortByOrdinal } from '@/features/modeler/lib/columnOrder';
import type { CanvasDropPlan } from '@/features/modeler/lib/canvasDrop';
import { canvasClock, wholePoint, writtenSince } from '@/features/modeler/lib/canvasWrites';
import {
  cleanRoute, cleanRoutes, pruneRoutes, routableWireIds, routeOf, sameRoute, wireIdsOfTable,
} from '@/features/modeler/lib/wireRoute';
import type { RoutePoint, WireRoutes } from '@/features/modeler/lib/wireRoute';
import {
  removeColumnSource, syncNewColumnToMirrorViews, syncRemovedColumnFromViews, syncRenamedColumnInViews,
} from '@/features/modeler/lib/viewSync';
import * as viewsSvc from '@/services/views.service';
import type { View } from '@/services/views.service';
import { useSessionStore } from '@/store/useSessionStore';
import { pushUndo, useUndoStore } from '@/store/useUndoStore';
import { runBlocking } from '@/store/useBusyStore';
import { ApiError } from '@/services/http';

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
  /** Doc 86 D4: tipo LÓGICO tipeado en modo Logical (override lógico explícito); ausente = el del dominio. */
  logicalDataType?: string;
  description?: string;
  /** Doc 85: comment físico heredado del dominio estándar (se edita luego en Properties). */
  physicalDescription?: string;
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
  /** Doc 88 §2: sube cuando cambia la ESTRUCTURA del canvas activo (tabla o
   *  vista nueva, borrada o renombrada, columnas) o al pulsar Refresh — el
   *  catálogo del Explorer (inventario cacheado, doc 72) lo usa para invalidarse. */
  explorerTick: number;
  bumpExplorer: () => void;
  /** Doc 89 §3.6: tras un cambio ESTRUCTURAL ya persistido, refresca el Explorer
   *  SOLO si el objeto NO está en el canvas activo — si está, `reload()` ya subió
   *  el tick al cambiar la firma del diagrama (doc 88 §2). Nunca ambos. */
  syncExplorer: (onActiveCanvas: boolean) => void;
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
  /** Doc 83: naming config (separador/case por scope) del proyecto activo —
   *  se carga al abrir un canvas; el popup New column y el panel Properties
   *  aplican `column.case` al físico TIPEADO. null = aún no cargado. */
  naming: NamingConfig | null;
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
  /** Doc 71: el buscador del Model (popup ⌘K) se abre desde el toolbar Y desde la
   *  cabecera del Explorer — el estado vive acá para que ambos lo compartan. */
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  /** Doc 72 r2: navegación en curso hacia otro canvas (Locate): el Workspace
   *  muestra un overlay bloqueante hasta que el canvas cargó y centró. */
  navigating: { canvas: string; target?: string } | null;
  /** Doc 72: objeto abierto en el Object Inspector (popup de solo lectura, sin canvas). */
  inspect: InspectTarget | null;
  openInspector: (t: InspectTarget) => void;
  closeInspector: () => void;
  /** Instancia de React Flow del canvas activo (la setea ModelerCanvas en onInit). */
  flow: ReactFlowInstance | null;
  setFlow: (rf: ReactFlowInstance | null) => void;
  /** Doc 84 E: movimientos/arrange hechos en modo VISOR, por canvas — viven sólo
   *  en esta sesión (memoria) y jamás se persisten; el canvas los pinta encima
   *  del layout publicado. Persistir sigue siendo cosa de una edición publicada. */
  viewerLayout: Record<string, Record<string, { x: number; y: number }>>;
  setViewerPos: (saId: string, nodeId: string, pos: { x: number; y: number }) => void;
  /** Aviso «los movimientos en modo visor no se guardan»: una vez por sesión. */
  viewerHintShown: boolean;
  markViewerHint: () => void;
  /** Doc 99: trazos MANUALES de los wires del canvas abierto (id del wire →
   *  puntos de quiebre). Se siembran del diagrama cada vez que llega uno
   *  (saneados, y solo de wires que existen) y cada wire lee el suyo por
   *  selector: cambiar un trazo re-pinta ESE wire, no re-arma el canvas. */
  canvasRoutes: WireRoutes;
  /** Doc 99: canvases donde un auto-arrange en modo VISOR movió todos los
   *  bloques en esta sesión — sus trazos publicados ya no calzan y se ocultan
   *  (mismo alcance efímero que `viewerLayout`; nada se persiste). */
  viewerRoutesOff: Record<string, true>;
  /** Doc 99: fija el trazo de un wire del canvas abierto (null o lista vacía =
   *  camino automático). Pinta al instante, graba UNA vez en la working copy
   *  y apila su Undo; si el guardado falla, vuelve al trazo anterior y avisa.
   *  Fuera de una sesión de edición no hace nada. */
  setWireRoute: (wireId: string, points: RoutePoint[] | null) => Promise<void>;
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
  /** Tabla (y opcionalmente columna, doc 70 §11) a centrar en cuanto MONTE el
   *  canvas destino (Finder cross-canvas / buscador del Model). Lo consume
   *  ModelerCanvas tras cargar el diagrama. */
  pendingFocusTableId: string | null;
  pendingFocusColId: string | null;
  setPendingFocus: (tableId: string | null, colId?: string | null) => void;
  /** Doc 70 §11: centra la tabla Y abre la columna — selecciona su fila en el
   *  bloque y monta su Properties (mismo gesto que el click en la fila). */
  focusColumn: (tableId: string, colId: string) => void;
  /** Abre el canvas `canvasId` (de `projectId`) y centra sobre `tableId` cuando
   *  monte (Finder cross-canvas / buscador); con `colId` abre además la columna.
   *  Si ese canvas ya está abierto, centra directo. */
  openCanvasAndFocus: (canvasId: string, projectId: string | null | undefined, tableId: string, colId?: string, label?: string) => Promise<void>;
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
  /** Doc 75 D5: graba el borrado del proyecto en la working copy (UN cambio). */
  deleteProject: (id: string) => Promise<void>;
  /** La working copy activa borra su proyecto: el canvas cede al panel «Deletion pending». */
  projectDeletionPending: boolean;
  undoProjectDeletion: () => Promise<void>;
  /** @internal recarga folders+canvases del proyecto y depura la selección. */
  _refreshProject: (projectId: string) => Promise<void>;
  reload: () => Promise<void>;
  /** Doc 83: cachea el naming config de `projectId` (descarta respuestas de
   *  un proyecto que dejó de ser el activo; un fallo no pisa lo cacheado). */
  loadNaming: (projectId: string | null) => Promise<void>;
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
  /** Importa tablas EXISTENTES al canvas. Doc 70: la tabla entra SOLA — sus
   *  vistas se suman sólo con `withViews` (checkbox del modal); la membresía
   *  de vistas parte de `diagram.subjectArea.viewIds` (materializado). */
  addExistingTables: (tableIds: string[], opts?: { withViews?: boolean }) => Promise<void>;
  /** Doc 70: suma vistas (ya existentes en el modelo) a la membresía de ESTE
   *  canvas — tab Views → «Add to this canvas», alta desde Create view. */
  addViewsToCanvas: (viewIds: string[]) => Promise<void>;
  /** Doc 70: saca una vista de ESTE canvas (membresía + layout); la vista
   *  sigue en el modelo y en los demás canvases. */
  removeViewFromCanvas: (viewId: string) => Promise<void>;
  // `sourceTable` (doc 51, opcional por columna): nombre de la tabla dueña en
  // el ORIGEN — procedencia para el historial de auditoría; no viaja al payload.
  createTableFromSources: (input: { logicalName: string; schema?: string; columns: (CanonicalColumn & { sourceTable?: string })[] }) => Promise<void>;
  setColumnTarget: (id: string | null) => void;
  setSelectedTable: (id: string | null) => void;
  setSelectedEdge: (id: string | null) => void;
  removeTableFromArea: (tableId: string) => Promise<void>;
  /** Borra la tabla del MODELO con cascada versionada: vistas, relaciones,
   *  columnas, membresía en TODOS los canvases, y la tabla. Todo en el changeset. */
  /** Doc 89 §3.1: `opts.pre` = pre-imagen para el Undo cuando la tabla NO está
   *  en el diagrama (borrado desde el Object Inspector, sin canvas). */
  deleteTable: (tableId: string, opts?: { pre?: CanonicalTable }) => Promise<void>;
  updateTable: (id: string, fields: { logicalName?: string; physicalName?: string; schema?: string; description?: string; udpValues?: Record<string, string> }) => Promise<void>;
  /** Upsert changeset-aware de una columna (merge sobre la columna actual del diagrama) + reload. */
  updateColumn: (colId: string, fields: Partial<CanonicalColumn>) => Promise<void>;
  /** Reordena las columnas de una tabla al nuevo orden de ids (doc 74: el
   *  ÚNICO orden, `ordinal`, el mismo en lógico y físico) y persiste sólo las
   *  que se movieron. */
  reorderColumns: (tableId: string, orderedIds: string[]) => Promise<void>;
  /** Doc 73 §10.4: aplica el plan de un drop en el bloque del canvas — cambios
   *  de llave (entrar/salir/reordenar) + reorden de columnas. */
  applyCanvasDrop: (tableId: string, plan: CanvasDropPlan) => Promise<void>;
  /** Borra la columna en el changeset; con `relIds`, borra ANTES cada relación
   *  afectada (cascade del warning de impacto — spec 10 §8, cierra el caso
   *  columna del bug #21 de relaciones huérfanas). */
  /** Doc 89 §3.1: `opts.col` = la columna (estado efectivo) cuando NO está en el
   *  diagrama — sin ella la cascada de relaciones/FK/vistas no se puede resolver. */
  deleteColumn: (colId: string, relIds?: string[], opts?: { col?: CanonicalColumn }) => Promise<void>;
  setViewMode: (m: 'logical' | 'physical') => void;
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
  explorerTick: 0,
  bumpExplorer: () => set((s) => ({ explorerTick: s.explorerTick + 1 })),
  syncExplorer: (onActiveCanvas) => { if (!onActiveCanvas) get().bumpExplorer(); },
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
  naming: null,
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
    // range: contra el orden VISUAL del nodo (el orden único, doc 94: PK
    // primero y cada bloque por ordinal) — es lo que el usuario ve al
    // Shift-clickear.
    const tcols = (get().diagram?.columns ?? []).filter((c) => c.tableId === tableId);
    const visual = orderColumns(tcols).map((c) => c.id);
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
    // Snapshot por VALOR en el ORDEN ÚNICO de la fuente (contrato doc 48; doc
    // 94: PK primero): editar o borrar la fuente después no altera lo copiado.
    const cols = orderColumns(d.columns.filter((c) => c.tableId === sel.tableId && wanted.has(c.id)))
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
    // Snapshot POR VALOR en el orden único (contrato doc 48; doc 94: PK
    // primero): editar o borrar el original después no altera lo ya copiado.
    const cols = orderColumns(d.columns.filter((c) => c.tableId === tableId))
      .map((c) => ({ ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) }));
    set({
      tblClipboard: { table: { ...t, ...(t.udpValues ? { udpValues: { ...t.udpValues } } : {}) }, cols },
      colClipboard: null, colSel: null,   // excluyentes (doc 50)
    });
    return t.physicalName || t.logicalName;
  },
  pasteTable: () => runBlocking('Creating table…', async () => {
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
        // si no, al centro del viewport. Doc 100: en UNA escritura, dentro de
        // la cola del canvas.
        const rf = get().flow;
        const src = rf?.getNode(clip.table.id);
        const pos = src
          ? { x: Math.round(src.position.x + 36), y: Math.round(src.position.y + 36) }
          : rf
            ? (() => { const c = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }); return { x: Math.round(c.x), y: Math.round(c.y) }; })()
            : { x: 120, y: 120 };
        await struct.addToCanvas(saId, { tableIds: [id], layout: { [id]: pos } });
        await get().reload();
        set({ selectedTableId: id, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });   // al frente + visible
        pushUndo(`Paste table ${physicalName}`, () => get().deleteTable(id));
        return physicalName;
      }
      throw lastErr instanceof Error ? lastErr : new Error("Couldn't paste the table");
    } finally { _pasteTableBusy = false; }
  }),
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
  viewerLayout: {},
  setViewerPos: (saId, nodeId, pos) => set((st) => ({
    viewerLayout: { ...st.viewerLayout, [saId]: { ...(st.viewerLayout[saId] ?? {}), [nodeId]: pos } },
  })),
  viewerHintShown: false,
  markViewerHint: () => set({ viewerHintShown: true }),
  canvasRoutes: {},
  viewerRoutesOff: {},
  setWireRoute: async (wireId, points) => {
    const saId = get().activeSaId;
    const dia = get().diagram;
    const session = useSessionStore.getState();
    if (!saId || !dia || session.openMode !== 'editing' || !session.activeChangesetId) return;
    // El diagrama tiene que ser el del canvas abierto: sus wires deciden qué
    // trazos se podan al grabar.
    if (dia.subjectArea.id !== saId) return;
    // `null` o lista vacía = volver al camino automático. Lo que no es una
    // lista de puntos válida ni se pinta ni se graba (ni quita el trazo).
    const next = points === null ? [] : Array.isArray(points) ? (points.length ? cleanRoute(points) : []) : null;
    if (next === null) return;
    const prev = routeOf(get().canvasRoutes, wireId) ?? null;
    if (sameRoute(prev, next)) return;               // sin cambio real: cero requests
    get().markDirty();
    try {
      await writeWireRoute(saId, wireId, next.length ? next : null, routableWireIds(dia.relationships));
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Couldn't save the wire route");
      return;
    }
    pushUndo('Reroute wire', () => writeWireRoute(saId, wireId, prev));
  },
  searchOpen: false,
  setSearchOpen: (v) => set({ searchOpen: v }),
  navigating: null,
  inspect: null,
  openInspector: (t) => set({ inspect: t }),
  closeInspector: () => set({ inspect: null }),
  lod: true,
  setLod: (v) => { if (get().lod !== v) set({ lod: v }); },
  lodLock: false,
  setLodLock: (v) => set({ lodLock: v }),
  pendingFocusTableId: null,
  pendingFocusColId: null,
  // Consumir/abandonar el foco pendiente cierra también el overlay de navegación (doc 72 r2).
  setPendingFocus: (tableId, colId = null) => set({ pendingFocusTableId: tableId, pendingFocusColId: tableId ? colId : null, ...(tableId ? {} : { navigating: null }) }),
  focusColumn: (tableId, colId) => {
    get().focusTable(tableId);
    const exists = get().diagram?.columns.some((c) => c.id === colId && c.tableId === tableId);
    if (!exists) return;
    get().toggleColSelect(tableId, colId, 'single');
    get().focusColumnInPanel(tableId, colId);
  },
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
  openCanvasAndFocus: async (canvasId, projectId, tableId, colId, label) => {
    // Ya abierto → el nodo está montado, centrar directo (sin pending).
    if (get().activeSaId === canvasId) {
      if (colId) get().focusColumn(tableId, colId); else get().focusTable(tableId);
      return;
    }
    // Doc 72 r2: overlay bloqueante mientras se abre el canvas y se centra —
    // sin él, cerrar el popup y esperar daba la sensación de que no pasó nada.
    const canvasName = (projectId ? get().trees[projectId]?.subjectAreas : undefined)?.find((s) => s.id === canvasId)?.name
      ?? get().subjectAreas.find((s) => s.id === canvasId)?.name ?? '';
    set({ navigating: { canvas: canvasName, target: label } });
    // Cambio de canvas: primero cargamos el diagrama destino y RECIÉN dejamos la
    // tabla pendiente (el diagrama ya es el nuevo cuando el efecto de
    // ModelerCanvas la consume ⇒ no centra sobre una tabla homónima del canvas
    // viejo). Los nodos aún no montaron, así que el efecto poll-ea por rAF.
    try {
      await get().selectSubjectArea(canvasId, projectId ?? undefined);
    } catch (e) {
      set({ navigating: null });
      throw e;
    }
    if (get().activeSaId !== canvasId) { set({ navigating: null }); return; }   // otro select ganó
    set({ pendingFocusTableId: tableId, pendingFocusColId: colId ?? null });
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
    const prevSaId = get().activeSaId;
    // Doc 75 D8: la sesión de canvas es de UN proyecto — el explorer muestra
    // ese y sólo ese; el resto de proyectos no se carga ni se lista.
    const pid = useSessionStore.getState().activeProjectId;
    set({ trees: {}, projects: [], projectDeletionPending: false });
    // Los dropdowns de esquema también dependen del overlay de la versión.
    void get().loadSchemas().catch(() => {});
    const gone = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 409);
    try {
      await get().loadProjects();
    } catch (e) {
      if (!gone(e)) throw e;
    }
    const valid = new Set(get().projects.map((p) => p.id));
    if (!pid || !valid.has(pid)) {
      // El proyecto fue borrado en una versión publicada (o no existe en este
      // contexto): cerrar la sesión de canvas y volver al chooser.
      set({ activeProjectId: null, folders: [], subjectAreas: [], activeFolderId: null,
            activeSaId: null, diagram: null, selectedTableId: null, drawings: [],
            colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null, colClipboard: null, tblClipboard: null });
      if (pid) {
        toast.error('This project was deleted in a published version.');
        useSessionStore.getState().closeModel();
      }
      return;
    }
    set({ activeProjectId: pid });
    try {
      await get()._refreshProject(pid);   // depura activeSaId vs la nueva membresía
    } catch (e) {
      if (!gone(e)) throw e;
      toast.error('This project was deleted in a published version.');
      useSessionStore.getState().closeModel();
      return;
    }
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
      const asked = canvasClock();
      const loaded = await mod.loadDiagram(saId);
      // Descarta respuestas VIEJAS: si mientras cargaba el usuario seleccionó
      // otro canvas (o corrió otro reload), pisar el diagrama con esta
      // respuesta dejaría el canvas mostrando un subject area ajeno.
      if (seq !== _loadSeq) return;
      const diagram = withWrittenCanvas(loaded, asked);
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
      // Doc 99: también el wire seleccionado — la misma relación puede estar en
      // el canvas nuevo y aparecería seleccionada, con sus tiradores a la vista.
      set({ ...crossProject, activeSaId: saId, diagram, selectedTableId: null, selectedEdgeId: null,
            colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null,
            drawings: diagram.subjectArea.drawings ?? [] });
      // Doc 83: reglas de naming del proyecto del canvas (best-effort, no bloquea).
      void get().loadNaming(pid ?? get().activeProjectId);
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
    // Doc 75 D5: UN cambio en la working copy; la cascada la hace el servidor
    // al aplicar la versión aprobada. El canvas cede al panel de borrado.
    await struct.deleteProject(id);
    get().markDirty();
    set({ projectDeletionPending: true, selectedTableId: null, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });
  },
  projectDeletionPending: false,
  undoProjectDeletion: async () => {
    const pid = get().activeProjectId;
    if (!pid) return;
    const published = (await mod.listProjects()).find((p) => p.id === pid);
    if (!published) throw new Error('The published project could not be read.');
    await struct.reviveProject(pid, published);
    set({ projectDeletionPending: false });
    await get().refreshExplorer();
  },
  // Helper interno: recarga folders+canvases del proyecto al cache `trees` y,
  // si es el proyecto ACTIVO, espeja los campos legacy y depura la selección
  // (el canvas activo pudo haberse borrado).
  _refreshProject: async (projectId) => {
    const [folders, subjectAreas, projectDeletionPending] = await Promise.all([
      struct.listFolders(projectId), struct.listSubjectAreas(projectId), struct.projectDeletionPending(projectId),
    ]);
    const st = get();
    const treesPatch = { trees: { ...st.trees, [projectId]: { folders, subjectAreas } }, projectDeletionPending };
    if (projectId !== st.activeProjectId) { set(treesPatch); return; }
    const activeFolderId = st.activeFolderId && folders.some((f) => f.id === st.activeFolderId) ? st.activeFolderId : null;
    const saStillExists = st.activeSaId != null && subjectAreas.some((s) => s.id === st.activeSaId);
    set({
      ...treesPatch,
      folders, subjectAreas, activeFolderId,
      ...(saStillExists ? {} : { activeSaId: null, diagram: null, selectedTableId: null, drawings: [], colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null }),
    });
  },
  loadNaming: async (projectId) => {
    if (!projectId) return;
    try {
      const naming = await getNamingConfig(projectId);
      // Cambio rápido de canvas entre proyectos: sólo aplica si sigue activo.
      // Doc 89: sin canvas abierto (activeProjectId null) también se cachea —
      // el Object Inspector aplica la regla de case al físico tipeado.
      const active = get().activeProjectId;
      if (active === projectId || active == null) set({ naming });
    } catch { /* sin config el front asume upper (default del backend) */ }
  },
  reload: async () => {
    const id = get().activeSaId; if (!id) return;
    const seq = ++_loadSeq;
    const asked = canvasClock();
    let loaded: Diagram;
    try {
      loaded = await mod.loadDiagram(id);
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
    // Doc 99: si algo del canvas se grabó después de pedir este diagrama, se
    // repone (la foto puede ser de antes de ese guardado).
    const diagram = withWrittenCanvas(loaded, asked);
    const prev = get().diagram;
    set({ diagram });
    // Doc 88 §2: un cambio ESTRUCTURAL del MISMO canvas (tabla/vista nueva,
    // borrada o renombrada, columnas) invalida el catálogo del Explorer; cambiar
    // de canvas no (el inventario es del proyecto, no del canvas).
    if (prev && prev.subjectArea.id === diagram.subjectArea.id && diagramSignature(prev) !== diagramSignature(diagram)) {
      get().bumpExplorer();
    }
  },
  saveLayout: async (tableId, pos) => {
    const saId = get().activeSaId; if (!saId) return;
    get().markDirty();
    // Doc 99: la posición queda también en el diagrama del store, EN SITIO (sin
    // cambiar su identidad, que re-armaría el canvas). El diagrama guarda el
    // layout de su última carga y el canvas se re-arma con él al pasar de
    // Logical a Physical o al guardar Model properties: sin esto el bloque
    // recién movido volvía a su sitio viejo hasta el siguiente reload — y un
    // trazo manual quedaba referido a una posición que ya no era la de pantalla.
    // Doc 100 (P6): en píxeles enteros, igual que lo que se graba.
    const at = wholePoint({ x: pos.x, y: pos.y });
    const sa = get().diagram?.subjectArea;
    if (sa && sa.id === saId) sa.layout = { ...(sa.layout ?? {}), [tableId]: at };
    await struct.setSubjectAreaLayout(saId, { [tableId]: at });
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
    // Doc 84 E: en modo visor el arrange es de ESTA sesión — ni dirty ni persistencia.
    const viewer = useSessionStore.getState().openMode === 'readonly';
    if (!viewer) get().markDirty();
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
    if (viewer) {
      // Se aplica a los nodos vivos y se recuerda por canvas (viewerLayout) para
      // que un re-armado del diagrama no lo pierda; nunca viaja al backend.
      // Doc 99: con todos los bloques en otro sitio, los trazos manuales
      // publicados ya no calzan — se ocultan en esta sesión (igual de efímero).
      set((st) => ({
        viewerLayout: { ...st.viewerLayout, [saId]: { ...(st.viewerLayout[saId] ?? {}), ...pos } },
        viewerRoutesOff: { ...st.viewerRoutesOff, [saId]: true },
      }));
      get().flow?.setNodes((nodes) => nodes.map((n) => (pos[n.id] ? { ...n, position: pos[n.id] } : n)));
      return;
    }
    // Doc 99: estado ANTES del arrange, para el Undo — posiciones de los nodos
    // vivos (las mismas que guarda Save) y trazos manuales del canvas.
    const prevRoutes = get().canvasRoutes;
    const prevLayout: Record<string, { x: number; y: number }> = {};
    for (const n of get().flow?.getNodes() ?? []) {
      if (n.type === 'table' || n.type === 'view' || n.type === 'subcat') {
        prevLayout[n.id] = { x: n.position.x, y: n.position.y };
      }
    }
    // Posiciones nuevas (MERGEA, M3a) y trazos REINICIADOS en una sola
    // escritura del canvas: nunca quedan posiciones nuevas con trazos viejos.
    await struct.arrangeSubjectArea(saId, pos);
    showRoutes(saId, () => ({}));
    pushUndo('Auto-arrange', async () => {
      await struct.arrangeSubjectArea(saId, prevLayout, prevRoutes);
      if (get().activeSaId !== saId) return;
      showRoutes(saId, () => prevRoutes);
      await get().reload();
    });
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
    await struct.addToCanvas(saId, { tableIds: [id] });
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
    // Doc 83: en modo Physical lo tipeado ES el físico → se persiste con la
    // regla de case del scope (el backend la aplica igual en el choke point);
    // el lógico queda tal cual. En modo Logical el motor ya la aplicó.
    const physical = input.mode === 'logical'
      ? (await gov.physicalize(input.logicalName)).physical
      : applyNamingCase(input.logicalName, get().naming?.column.case);
    const domains = await gov.listDomains();
    const dom = domains.find((d) => d.id === input.parentDomainId);
    const override = (input.dataType ?? '').trim();
    // Doc 64 r2: el default del dominio se HOMOLOGA a la grafía canónica
    // (espejo de canonicalize_default_type, doc 62) — un dominio legacy con
    // `Array` hereda `ARRAY<>`, no el texto crudo de la BD sin homologar.
    const domDefault = canonicalDefaultType(dom?.defaultDataType);
    const dataTypeBase = override || domDefault || '';
    // Doc 69 §4.9: faceta LÓGICA del tipo heredada del dominio (homologada).
    // Doc 86 D4: en modo Logical el popup manda el tipo lógico TIPEADO; si
    // difiere del lógico del dominio es un override lógico (regla doc 46).
    const domLogical = dom?.logicalDataType ? canonicalDefaultType(dom.logicalDataType) : '';
    const typedLogical = canonicalDefaultType(input.logicalDataType) || '';
    const logicalBase = typedLogical || domLogical;
    // Doc 96 D8: un complejo es el mismo en las dos facetas. Un complejo TIPEADO
    // va a las dos con la misma grafía homologada (gana al default del dominio,
    // `ARRAY<>` incluido); si no, el complejo con estructura de una faceta
    // completa a la otra (p. ej. el `ARRAY<>` genérico de un dominio).
    const typed = input.mode === 'logical' ? (input.logicalDataType ?? '').trim() : override;
    const typedComplex = isComplexTypeStart(typed) ? canonicalDefaultType(typed) : '';
    const dataType = typedComplex || (input.mode === 'logical' ? mirrorComplex(typedLogical, dataTypeBase) : dataTypeBase);
    const logicalType = typedComplex || (input.mode === 'physical' ? mirrorComplex(override, logicalBase) : logicalBase);
    const logicalOverridden = !!dom && !!logicalType && logicalType !== domLogical;
    // Al FINAL del orden físico (antes: ordinal 0 → la columna nueva caía al
    // INICIO de la tabla) — coherente con la propagación a vistas de abajo.
    // Doc 94 D2: una PK nueva entra tras la ÚLTIMA PK y las no-PK se corren en
    // el MISMO lote (la tabla queda PK primero).
    const siblings = (get().diagram?.columns ?? []).filter((c) => c.tableId === tableId);
    const layout = input.isPrimaryKey ? pkFirstOrdinals(siblings, { toKey: [id], add: [{ id }] }) : null;
    const ordinal = layout ? layout.get(id)!
      : siblings.length ? Math.max(...siblings.map((c) => c.ordinal)) + 1 : 0;
    const shifts = siblings.filter((c) => layout?.has(c.id)).map((c) => gov.bulk.createColumn({ ...c, ordinal: layout!.get(c.id)! }));
    // Metadata del alta (doc 40): payload LIMPIO como en edición — flags solo
    // cuando se apartan del default (nullable true ES el default: no viaja),
    // description/udpValues solo con contenido.
    const description = (input.description ?? '').trim();
    const physicalDescription = (input.physicalDescription ?? '').trim();
    const payload: CanonicalColumn = {
      id, tableId, logicalName: input.logicalName, physicalName: physical,
      // Doc 64 §1: el popup ahora muestra el default del dominio en el campo de
      // tipo — "mandaron dataType" ya no equivale a override. Con dominio, el
      // override real es tipo ≠ default (regla doc 46); sin dominio, un tipo
      // tipeado conserva la semántica previa (override).
      parentDomainId: input.parentDomainId || undefined, dataType,
      typeOverridden: dom ? dataType.trim() !== domDefault : !!override,
      ...(logicalType ? { logicalDataType: logicalType, logicalTypeOverridden: logicalOverridden } : {}),
      ordinal,
      ...(description ? { description } : {}),
      ...(physicalDescription ? { physicalDescription } : {}),   // doc 85
      ...(input.isPrimaryKey ? { isPrimaryKey: true } : {}),
      ...(input.isForeignKey ? { isForeignKey: true } : {}),
      ...(input.isNullable === false ? { isNullable: false } : {}),
      ...(input.isPartition ? { isPartition: true } : {}),
      ...(input.udpValues && Object.keys(input.udpValues).length ? { udpValues: input.udpValues } : {}),
    };
    if (shifts.length) await gov.recordChangesBulk([gov.bulk.createColumn(payload), ...shifts]);
    else await gov.createColumn(payload);
    // V1 (doc 19 §12b): la columna nueva entra AUTOMÁTICAMENTE a las vistas
    // ESPEJO de la tabla (las que reflejan TODAS sus columnas) — al final, o
    // tras las PK si es PK (doc 94 D4). Las vistas curadas (subset deliberado)
    // no se tocan. Best-effort: un fallo acá no bloquea el alta (queda "Match
    // physical order" para alinear).
    try {
      const touched = await syncNewColumnToMirrorViews(
        { listViews: viewsSvc.listViews, updateView: viewsSvc.updateView },
        tableId, physical, siblings, !!input.isPrimaryKey,
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
  addExistingTables: async (tableIds: string[], opts) => {
    const saId = get().activeSaId; if (!saId || tableIds.length === 0) return;
    get().markDirty();
    // Doc 70: la membresía de vistas parte de la lista MATERIALIZADA del
    // diagrama (un canvas legacy la recibe resuelta por el backend). Importar
    // una tabla NO arrastra sus vistas — sólo si el usuario lo pide.
    const shown = get().diagram?.subjectArea.viewIds;
    const withViews = opts?.withViews
      ? (await viewsSvc.listViewsForTables(tableIds).catch(() => [] as View[])).map((v) => v.id)
      : [];
    // Doc 100: la lista completa la arma el servicio DENTRO de la cola del
    // canvas y devuelve lo REALMENTE agregado: la inversa del Undo no debe
    // sacar del canvas una tabla o vista que ya vivía acá.
    const added = await struct.addToCanvas(saId, { tableIds, viewIds: withViews }, shown);
    await get().reload();
    // Selecciona la primera importada → al frente (zIndex) y visible (owner).
    set({ selectedTableId: tableIds[0], selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });
    if (added.tableIds.length || added.viewIds.length) {
      const nt = added.tableIds.length;
      const nv = added.viewIds.length;
      const what = [
        nt ? `${nt} table${nt === 1 ? '' : 's'}` : '',
        nv ? `${nv} view${nv === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' + ');
      // La lista de vistas es la de ESTE canvas al importar: el Undo puede
      // correr con otro canvas abierto (la pila sobrevive al cambio de canvas).
      pushUndo(`Add ${what} to canvas`, async () => {
        await struct.removeFromCanvas(saId, added, shown);
        await get().reload();
      });
    }
  },
  addViewsToCanvas: async (viewIds) => {
    const saId = get().activeSaId; if (!saId || viewIds.length === 0) return;
    const shown = get().diagram?.subjectArea.viewIds ?? [];
    if (viewIds.every((v) => shown.includes(v))) return;          // ya eran miembros
    get().markDirty();
    // Doc 100: la lista completa la arma el servicio dentro de la cola.
    const added = await struct.addToCanvas(saId, { viewIds }, shown);
    await get().reload();
    const n = added.viewIds.length;
    if (!n) return;
    pushUndo(`Add ${n} view${n === 1 ? '' : 's'} to canvas`, async () => {
      await struct.removeFromCanvas(saId, { viewIds: added.viewIds }, shown);
      await get().reload();
    });
  },
  removeViewFromCanvas: async (viewId) => {
    const saId = get().activeSaId; if (!saId) return;
    const shown = get().diagram?.subjectArea.viewIds ?? [];
    if (!shown.includes(viewId)) return;
    get().markDirty();
    // Para el Undo (doc 50): nombre y posición ANTES de quitarla.
    const name = get().diagram?.views.find((v) => v.id === viewId)?.name ?? 'view';
    const node = get().flow?.getNode(viewId);
    const pos = node ? { x: Math.round(node.position.x), y: Math.round(node.position.y) } : null;
    await struct.removeFromCanvas(saId, { viewIds: [viewId] }, shown);
    if (get().selectedViewId === viewId) set({ selectedViewId: null });
    await get().reload();
    // Doc 100: vuelve con su posición en UNA escritura (lista de vistas de ESTE
    // canvas, no la del que esté abierto al deshacer).
    pushUndo(`Remove ${name} from canvas`, async () => {
      await struct.addToCanvas(saId, { viewIds: [viewId], ...(pos ? { layout: { [viewId]: pos } } : {}) }, shown);
      await get().reload();
    });
  },
  createTableFromSources: ({ logicalName, schema, columns }) => runBlocking('Creating table…', async () => {
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
    // relationship en la tabla nueva) ni vistas. Doc 94: ordinal secuencial en
    // el orden elegido con las PK PRIMERO (sort estable). Claves opcionales
    // solo si aportan (payload limpio, patrón addColumn del doc 40).
    let ordinal = 0;
    const pkFirst = [...columns.filter((c) => c.isPrimaryKey), ...columns.filter((c) => !c.isPrimaryKey)];
    await gov.recordChangesBulk([
      gov.bulk.createTable(
        { id, logicalName, physicalName: physical, schema: schema?.trim() || undefined },
        { kind: 'ctas' }),
      ...pkFirst.map((c) => {
        const description = (c.description ?? '').trim();
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
        // Procedencia (doc 51): "Created from source <tabla>.<col> (CTAS)".
        }, { kind: 'ctas', ...(c.sourceTable ? { sourceTable: c.sourceTable } : {}), sourceColumn: c.physicalName });
      }),
    ]);
    await struct.addToCanvas(saId, { tableIds: [id] });
    await get().reload();
    set({ selectedTableId: id, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });   // al frente + visible (owner)
    pushUndo(`Create table ${physical}`, () => get().deleteTable(id));
  }),
  setColumnTarget: (id: string | null) => set({ columnTarget: id }),
  // Seleccionar tabla o edge cambia de contexto: cierra el panel de columna.
  setSelectedTable: (id) => set({ selectedTableId: id, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null }),
  setSelectedEdge: (id) => set({ selectedEdgeId: id, selectedTableId: null, selectedColumnId: null, selectedViewId: null }),
  removeTableFromArea: async (tableId) => {
    get().markDirty();
    const saId = get().activeSaId; if (!saId) return;
    // Para el Undo (doc 50): nombre y posición ANTES de quitarla (el remove
    // también borra su entrada del layout).
    const d = get().diagram;
    const name = d?.tables.find((t) => t.id === tableId)?.physicalName ?? 'table';
    const flow = get().flow;
    const posOf = (id: string) => {
      const n = flow?.getNode(id);
      return n ? { x: Math.round(n.position.x), y: Math.round(n.position.y) } : null;
    };
    const pos = posOf(tableId);
    // Doc 70: las vistas que quedan SIN fuente en el canvas salen con la tabla
    // (siguen en el modelo). La membresía parte de la lista materializada.
    const remaining = (d?.subjectArea.tableIds ?? []).filter((t) => t !== tableId);
    const orphans = orphanViewIds(d?.views ?? [], remaining);
    const orphanPos = Object.fromEntries(orphans.map((vid) => [vid, posOf(vid)] as const).filter(([, p]) => p));
    // Doc 99: los trazos manuales de los wires de la tabla salen con ella (si
    // vuelve al canvas en otra posición ya no calzarían); el Undo los repone.
    const wireIds = wireIdsOfTable(d?.relationships ?? [], tableId);
    const droppedRoutes = routesOf(get().canvasRoutes, wireIds);
    // quita de tableIds + layout (+ vistas huérfanas) (+ trazos de sus wires).
    // Doc 100: las listas las arma el servicio dentro de la cola del canvas.
    const shown = d?.subjectArea.viewIds;
    await struct.removeFromCanvas(saId, {
      tableIds: [tableId], viewIds: orphans, ...(Object.keys(droppedRoutes).length ? { dropRouteIds: wireIds } : {}),
    }, shown);
    // Doc 100: la inversa es UNA escritura (antes hasta 4: tablas, vistas,
    // posiciones y trazos, cada una leyendo el canvas por su cuenta). Las vistas
    // son las de ESTE canvas al sacar la tabla (el Undo puede correr con otro
    // canvas abierto) y sólo cuentan si salieron huérfanas: sin ellas, un canvas
    // sin lista explícita (doc 70) sigue sin lista.
    pushUndo(`Remove ${name} from canvas`, async () => {
      const layout = { ...(pos ? { [tableId]: pos } : {}), ...orphanPos } as Record<string, { x: number; y: number }>;
      await struct.addToCanvas(saId, { tableIds: [tableId], viewIds: orphans, layout, routes: droppedRoutes },
        orphans.length ? shown : undefined);
      await get().reload();
    });
    if (get().selectedTableId === tableId) set({ selectedTableId: null, selectedColumnId: null, selectedViewId: null });
    await get().reload();
  },
  deleteTable: (tableId, opts) => runBlocking('Deleting table…', async () => {
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
    // Doc 89: sin canvas (inspector) la pre-imagen viene del dossier efectivo.
    const t0 = get().diagram?.tables.find((x) => x.id === tableId) ?? opts?.pre;
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
    // Sacar de TODOS los canvases que la contienen (tableIds + layout). Doc 99:
    // y con ella los trazos manuales de sus wires (las relaciones de arriba se
    // borran; sus trazos quedarían huérfanos en cada canvas).
    const usage = await gov.tableUsage(tableId).then((u) => u.usage).catch(() => []);
    const wireIds = wireIdsOfTable(rels, tableId);
    const droppedRoutes = routesOf(get().canvasRoutes, wireIds);   // del canvas ACTIVO, para el Undo
    for (const u of usage) {
      await struct.removeFromCanvas(u.canvasId, { tableIds: [tableId], ...(wireIds.length ? { dropRouteIds: wireIds } : {}) });
    }
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
        // Doc 100: una escritura por canvas, dentro de su cola. La posición y
        // los trazos (doc 99) sólo vuelven al canvas activo.
        for (const u of usage) {
          const active = u.canvasId === undoSaId;
          try {
            await struct.addToCanvas(u.canvasId, {
              tableIds: [tableId],
              ...(active && undoPos ? { layout: { [tableId]: undoPos } } : {}),
              ...(active ? { routes: droppedRoutes } : {}),
            });
          } catch { /* el canvas pudo desaparecer */ }
        }
        await get().reload();
        get().syncExplorer(usage.some((u) => u.canvasId === get().activeSaId));
      });
    }
    if (get().selectedTableId === tableId) set({ selectedTableId: null, selectedColumnId: null, selectedViewId: null });
    await get().reload();
    // Doc 89 §3.6: si la tabla NO estaba en el canvas activo (o no hay canvas —
    // borrado desde el Object Inspector), reload() no cambia ninguna firma → el
    // Explorer se refresca a mano. Regla complementaria a la del doc 88 §2.
    get().syncExplorer(usage.some((u) => u.canvasId === get().activeSaId));
  }),
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
    // Doc 94 D2: entrar o salir de la llave re-ubica la columna en la frontera
    // del bloque de PK — ella y las que se corren viajan en UN lote, con UN Undo.
    if (fields.isPrimaryKey !== undefined && !!fields.isPrimaryKey !== !!c.isPrimaryKey) {
      const mine = (get().diagram?.columns ?? []).filter((x) => x.tableId === c.tableId);
      const { changes, pres } = keyLayoutBulk(mine, { [colId]: fields });
      await gov.recordChangesBulk(changes);
      pushUndo(`Edit column ${c.physicalName}`, async () => {
        await gov.recordChangesBulk(pres.map((p) => gov.bulk.createColumn(p)));
        await get().reload();
      });
      await get().reload();
      return;
    }
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
    const dia = get().diagram; if (!dia) return;
    const mine = dia.columns.filter((c) => c.tableId === tableId);
    // Doc 94 D3: una PK nunca queda debajo de una no-PK (guard final: los
    // paneles ya lo impiden al arrastrar).
    if (!isPkFirst(mine, orderedIds)) {
      toast.error("A primary key column can't go below a column that isn't part of the key.");
      return;
    }
    get().markDirty();
    // OPTIMISTA: la UI reordena al soltar (posición = índice nuevo, local); la
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
    // Persistí SOLO las columnas cuya posición cambió, en TANDAS de 5: mover una
    // columna al tope de una tabla de 30 disparaba 30 PUT simultáneos (ráfaga
    // que con varios usuarios satura el backend). El backend graba cada
    // cambio con $set atómico por entidad, así que no se pisan entre sí.
    const changed = reorderPlan(mine, orderedIds);
    await persistReorder(changed, (c, idx) => gov.updateColumn({ ...c, ordinal: idx }));
    if (changed.length) {
      // Undo POR VALOR (doc 50): las pre-imágenes de las columnas movidas
      // vuelven a su ordinal tal cual, SIN pasar por la guarda «PK primero» —
      // el estado previo pudo ser un dato viejo desordenado, o la llave pudo
      // cambiar en el medio (drop en el canvas: llave + reorden).
      const pres = sortByOrdinal(changed.map(({ c }) => ({ ...c })));
      pushUndo('Reorder columns', async () => {
        await persistReorder(pres.map((c) => ({ c, idx: c.ordinal })), (c) => gov.updateColumn(c));
        await get().reload();
      });
    }
    await get().reload();
  },
  applyCanvasDrop: async (tableId, plan) => {
    // Doc 73 §10.4 — drop de una fila en el bloque: los cambios de LLAVE van
    // por el mismo camino que el panel (gov.updateColumn + Undo por valor,
    // doc 50) y después el reorden de columnas (reorderColumns).
    const dia = get().diagram; if (!dia) return;
    if (plan.key.length) {
      get().markDirty();
      const pres: CanonicalColumn[] = [];
      const flags = new Map(plan.key.map((k) => [k.id, k.isPrimaryKey]));
      for (const step of plan.key) {
        const col = dia.columns.find((c) => c.id === step.id);
        if (!col) continue;
        pres.push({ ...col });
        await gov.updateColumn({ ...col, isPrimaryKey: step.isPrimaryKey });
      }
      // OPTIMISTA (doc 94): la llave nueva ya en el diagrama local, así el
      // reorden de abajo valida «PK primero» contra ella.
      set({ diagram: { ...dia, columns: dia.columns.map((c) => (flags.has(c.id) ? { ...c, isPrimaryKey: flags.get(c.id) } : c)) } });
      if (pres.length) {
        pushUndo('Edit key', async () => { for (const c of pres) await gov.updateColumn(c); await get().reload(); });
      }
      if (!plan.order) await get().reload();
    }
    if (plan.order) await get().reorderColumns(tableId, plan.order);
  },
  deleteColumn: async (colId, relIds = [], opts) => {
    get().markDirty();
    // Primero las relaciones (elegidas en el dialog de impacto), después la
    // columna: el changeset nunca queda con pares colgando de una columna
    // borrada (spec 10 §8). v2 (doc 19): si la relación tiene MÁS pares, sólo
    // se quita el par de esta columna; si era el último, se borra completa.
    const col = get().diagram?.columns.find((c) => c.id === colId) ?? opts?.col;
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
    const fkCandidates = new Map<string, string>();   // childColumnId → childTableId
    for (const rid of relIds) {
      const rel = pool.find((r) => r.id === rid);
      const dropped = rel?.pairs.filter(
        (p) => p.parentColumnId === colId || p.childColumnId === colId) ?? [];
      const remaining = rel?.pairs.filter(
        (p) => p.parentColumnId !== colId && p.childColumnId !== colId) ?? [];
      dropped.forEach((p) => { if (p.childColumnId !== colId && rel) fkCandidates.set(p.childColumnId, rel.childTableId); });
      if (rel && remaining.length > 0 && remaining.length < rel.pairs.length) {
        await gov.updateRelationship({ ...rel, pairs: remaining });
      } else {
        await gov.deleteRelationship(rid);
      }
    }
    for (const [cid, ctid] of fkCandidates) {
      // Doc 89: la hija puede no estar en el diagrama (inspector sin canvas u
      // otra tabla fuera de este canvas) → se resuelve por API, como deleteTable.
      const c = get().diagram?.columns.find((x) => x.id === cid)
        ?? (await gov.listColumns(ctid).catch(() => [] as CanonicalColumn[])).find((x) => x.id === cid);
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
        get().syncExplorer(!!get().diagram?.tables.some((t) => t.id === colPre.tableId));
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
    // Doc 89 §3.6: tabla fuera del canvas activo (o sin canvas) → tick a mano.
    get().syncExplorer(!!col && !!get().diagram?.tables.some((t) => t.id === col.tableId));
  },
  // Doc 53: la subcategoría es exclusiva del modelo lógico — pasar a físico
  // desarma la herramienta (el botón del toolbar también se deshabilita).
  // Doc 63: las vistas son exclusivas del físico — entrar a lógico cierra
  // el panel de vista (su bloque desaparece del canvas).
  setViewMode: (m: 'logical' | 'physical') =>
    set(m === 'physical' ? { viewMode: m, subcatArmed: false } : { viewMode: m, selectedViewId: null }),
  createSubjectArea: async (name: string) => {
    const pid = get().activeProjectId;
    if (!pid) throw new Error('Pick a Project first');
    const sa = await struct.createSubjectArea(pid, name);
    await get()._refreshProject(pid);
    await get().selectSubjectArea(sa.id);
  },
}));

// ── Doc 99: trazos manuales de wires ───────────────────────────────────────

/** Cuántos wires del canvas abierto tienen trazo manual (aviso del auto-arrange). */
export const manualRouteCount = (s: Pick<ModelerState, 'canvasRoutes'>): number =>
  Object.keys(s.canvasRoutes).length;

/** Los trazos de `ids` que existen en `routes`. */
function routesOf(routes: WireRoutes, ids: string[]): WireRoutes {
  const out: WireRoutes = {};
  for (const id of ids) {
    const route = routeOf(routes, id);
    if (route) out[id] = route;
  }
  return out;
}

/** Un diagrama pedido ANTES de que terminara un guardado del canvas puede
 *  traer la posición o el trazo de antes: se reponen los grabados. Las
 *  posiciones se mezclan (lo grabado encima); los trazos se reemplazan — un
 *  trazo recién quitado no tiene que volver. */
function withWrittenCanvas(diagram: Diagram, asked: number): Diagram {
  const session = useSessionStore.getState();
  const cs = session.openMode === 'editing' ? session.activeChangesetId : null;
  const fresh = writtenSince(cs, diagram.subjectArea.id, asked);
  if (!fresh) return diagram;
  const sa = diagram.subjectArea;
  return { ...diagram, subjectArea: { ...sa, layout: { ...(sa.layout ?? {}), ...fresh.layout }, routes: fresh.routes } };
}

/** Guardado EN VUELO del trazo de un wire.
 *  · `points` — lo que el usuario dejó en pantalla (null = lo quitó).
 *  · `base`   — lo último GRABADO que se conoce de ese wire: a eso vuelve la
 *               pantalla si el guardado falla. `undefined` = no se sabe (su
 *               canvas no estaba abierto cuando se pidió el guardado). */
interface RouteTicket { points: RoutePoint[] | null; base: RoutePoint[] | null | undefined }

/** Guardados en vuelo, por canvas y por wire. Un diagrama que llega mientras
 *  tanto puede traer todavía el trazo viejo — manda el pendiente, que es lo
 *  que el usuario acaba de dejar en pantalla. Cada entrada es la ficha del
 *  ÚLTIMO guardado pedido para ese wire: su identidad dice si un guardado que
 *  termina sigue siendo el vigente. */
const _pendingRoutes = new Map<string, Map<string, RouteTicket>>();

/** Trazos a pintar para un diagrama recién llegado: los del canvas, saneados y
 *  solo de wires que existen, con los guardados en vuelo encima. De paso, cada
 *  guardado en vuelo se entera de qué hay grabado según ESTE diagrama. */
function seedRoutes(diagram: Diagram | null): WireRoutes {
  if (!diagram) return {};
  const valid = new Set(routableWireIds(diagram.relationships));
  const base = pruneRoutes(cleanRoutes(diagram.subjectArea.routes), valid);
  const pending = _pendingRoutes.get(diagram.subjectArea.id);
  if (!pending?.size) return base;
  const out = { ...base };
  for (const [id, ticket] of pending) {
    ticket.base = routeOf(base, id) ?? null;
    if (ticket.points && valid.has(id)) out[id] = ticket.points; else delete out[id];
  }
  return out;
}

/** Cambia los trazos EN PANTALLA del canvas `saId` (no hace nada si hay otro
 *  abierto). El diagrama del store guarda el canvas de su última carga: se le
 *  deja el trazo al día EN SITIO — sin cambiar su identidad, que re-armaría
 *  todo el canvas — para que el código que copia ese canvas para cambiarle un
 *  campo (guardar Model properties) no re-siembre trazos viejos. */
function showRoutes(saId: string, change: (cur: WireRoutes) => WireRoutes): void {
  useModelerStore.setState((st) => {
    if (st.activeSaId !== saId) return {};
    const routes = change(st.canvasRoutes);
    if (st.diagram?.subjectArea.id === saId) st.diagram.subjectArea.routes = routes;
    return { canvasRoutes: routes };
  });
}

/** Pinta y graba el trazo de un wire. Si el guardado falla la pantalla vuelve
 *  a lo último GRABADO — no a lo que se veía antes del gesto, que puede ser el
 *  trazo de otro gesto cuyo guardado también falló — y re-lanza. El fallo de un
 *  guardado VIEJO no pisa un trazo más nuevo del mismo wire (gana el último
 *  pedido). Con otro canvas abierto graba igual, sin tocar la pantalla. */
async function writeWireRoute(
  saId: string, wireId: string, value: RoutePoint[] | null, validIds?: Iterable<string>,
): Promise<void> {
  const paint = (points: RoutePoint[] | null) => showRoutes(saId, (cur) => {
    const routes = { ...cur };
    if (points) routes[wireId] = points; else delete routes[wireId];
    return routes;
  });
  const pending = _pendingRoutes.get(saId) ?? new Map<string, RouteTicket>();
  _pendingRoutes.set(saId, pending);
  const earlier = pending.get(wireId);
  const st = useModelerStore.getState();
  const ticket: RouteTicket = {
    points: value,
    // Con un guardado del mismo wire en vuelo, lo que se ve es SU trazo, aún
    // sin grabar: la base es la de él. Sin ninguno, lo que se ve está grabado.
    base: earlier ? earlier.base : st.activeSaId === saId ? routeOf(st.canvasRoutes, wireId) ?? null : undefined,
  };
  const latest = () => pending.get(wireId) === ticket;
  pending.set(wireId, ticket);
  try {
    paint(value);
    await struct.setWireRoute(saId, wireId, value, validIds);
    // Grabado: pasa a ser la base de lo que siga en vuelo para este wire.
    const next = pending.get(wireId);
    if (next && next !== ticket) next.base = value;
  } catch (e) {
    if (latest() && ticket.base !== undefined) paint(ticket.base);
    throw e;
  } finally {
    if (latest()) pending.delete(wireId);
    if (!pending.size && _pendingRoutes.get(saId) === pending) _pendingRoutes.delete(saId);
  }
}

// Siembra: cada vez que cambia el CANVAS del diagrama (abrir, recargar, cerrar)
// los trazos se toman de él, y el canvas del diagrama queda con los mismos
// trazos que la pantalla (EN SITIO, como en `showRoutes`). No re-siembran: un
// cambio local del diagrama que conserva el mismo `subjectArea` (reorden
// optimista de columnas) ni una COPIA local del canvas (guardar Model
// properties), que trae los mismos trazos que ya están en pantalla.
useModelerStore.subscribe((s, prev) => {
  const sa = s.diagram?.subjectArea;
  if (sa === prev.diagram?.subjectArea) return;
  if (sa && sa.routes === s.canvasRoutes) return;
  const routes = seedRoutes(s.diagram);
  if (sa) sa.routes = routes;
  useModelerStore.setState({ canvasRoutes: routes });
});

// Doc 48: el clipboard de columnas pertenece al changeset donde se copió —
// cambiar de changeset (o soltarlo) lo invalida, junto con la selección y el
// popup. Doc 50: ídem el clipboard de TABLA y la pila de Undo (las inversas
// apuntan al draft anterior). Suscripción a nivel de módulo (useSessionStore
// no importa este store, así que no hay ciclo). Doc 75 D14: la sesión es la
// ÚNICA fuente del changeset activo.
useSessionStore.subscribe((s, prev) => {
  if (s.activeChangesetId === prev.activeChangesetId) return;
  useModelerStore.setState({ colClipboard: null, tblClipboard: null, colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null });
  useUndoStore.getState().clear();
});

/**
 * Arma el árbol del Model Explorer del proyecto activo a partir del estado plano
 * `folders`/`subjectAreas`: project → carpetas anidadas (por `parentFolderId`) →
 * canvases (por `folderId`; los de `folderId == null` cuelgan de la raíz). Doc
 * 92 D1: carpetas (= subject areas de Erwin, doc 88 §7) y canvases se ordenan
 * ALFABÉTICAMENTE (case-insensitive); `order` (el orden de Erwin que estampa
 * el kit) queda sólo como desempate.
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
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b);
  const sortF = (a: Folder, b: Folder) => byName(a.name, b.name) || a.order - b.order;
  const sortC = (a: SubjectArea, b: SubjectArea) => byName(a.name, b.name);
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

/** Doc 72: objeto abierto en el Object Inspector (sin canvas). Una columna
 *  abre el inspector de su tabla con la columna preseleccionada. */
export interface InspectTarget { kind: 'table' | 'view'; id: string; colId?: string | null }

