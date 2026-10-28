import { create } from 'zustand';
import { toast } from 'sonner';
import type { Node, ReactFlowInstance } from '@xyflow/react';
import * as mod from '@/features/modeler/services/modeler.service';
// Estructura (projects/folders/canvases) con soporte de changeset: en sesión
// de edición registra al changeset; con changeset activo lee el estado efectivo.
import * as struct from '@/features/modeler/services/structure.service';
import * as schemasSvc from '@/features/modeler/services/schemas.service';
import type { DbSchema } from '@/features/modeler/services/schemas.service';
import { invalidateTableSchemas } from '@/features/modeler/services/schemaPartition';
import type { Diagram, Drawing, DrawingType, Folder, Project, SubjectArea } from '@/features/modeler/services/modeler.service';
import * as gov from '@/services/governance.service';
import { onDraftWrite } from '@/services/changeset.service';
import { trackDraftWork } from '@/services/draftWork';
import type { CanonicalColumn, CanonicalTable } from '@/services/governance.service';
import { getNamingConfig, type NamingConfig } from '@/services/naming.service';
import { facetName, facetNouns } from '@/lib/facets';
import { applyNamingCase } from '@/features/modeler/lib/physicalCase';
import { diagramSignature } from '@/features/modeler/lib/diagramSignature';
import { editedTables, isSlice, membershipChanged, mergeSlice, noEdits } from '@/features/modeler/lib/diagramSlice';
import { copyNameBase, copyTableToBulk, pasteNames } from '@/features/modeler/lib/copyTable';
import { keyLayoutBulk } from '@/features/modeler/lib/keyLayout';
import { canonicalDefaultType } from '@/features/modeler/lib/typePick';
import { mirrorComplex } from '@/features/modeler/lib/facetTypes';
import { isComplexTypeStart } from '@/features/modeler/lib/complexTypes';
import { orphanViewIds } from '@/features/modeler/lib/canvasViews';
import { avoidStacking, blockSpot, canvasView, cascade, focusViewport, insideRect, paneSize, type FlowBox, type FlowViewport, type Point, type StackBox } from '@/features/modeler/lib/canvasFocus';
import { dblClickShield } from '@/features/modeler/lib/dblClickShield';
import { pinsForEntering, pinsForLeaving, seenAt } from '@/features/modeler/lib/placeNewMembers';
import { FRESH_GENERATIONS } from '@/features/modeler/lib/nodeZ';
import { tableLodSize, viewLodSize } from '@/features/modeler/lib/lodSize';
import { viewSourceIds } from '@/features/modeler/lib/viewGraph';
import { isPkFirst, orderColumns, persistReorder, pkFirstOrdinals, reorderPlan, sortByOrdinal } from '@/features/modeler/lib/columnOrder';
import type { CanvasDropPlan } from '@/features/modeler/lib/canvasDrop';
import { canvasClock, wholePoint, writtenSince } from '@/features/modeler/lib/canvasWrites';
import {
  afterRevalidation, isVersionError, pinSession, stillAskedSession, touchesVersion, type SessionPin,
} from '@/features/modeler/lib/sessionGuard';
import { columnStep, lotStep, pinnedViewDeps } from '@/features/modeler/lib/pinnedWrites';
import {
  cleanRoute, cleanRoutes, pruneRoutes, routableWireIds, routeOf, sameRoute, wireIdsOfTable,
} from '@/features/modeler/lib/wireRoute';
import type { RoutePoint, WireRoutes } from '@/features/modeler/lib/wireRoute';
import {
  namesLeavingTable, removeColumnsSources, restoreColumnsSources, syncNewColumnToMirrorViews,
  type RemovedColumn,
} from '@/features/modeler/lib/viewSync';
import * as viewsSvc from '@/services/views.service';
import type { View, ViewInput } from '@/services/views.service';
import { useSessionStore } from '@/store/useSessionStore';
import { NothingDoneError, freshStep, pushUndo, useUndoStore, type HistoryStep } from '@/store/useUndoStore';
import { cleanColors, normalColor, themeIndex, type Theme } from '@/lib/colors';
import { listThemes } from '@/services/themes.service';
import { runBlocking } from '@/store/useBusyStore';
import { ApiError, errorReason } from '@/services/http';

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

/** Alta de columna (popup "New column"): además del nombre/dominio/
 *  tipo, el popup captura la metadata completa — definición funcional, flags
 *  y UDPs — para no obligar a pasar por Properties · Columns tras crear. */
export interface AddColumnInput {
  logicalName: string;
  mode: 'logical' | 'physical';
  parentDomainId?: string;
  dataType?: string;
  /** Tipo lógico tipeado en modo Logical (override lógico explícito); ausente = el del dominio. */
  logicalDataType?: string;
  description?: string;
  /** Comment físico heredado del dominio estándar (se edita luego en Properties). */
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
   * Cache por proyecto del árbol del explorer (folders + canvases), independiente
   * del proyecto activo: permite expandir varios proyectos a la vez sin tocar la
   * sesión del canvas. `folders`/`subjectAreas` espejan el proyecto activo.
   */
  trees: Record<string, { folders: Folder[]; subjectAreas: SubjectArea[] }>;
  /** Canvas cuya apertura está en vuelo (spinner en el explorer). */
  openingSaId: string | null;
  /** Sube cuando cambia la estructura del canvas activo (tabla o vista
   *  nueva, borrada o renombrada, columnas) o al pulsar Refresh — el
   *  catálogo del Explorer (inventario cacheado) lo usa para invalidarse. */
  explorerTick: number;
  bumpExplorer: () => void;
  /** Tras un cambio estructural ya persistido, refresca el Explorer solo si
   *  el objeto no está en el canvas activo — si está, `reload()` ya subió el
   *  tick al cambiar la firma del diagrama. Nunca ambos. */
  syncExplorer: (onActiveCanvas: boolean) => void;
  /** Esquemas efectivos de la versión activa: alimenta los dropdowns
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
  /** Naming config (separador/case por scope) del proyecto activo — se
   *  carga al abrir un canvas; el popup New column y el panel Properties
   *  aplican `column.case` al físico tipeado. null = sin cargar. */
  naming: NamingConfig | null;
  relPreset: { parent: gov.Cardinality; child: gov.Cardinality; identifying: boolean } | null;
  setRelPreset: (p: ModelerState['relPreset']) => void;
  /** Herramienta de subcategoría armada: drag desde la cabecera del
   *  supertipo (o desde un símbolo existente) hacia el subtipo. Exclusión
   *  mutua con `relPreset`; solo tiene sentido en modelo lógico — pasar a
   *  físico la desarma (setViewMode). */
  subcatArmed: boolean;
  setSubcatArmed: (on: boolean) => void;
  hoverEdgeId: string | null;
  hoverNodeId: string | null;
  setHoverEdge: (id: string | null) => void;
  setHoverNode: (id: string | null) => void;
  // ── Copy/paste de columnas entre bloques ───────────────────────────────
  /** Selección de filas en el bloque del canvas: una tabla fuente a la vez.
   *  `anchor` = última fila clickeada (extremo fijo del rango con Shift). */
  colSel: { tableId: string; ids: string[]; anchor: string } | null;
  toggleColSelect: (tableId: string, colId: string, mode: 'single' | 'toggle' | 'range') => void;
  clearColSel: () => void;
  /** Clipboard en memoria (snapshot por valor, orden físico de la fuente) —
   *  no es el portapapeles del SO. Sobrevive al cambio de canvas, de versión y
   *  de proyecto (se pega en otro proyecto tras su revisión); lo limpia el
   *  logout. `source`: la tabla y el proyecto de donde se copió. */
  colClipboard: { source: { logicalName: string; physicalName: string } & Partial<ClipSource>; cols: CanonicalColumn[] } | null;
  /** Copia la selección actual al clipboard. Devuelve cuántas columnas. */
  copySelectedColumns: () => number;
  /** Clipboard de tabla completa: snapshot por valor (tabla + sus
   *  columnas en orden físico). Mutuamente excluyente con `colClipboard` —
   *  un solo "contenido copiado", Ctrl/Cmd+V nunca es ambiguo. Mismo ciclo de
   *  vida que el de columnas; `source` = el proyecto de donde se copió. */
  tblClipboard: { table: CanonicalTable; cols: CanonicalColumn[]; source?: ClipSource } | null;
  /** Copia el bloque al clipboard de tabla. Devuelve el nombre a mostrar, o
   *  null si la tabla no está en el diagrama. Copiar es lectura (vale en
   *  readonly), igual que el copy de columnas. */
  copyTable: (tableId: string) => string | null;
  /** Pega el clipboard de tabla como tabla nueva en el canvas activo: misma
   *  metadata de las dos facetas, sin relaciones ni flag FK, en un solo lote.
   *  `prepared` = lo que mostró el popup de pegado (tabla, columnas y el
   *  esquema a crear); sin él, el clipboard tal cual. Nombre: el original si
   *  está libre en el proyecto; si no, `_copy_n`. Devuelve el nombre mostrado,
   *  o null si ya hay un paste en vuelo. */
  pasteTable: (prepared?: TablePastePrepared) => Promise<string | null>;
  /** El popup de pegado de tabla está abierto (lo monta ModelerCanvas). */
  tablePasteOpen: boolean;
  setTablePasteOpen: (open: boolean) => void;
  /** Menú contextual del canvas (fila: colId; bloque: colId null). */
  /** `kind` = qué bloque abrió el menú (default tabla); una vista solo
   *  ofrece el color. */
  colMenu: { x: number; y: number; tableId: string; colId: string | null; kind?: 'table' | 'view' } | null;
  openColMenu: (m: { x: number; y: number; tableId: string; colId: string | null; kind?: 'table' | 'view' }) => void;
  closeColMenu: () => void;
  /** Tabla destino del paste en confirmación (monta PasteColumnsPopup). */
  pasteTarget: string | null;
  setPasteTarget: (id: string | null) => void;
  /** Deep-link del panel de tabla: columna a poner a la vista en
   *  Properties · Columns (pestaña + scroll, sin expandir — la edición vive
   *  en el panel de columna). Su productor es el botón Back del
   *  ColumnPropertiesPanel; el panel de tabla la consume (vuelve a null) al
   *  navegar — una sola vez. */
  panelFocusColId: string | null;
  setPanelFocusCol: (id: string | null) => void;
  /** Columna con su Properties abierto: cuando no es null, el sidebar
   *  muestra el ColumnPropertiesPanel en lugar del panel de tabla. Siempre
   *  pertenece a `selectedTableId` (los gestos que la setean parten de una
   *  tabla concreta). */
  selectedColumnId: string | null;
  setSelectedColumn: (id: string | null) => void;
  /** Vista con su Properties abierto: cuando no es null, el sidebar
   *  muestra el ViewPropertiesPanel (exclusión mutua con tabla/columna/edge —
   *  los setters cruzados se limpian entre sí). */
  selectedViewId: string | null;
  setSelectedView: (id: string | null) => void;
  /** Click simple en una fila del canvas: selecciona la tabla y abre
   *  directamente el Properties de esa columna. */
  focusColumnInPanel: (tableId: string, colId: string, opts?: { frame?: boolean }) => void;
  /** El buscador del Model (popup ⌘K) se abre desde el toolbar y desde la
   *  cabecera del Explorer — el estado vive aquí para que ambos lo compartan. */
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  /** La ficha del canvas abierto (Model properties: sus UDPs y sus colores)
   *  se abre desde el toolbar y desde el color en Properties. `boxes` = las
   *  cajas a pintar en ese canvas (Properties pasa la suya); sin `boxes`, las
   *  seleccionadas en el canvas. Se cierra sola al cambiar de canvas o de
   *  sesión: lo que muestra y graba es de un solo canvas. */
  modelProps: { saId: string; boxes?: string[] } | null;
  openModelProps: (boxes?: string[]) => void;
  /** Cierra la ficha; con `only`, solo si la abierta es esa (un Save lento de
   *  una ficha ya cerrada no cierra otra que se abrió después). */
  closeModelProps: (only?: { saId: string; boxes?: string[] }) => void;
  /** Navegación en curso hacia otro canvas (Locate): el Workspace muestra
   *  un overlay bloqueante hasta que el canvas cargó y centró. */
  navigating: { canvas: string; target?: string } | null;
  /** Objeto abierto en el Object Inspector (popup de solo lectura, sin canvas). */
  inspect: InspectTarget | null;
  openInspector: (t: InspectTarget) => void;
  closeInspector: () => void;
  /** Instancia de React Flow del canvas activo (la setea ModelerCanvas en onInit). */
  flow: ReactFlowInstance | null;
  setFlow: (rf: ReactFlowInstance | null) => void;
  /** Movimientos/arrange hechos en modo visor, por canvas — viven solo en
   *  esta sesión (memoria) y jamás se persisten; el canvas los pinta encima
   *  del layout publicado. Persistir es cosa de una edición publicada. */
  viewerLayout: Record<string, Record<string, { x: number; y: number }>>;
  setViewerPos: (saId: string, nodeId: string, pos: { x: number; y: number }) => void;
  /** Aviso «los movimientos en modo visor no se guardan»: una vez por sesión. */
  viewerHintShown: boolean;
  markViewerHint: () => void;
  /** Trazos manuales de los wires del canvas abierto (id del wire → puntos
   *  de quiebre). Se siembran del diagrama cada vez que llega uno (saneados,
   *  y solo de wires que existen) y cada wire lee el suyo por selector:
   *  cambiar un trazo re-pinta ese wire, no re-arma el canvas. */
  canvasRoutes: WireRoutes;
  /** Canvases donde un auto-arrange en modo visor movió todos los bloques
   *  en esta sesión — sus trazos publicados dejan de calzar y se ocultan
   *  (mismo alcance efímero que `viewerLayout`; nada se persiste). */
  viewerRoutesOff: Record<string, true>;
  /** Fija el trazo de un wire del canvas abierto (null o lista vacía =
   *  camino automático). Pinta al instante, graba una sola vez en la working
   *  copy y apila su Undo; si el guardado falla, vuelve al trazo anterior y
   *  avisa. Fuera de una sesión de edición no hace nada. */
  setWireRoute: (wireId: string, points: RoutePoint[] | null) => Promise<void>;
  /** Themes de color del proyecto activo (Data Standards → Themes) y
   *  su índice por id. Las cajas los usan por referencia ('theme:<id>'). */
  themes: Theme[];
  themeIdx: Map<string, Theme>;
  /** Carga los themes de `projectId` (best-effort; descarta respuestas de un
   *  proyecto que dejó de ser el activo). */
  loadThemes: (projectId: string | null) => Promise<void>;
  /** Colores de las cajas en el canvas abierto (excepciones sobre el
   *  color propio de cada tabla/vista: {id: ColorRef}). Se siembran del
   *  diagrama; cada bloque lee el suyo por selector. */
  canvasColors: Record<string, string>;
  /** Pinta las cajas `ids` en este canvas — `ref` = ColorRef ('none' = sin
   *  color aquí), `null` = vuelven al color de su tabla/vista. Pinta al
   *  instante, graba una sola vez en la working copy y apila su Undo; si
   *  falla, vuelve a lo anterior y avisa. Fuera de una sesión de edición, nada. */
  setBoxColors: (ids: string[], ref: string | null) => Promise<void>;
  /** Graba de una vez varias cajas del canvas abierto con colores distintos
   *  — `patch` = {id: ColorRef | null} (null = vuelve al color de su tabla).
   *  La usa la ficha del canvas al Save: un request y un Undo (`label`). Solo
   *  lo que de verdad cambia; true si se grabó (o no había nada que grabar),
   *  false si no se pudo (ya avisó). */
  applyCanvasColors: (patch: Record<string, string | null>, label?: string) => Promise<boolean>;
  /** Colores sin grabar de la ficha del canvas abierta, que las cajas
   *  muestran encima de los grabados; null = no hay. */
  colorPreview: Record<string, string | null> | null;
  setColorPreview: (p: Record<string, string | null> | null) => void;
  /** Color propio de una tabla o vista (todos sus canvases); null = sin
   *  color. Un cambio del modelo (changeset), con Undo. */
  setObjectColor: (id: string, ref: string | null) => Promise<void>;
  /** LOD: bajo el umbral de zoom los nodos se pintan compactos (misma
   *  caja, tamaño y colores; sin las filas, que a ese zoom miden <1px). Default
   *  true: el fitView inicial de un canvas grande arranca alejado y la primera
   *  pintura ya sale liviana; si el canvas es chico, el primer onMove lo apaga
   *  al instante. `lodLock` congela el valor actual (ningún flujo lo activa:
   *  los exports se generan desde la escena, no desde el DOM). */
  lod: boolean;
  setLod: (v: boolean) => void;
  lodLock: boolean;
  setLodLock: (v: boolean) => void;
  /** Centra el canvas sobre la tabla (Find a table… del toolbar). No-op si no hay nodo.
   *  Selecciona la tabla y la enfoca con sus vistas (`frameTable`). */
  focusTable: (tableId: string) => void;
  /** Acerca y centra la tabla con sus vistas en lo que se ve del canvas
   *  (descontando el panel de Properties) — después de que el panel se
   *  monte. No-op sin el nodo o sin canvas. */
  frameTable: (tableId: string, opts?: { afterClick?: boolean }) => void;
  /** Tabla (y opcionalmente columna) a centrar en cuanto monte el
   *  canvas destino (Finder cross-canvas / buscador del Model). Lo consume
   *  ModelerCanvas tras cargar el diagrama. */
  pendingFocusTableId: string | null;
  pendingFocusColId: string | null;
  setPendingFocus: (tableId: string | null, colId?: string | null) => void;
  /** Centra la tabla y abre la columna — selecciona su fila en el bloque y
   *  monta su Properties (mismo gesto que el click en la fila). */
  focusColumn: (tableId: string, colId: string) => void;
  /** Abre el canvas `canvasId` (de `projectId`) y centra sobre `tableId` cuando
   *  monte (Finder cross-canvas / buscador); con `colId` abre además la columna.
   *  Si ese canvas ya está abierto, centra directo. */
  openCanvasAndFocus: (canvasId: string, projectId: string | null | undefined, tableId: string, colId?: string, label?: string) => Promise<void>;
  // ── Capa Drawing: formas libres detrás de las tablas ──
  drawings: Drawing[];
  /** El dibujo recién creado — el canvas lo deja seleccionado (si no, nace
   *  detrás de la tabla del centro y parece no haberse creado) y lo limpia. */
  justAddedDrawingId: string | null;
  /** Por canvas, las tandas de objetos agregados en esta sesión (lo que trajo
   *  la carga Excel, lo creado, importado o pegado), de la más antigua a la
   *  más reciente — el canvas las pinta encima de lo que ya había (sin
   *  moverlo), cada una sobre las anteriores (`nodeZ`). */
  freshNodes: Record<string, string[][]>;
  markFresh: (byCanvas: Record<string, string[]>) => void;
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
  /** Carga el árbol (folders+canvases) de cualquier proyecto al cache `trees` sin tocar la selección. */
  loadProjectTree: (pid: string) => Promise<void>;
  /**
   * Re-arma el explorer para el contexto actual (versión/changeset activo):
   * purga el cache de árboles, re-fetch bajo su overlay y re-abre el canvas
   * activo si sigue existiendo (o limpia la selección). Sin esto, al cambiar
   * de versión el árbol seguiría pegado al contexto anterior y los proyectos/
   * canvases draft de la versión abierta no aparecerían.
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
  /** Graba el borrado del proyecto en la working copy (un solo cambio). */
  deleteProject: (id: string) => Promise<void>;
  /** La working copy activa borra su proyecto: el canvas cede al panel «Deletion pending». */
  projectDeletionPending: boolean;
  undoProjectDeletion: () => Promise<void>;
  /** @internal recarga folders+canvases del proyecto y depura la selección.
   *  `isCurrent`: si al llegar la respuesta devuelve false, no escribe. */
  _refreshProject: (projectId: string, isCurrent?: () => boolean) => Promise<void>;
  /** Recarga el canvas abierto: solo las tablas que tocó lo escrito desde la
   *  última carga (`lib/diagramSlice`) o, si no se puede acotar o con `full`,
   *  el diagrama completo. */
  reload: (opts?: { full?: boolean }) => Promise<void>;
  /** Cachea el naming config de `projectId` (descarta respuestas de
   *  un proyecto que dejó de ser el activo; un fallo no pisa lo cacheado). */
  loadNaming: (projectId: string | null) => Promise<void>;
  saveLayout: (tableId: string, pos: { x: number; y: number }) => Promise<void>;
  /** Posiciones de varios bloques movidos juntos (selección múltiple) en una
   *  sola escritura. Corre en segundo plano: un fallo se avisa aquí. */
  saveNodePositions: (positions: Record<string, { x: number; y: number }>) => Promise<void>;
  /** Persiste la posición de todos los nodos del canvas activo (botón Save del toolbar). */
  saveAllLayout: () => Promise<void>;
  autoOrganize: () => Promise<void>;
  createTable: (input: { logicalName: string; physicalName?: string; schema?: string; mode?: 'logical' | 'physical'; description?: string; udpValues?: Record<string, string> }) => Promise<void>;
  addColumn: (tableId: string, input: AddColumnInput) => Promise<void>;
  // La creación de relaciones pasa por un popup: el RelationshipCreatePopup
  // graba el lote (columnas + relación) directamente.
  updateRelationship: (r: gov.Relationship) => Promise<void>;
  deleteRelationship: (id: string) => Promise<void>;
  /** Importa tablas existentes al canvas. La tabla entra sola — sus
   *  vistas se suman solo con `withViews` (checkbox del modal); la membresía
   *  de vistas parte de `diagram.subjectArea.viewIds` (materializado). */
  /** `tables` (opcional) = las tablas importadas, para estimar el
   *  tamaño de su bloque al ubicarlo en el centro de lo que se ve. */
  addExistingTables: (tableIds: string[], opts?: { withViews?: boolean; tables?: CanonicalTable[] }) => Promise<void>;
  /** Suma vistas (ya existentes en el modelo) a la membresía de este
   *  canvas — tab Views → «Add to this canvas», alta desde Create view. */
  addViewsToCanvas: (viewIds: string[]) => Promise<void>;
  /** Saca una vista de este canvas (membresía + layout); la vista
   *  sigue en el modelo y en los demás canvases. */
  removeViewFromCanvas: (viewId: string) => Promise<void>;
  /** Borra la vista del modelo (todos los canvases) con Undo —
   *  el mismo desde los paneles del canvas y el Object Inspector: repone el doc
   *  y la vuelve a listar, en su posición, en cada canvas que la listaba.
   *  `canvasIds`: dónde se usa, si el llamador ya lo sabe (si no, se consulta).
   *  El refresco posterior al borrado queda en manos del llamador. Con
   *  `onUndo`, entrega su inversa en vez de apilarla (la pide otro paso del
   *  historial: rehacer el borrado). */
  deleteView: (view: View, opts?: { canvasIds?: string[]; onUndo?: (step: HistoryStep) => void }) => Promise<void>;
  // `sourceTable` (opcional por columna): nombre de la tabla dueña en el
  // origen — procedencia para el historial de auditoría; no viaja al payload.
  createTableFromSources: (input: { logicalName: string; schema?: string; columns: (CanonicalColumn & { sourceTable?: string })[] }) => Promise<void>;
  setColumnTarget: (id: string | null) => void;
  setSelectedTable: (id: string | null) => void;
  /** Clic en una tabla del canvas — la selecciona y, si no lo estaba,
   *  la enfoca con sus vistas (`frameTable`). */
  selectTable: (id: string | null) => void;
  setSelectedEdge: (id: string | null) => void;
  removeTableFromArea: (tableId: string) => Promise<void>;
  /** Borra la tabla del modelo con cascada versionada: vistas, relaciones,
   *  columnas, membresía en todos los canvases, y la tabla. Todo en el changeset. */
  /** `opts.pre` = pre-imagen para el Undo cuando la tabla no está
   *  en el diagrama (borrado desde el Object Inspector, sin canvas); sin ella
   *  ni la tabla en el diagrama, se lee. Con `opts.onUndo`, entrega su inversa
   *  en vez de apilarla (la pide otro paso del historial: deshacer «Create
   *  table», rehacer «Delete table»). */
  deleteTable: (tableId: string, opts?: { pre?: CanonicalTable; onUndo?: (step: HistoryStep) => void }) => Promise<void>;
  updateTable: (id: string, fields: { logicalName?: string; physicalName?: string; schema?: string; description?: string; udpValues?: Record<string, string> }) => Promise<void>;
  /** Upsert de una columna en el changeset (merge sobre la columna actual del diagrama) + reload. */
  updateColumn: (colId: string, fields: Partial<CanonicalColumn>) => Promise<void>;
  /** Reordena las columnas de una tabla al orden de ids recibido (el único
   *  orden, `ordinal`, el mismo en lógico y físico) y persiste solo las que
   *  se movieron. */
  reorderColumns: (tableId: string, orderedIds: string[]) => Promise<void>;
  /** Aplica el plan de un drop en el bloque del canvas — cambios
   *  de llave (entrar/salir/reordenar) + reorden de columnas. */
  applyCanvasDrop: (tableId: string, plan: CanvasDropPlan) => Promise<void>;
  /** `deleteColumns` de una columna. `opts.col` = la columna (estado
   *  efectivo) cuando no está en el diagrama — sin ella la cascada de
   *  relaciones/FK/vistas no se puede resolver. */
  deleteColumn: (colId: string, relIds?: string[], opts?: { col?: CanonicalColumn }) => Promise<void>;
  /** Borra columnas de UNA tabla en un solo lote: las relaciones del aviso de
   *  impacto (`relIds`) recortadas o borradas, las FK que quedan huérfanas, las
   *  columnas y cada vista que las lista; un solo Undo. `opts.cols` = las que
   *  no están en el diagrama (estado efectivo). Con `opts.onUndo`, entrega su
   *  inversa en vez de apilarla (deshacer «Add column», rehacer el borrado).
   *  Con `opts.exact` (rehacer el borrado), las relaciones a tocar son solo
   *  `relIds`: si otra usa ahora alguna de las columnas, no borra nada. */
  deleteColumns: (colIds: string[], relIds?: string[], opts?: { cols?: CanonicalColumn[]; onUndo?: (step: HistoryStep) => void; exact?: boolean }) => Promise<void>;
  setViewMode: (m: 'logical' | 'physical') => void;
  createSubjectArea: (name: string) => Promise<void>;
}

// Tamaño default por tipo de forma al crearla. El centrado usa el viewport.
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

/** Dónde nace el bloque de una tabla nueva — centrado en lo que el usuario
 *  ve del canvas (la acción la selecciona: se descuenta el panel de
 *  Properties que se abre). Sin posición, el canvas la ubicaría por su número
 *  de orden: en modelos grandes, lejísimos. Con su ancho: el llamador la marca
 *  en vuelo (`holdSpots`) hasta que se pinte. null sin canvas montado (entra
 *  sin posición). */
function newTableSpot(
  rf: ReactFlowInstance | null, saId: string, table: Pick<CanonicalTable, 'physicalName' | 'logicalName' | 'schema'>,
  columns: Pick<CanonicalColumn, 'physicalName' | 'logicalName' | 'dataType' | 'isPrimaryKey'>[], facet: 'logical' | 'physical',
): (Point & { w: number }) | null {
  const view = canvasView(rf, { panel: 'opens' });
  if (!view) return null;
  const size = tableLodSize(table as CanonicalTable, columns as CanonicalColumn[], facet);
  const spot = blockSpot(view, { w: size.w, h: size.h });
  const others = nodeBoxes(rf), recent = recentBoxes(rf, saId);
  const p = avoidStacking(spot, size, others, recent, view.rect) ?? cascade(spot, size, others, recent);
  return { x: p.x, y: p.y, w: size.w };
}

/** Dónde están los bloques del canvas (tablas y vistas; los
 *  dibujos no cuentan) — para que un alta seguida en el mismo centro baje en
 *  cascada en vez de tapar entera a la anterior (`avoidStacking`). */
function nodeBoxes(rf: ReactFlowInstance | null): (StackBox & { id: string })[] {
  return (rf?.getNodes?.() ?? [])
    .filter((n) => n.type === 'table' || n.type === 'view')
    .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: n.measured?.width ?? (typeof n.width === 'number' ? n.width : undefined) }));
}

/** El encuadre en curso — uno posterior (otra tabla) deja sin efecto la
 *  corrección del anterior. */
let _frameSeq = 0;
/** El `seq` del encuadre que está animando (0: ninguno). */
let _frameLive = 0;
/** La tabla que se seleccionó con una herramienta armada
 *  (sin encuadrar) — desarmada, otro clic en ella la encuadra. */
let _unframed: string | null = null;
/** Duración de la animación del encuadre. Trayecto directo
 *  (`linear`) — cortado a mitad de camino nunca queda más lejos que al principio
 *  (la interpolación «suave» de d3 se aleja en el medio de un trayecto largo). */
const FRAME_MS = 400;
/** La promesa de `setViewport` con duración solo se resuelve al final de la
 *  transición de d3 — si el usuario la interrumpe (rueda, paneo, un clic),
 *  nunca: quien espera el final espera también esto. */
const settle = (p: Promise<unknown>, ms: number) =>
  Promise.race([p, new Promise<void>((r) => { setTimeout(r, ms); })]);
/** El usuario hace otra cosa en el canvas — un menú contextual abierto o una
 *  herramienta armada — y el encuadre no la pisa: no arranca ni corrige (si se
 *  arma una herramienta a mitad de la animación, esta termina, porque cortada
 *  quedaría en un zoom intermedio; un menú la corta). */
const busyCanvas = (st: { colMenu: unknown; relPreset: unknown; subcatArmed: boolean }) =>
  !!st.colMenu || !!st.relPreset || st.subcatArmed;
/** Mismo viewport (a medio píxel y una milésima de zoom). */
const sameViewport = (a: FlowViewport, b: FlowViewport) =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.zoom - b.zoom) < 0.001;

/** Corta el encuadre que está animando, donde esté (un
 *  setViewport inmediato interrumpe la transición de d3-zoom). */
function cutFrame(flow: ReactFlowInstance | null): void {
  if (!_frameLive) return;
  _frameLive = 0;
  ++_frameSeq;
  if (flow) void flow.setViewport(flow.getViewport(), { duration: 0 });
}

/** El usuario empezó a arrastrar un bloque — el encuadre en curso se detiene
 *  (si no, el canvas se movería bajo el arrastre). */
export function stopFraming(): void {
  cutFrame(useModelerStore.getState().flow);
}

/** La caja de un nodo del canvas (flujo) — su tamaño medido o, si
 *  todavía no se pintó (`onlyRenderVisibleElements`), el estimado LOD. */
function flowBox(n: Node, facet: 'logical' | 'physical'): FlowBox {
  const w = n.measured?.width ?? (typeof n.width === 'number' ? n.width : undefined);
  const h = n.measured?.height ?? (typeof n.height === 'number' ? n.height : undefined);
  if (w !== undefined && h !== undefined) return { x: n.position.x, y: n.position.y, w, h };
  const d = n.data as { table?: CanonicalTable; columns?: CanonicalColumn[]; view?: View; colTypes?: Record<string, string> };
  const est = n.type === 'view' && d.view?.sources ? viewLodSize(d.view, d.colTypes ?? {})
    : d.table ? tableLodSize(d.table, d.columns ?? [], facet) : { w: 240, h: 140 };
  return { x: n.position.x, y: n.position.y, w: w ?? est.w, h: h ?? est.h };
}

/** Altas en vuelo por canvas — su bloque todavía no se pinta (la escritura y
 *  la recarga tardan), pero la siguiente alta (dos «Add» del modal casi a la
 *  vez) ya debe esquivarlo. El alta las suelta al terminar, también si falla. */
const _inFlight = new Map<string, StackBox[]>();
function holdSpots(saId: string, boxes: StackBox[]): () => void {
  if (!boxes.length) return () => {};
  _inFlight.set(saId, [...(_inFlight.get(saId) ?? []), ...boxes]);
  return () => {
    const rest = (_inFlight.get(saId) ?? []).filter((b) => !boxes.includes(b));
    if (rest.length) _inFlight.set(saId, rest);
    else _inFlight.delete(saId);
  };
}

/** Lo existente sin posición guardada que el alta de las tablas `entering`
 *  correría de casilla (el canvas lo pinta por número de orden, por nombre),
 *  fijado donde se ve — sobre el diagrama previo al alta. Viaja en la misma
 *  escritura (`addToCanvas` solo lo aplica a quien sigue sin posición). Sin
 *  el diagrama de ese canvas, nada. */
function pinsFor(saId: string, entering: string[]): { pins?: Record<string, Point> } {
  const dia = useModelerStore.getState().diagram;
  if (!dia || dia.subjectArea.id !== saId) return {};
  // Lo que ya está en el diagrama (entró por otro camino
  // mientras el alta esperaba) no cuenta como «entra».
  const present = new Set(dia.tables.map((t) => t.id));
  const { pins } = pinsForEntering(dia, entering.filter((id) => !present.has(id)));
  return Object.keys(pins).length ? { pins } : {};
}

/** Al sacar o borrar tablas del canvas abierto, lo que sigue sin posición
 *  queda donde se ve (`pinsForLeaving`) — sin esto, un Undo en cadena (sacar →
 *  crear → deshacer → deshacer) dejaría una tabla tapando a otra. Al borrar,
 *  también en los otros canvases de la tabla, sobre el diagrama leído de cada
 *  uno (`other`, `diagramsBefore`). */
function pinsOut(saId: string, leaving: string[], other?: Diagram): { pins?: Record<string, Point> } {
  const open = useModelerStore.getState().diagram;
  const dia = open?.subjectArea.id === saId ? open : other?.subjectArea.id === saId ? other : null;
  if (!dia) return {};
  const pins = pinsForLeaving(dia, leaving);
  return Object.keys(pins).length ? { pins } : {};
}

// ── Membresía del canvas como pasos del historial ─────────────────────────
// Siempre sobre el canvas de la acción (`saId`), aunque al deshacer o rehacer
// haya otro abierto. Cada paso arma su contrario con lo que el servicio dice que
// entró o salió (posición, color y trazos incluidos). `shown`: la lista de
// vistas del canvas al pedir la acción (ver `struct.addToCanvas`).

/** Saca del canvas lo que entró y devuelve el paso que lo vuelve a poner. */
function membersOut(saId: string, members: struct.CanvasMembers, shown?: string[] | null): HistoryStep {
  return freshStep(async () => {
    const out = await struct.removeFromCanvas(saId, members, shown);
    await useModelerStore.getState().reload();
    return membersIn(saId, out, shown);
  });
}

/** Vuelve a poner lo que salió (solo lo que trae: sin tablas, posiciones ni
 *  trazos, esas llaves no viajan) y devuelve el paso que lo saca otra vez. */
function membersIn(saId: string, out: struct.CanvasMembersOut, shown?: string[] | null): HistoryStep {
  return freshStep(async () => {
    const added = await struct.addToCanvas(saId, {
      ...(out.tableIds.length ? { tableIds: out.tableIds } : {}), viewIds: out.viewIds,
      ...(Object.keys(out.layout).length ? { layout: out.layout } : {}),
      ...(Object.keys(out.routes).length ? { routes: out.routes } : {}),
      colors: out.colors,
    }, shown);
    await useModelerStore.getState().reload();
    return membersOut(saId, { ...(added.tableIds.length ? { tableIds: added.tableIds } : {}), viewIds: added.viewIds }, shown);
  });
}

/** Saca una tabla del canvas con sus vistas que quedan huérfanas (`viewIds`) y
 *  los trazos de sus wires; lo que queda sin posición, donde se ve si ese
 *  canvas está abierto (`pinsOut`). Devuelve el paso que la vuelve a poner. */
function tableOut(saId: string, tableId: string, viewIds: string[], wireIds: string[], shown?: string[] | null): HistoryStep {
  return freshStep(async () => {
    const out = await struct.removeFromCanvas(saId, {
      tableIds: [tableId], viewIds, ...(wireIds.length ? { dropRouteIds: wireIds } : {}), ...pinsOut(saId, [tableId]),
    }, shown);
    await useModelerStore.getState().reload();
    return tableIn(saId, tableId, out, wireIds, shown);
  });
}

/** Vuelve a poner la tabla con lo que salió con ella, en una sola escritura.
 *  Las vistas solo cuentan si salieron con ella: sin ellas, un canvas sin lista
 *  explícita sigue sin lista. */
function tableIn(saId: string, tableId: string, out: struct.CanvasMembersOut, wireIds: string[], shown?: string[] | null): HistoryStep {
  return async () => {
    await struct.addToCanvas(saId, {
      tableIds: [tableId], viewIds: out.viewIds, layout: out.layout, routes: out.routes, colors: out.colors,
    }, out.viewIds.length ? shown : undefined);
    await useModelerStore.getState().reload();
    return tableOut(saId, tableId, out.viewIds, wireIds, shown);
  };
}

// ── Borrados en cascada como pasos del historial ──────────────────────────
// Frescos (`freshStep`): la acción del store vuelve a leer lo que depende del
// objeto en ese momento y entrega su inversa (`onUndo`) en vez de apilarla.

/** Borra la tabla con su cascada (deshacer «Create table», rehacer «Delete
 *  table») y devuelve su inversa. */
function tableDrop(id: string, pre?: CanonicalTable): HistoryStep {
  return freshStep(async () => {
    const got: { step: HistoryStep | null } = { step: null };
    await useModelerStore.getState().deleteTable(id, { ...(pre ? { pre } : {}), onUndo: (step) => { got.step = step; } });
    return got.step;
  });
}

/** Borra columnas de una tabla con su cascada (deshacer «Add column», rehacer
 *  el borrado: `exact`) y devuelve su inversa. */
function columnsDrop(ids: string[], relIds: string[], cols: CanonicalColumn[], exact = false): HistoryStep {
  return freshStep(async () => {
    const got: { step: HistoryStep | null } = { step: null };
    await useModelerStore.getState().deleteColumns(ids, relIds, { cols, exact, onUndo: (step) => { got.step = step; } });
    return got.step;
  });
}

/** Borra la vista de todos los canvases (rehacer el borrado) y devuelve su inversa. */
function viewDrop(view: View): HistoryStep {
  return freshStep(async () => {
    const got: { step: HistoryStep | null } = { step: null };
    await useModelerStore.getState().deleteView(view, { onUndo: (step) => { got.step = step; } });
    return got.step;
  });
}

const RELATIONSHIP_KEYS_UNREADABLE = "Couldn't check the keys of this relationship";

/** Repone una relación borrada y el FK que su borrado apagó en las hijas (por
 *  valor); devuelve el paso que la vuelve a borrar. */
function relRestore(rel: gov.Relationship, fkCleared: CanonicalColumn[]): HistoryStep {
  return async () => {
    await gov.recordChangesBulk([...fkCleared.map((c) => gov.bulk.createColumn(c)), gov.bulk.upsertRelationship(rel)]);
    await useModelerStore.getState().reload();
    return relDrop(rel);
  };
}

/** Borra la relación y apaga el FK de sus columnas hijas que no quedan como
 *  hijas en otra relación (la regla de `deleteRelationship`), con lo vigente de
 *  la tabla hija — no depende del canvas abierto —, en un lote; devuelve el paso
 *  que la repone. */
function relDrop(rel: gov.Relationship): HistoryStep {
  return freshStep(async (pin) => {
    const askedCs = useSessionStore.getState().activeChangesetId;
    let near: gov.Relationship[], cols: CanonicalColumn[];
    try {
      [near, cols] = await Promise.all([gov.listRelationships(rel.childTableId), gov.listColumns(rel.childTableId)]);
    } catch (e) {
      throw await readFailure(e, askedCs, pin,
        () => new NothingDoneError(RELATIONSHIP_KEYS_UNREADABLE, `${RELATIONSHIP_KEYS_UNREADABLE}: nothing was deleted. Try again.`));
    }
    const children = new Set(rel.pairs.map((p) => p.childColumnId));
    const cleared = cols.filter((c) => children.has(c.id) && c.isForeignKey
      && !near.some((r) => r.id !== rel.id && r.pairs.some((p) => p.childColumnId === c.id)));
    pin.check();
    await gov.recordChangesBulk([
      gov.bulk.deleteRelationship(rel.id),
      ...cleared.map((c) => gov.bulk.updateColumn({ ...c, isForeignKey: false })),
    ]);
    await useModelerStore.getState().reload();
    return relRestore(rel, cleared);
  });
}

/** El diagrama previo de cada canvas de `canvasIds` que no es el abierto — al
 *  borrar una tabla, ahí también queda donde se ve lo que sigue sin posición,
 *  y el Undo la repone donde se veía. Una lectura por canvas; la que falla
 *  queda sin diagrama (en ese canvas no se fija nada: una posición no frena el
 *  borrado). */
async function diagramsBefore(canvasIds: string[]): Promise<Map<string, Diagram>> {
  const open = useModelerStore.getState().diagram?.subjectArea.id;
  const out = new Map<string, Diagram>();
  await Promise.all(canvasIds.filter((id) => id !== open).map(async (id) => {
    try { out.set(id, await mod.loadDiagram(id)); } catch { /* sin diagrama: no se fija nada */ }
  }));
  return out;
}

/** Lo reciente del canvas para la cascada — lo agregado en esta sesión
 *  (`freshNodes`) donde se pinta (o, si todavía no se pintó, donde lo dejó la
 *  recarga) y lo que está en vuelo. Una CTAS más alta no tapa entera a la
 *  tabla que se acaba de crear. Por su posición guardada solo cuenta lo que se
 *  dibuja en esta faceta (las vistas, solo en Physical). */
function recentBoxes(rf: ReactFlowInstance | null, saId: string): StackBox[] {
  const st = useModelerStore.getState();
  const drawn = new Map(nodeBoxes(rf).map((b) => [b.id, b]));
  const dia = st.diagram?.subjectArea.id === saId ? st.diagram : null;
  const layout = dia?.subjectArea.layout ?? {};
  const drawable = new Set([
    ...(dia?.tables ?? []).map((t) => t.id),
    ...(st.viewMode === 'physical' ? (dia?.views ?? []).map((v) => v.id) : []),
  ]);
  const out: StackBox[] = [];
  for (const id of new Set((st.freshNodes[saId] ?? []).flat())) {
    const box = drawn.get(id) ?? (drawable.has(id) ? layout[id] : undefined);
    if (box) out.push(box);
  }
  return [...out, ...(_inFlight.get(saId) ?? [])];
}

// Debounce de la persistencia de drawings (PUT del array completo).
let _drawingsTimer: ReturnType<typeof setTimeout> | null = null;
// La versión en edición cuando se agendó el guardado de dibujos. Si al
// dispararse la sesión no edita esa versión (transferida, eliminada,
// enviada a revisión), el guardado se descarta: no le corresponde.
let _drawingsCs: string | null = null;
/** ¿La sesión sigue editando la versión `cs`? */
const stillEditing = (cs: string | null): boolean => {
  const s = useSessionStore.getState();
  return !!cs && s.openMode === 'editing' && s.activeChangesetId === cs;
};
/** Versión en edición en este momento (null fuera de una sesión de edición). */
const editingCs = (): string | null => {
  const s = useSessionStore.getState();
  return s.openMode === 'editing' ? s.activeChangesetId : null;
};
/** «<qué falló>: <motivo>.» — el motivo solo (p. ej. «Internal server
 *  error…», junto a «View created») no dice qué falló. Sin motivo legible,
 *  solo el contexto; si el motivo ya empieza como el contexto, va solo. */
export function failureText(context: string, e: unknown): string {
  const reason = e instanceof Error ? e.message.trim() : '';
  if (!reason) return context;
  if (reason.toLowerCase().startsWith(context.toLowerCase())) return reason;
  return `${context}: ${reason.replace(/[.\s]+$/, '')}.`;
}

/** Guarda de inmediato los dibujos con el guardado agendado (debounce de
 *  500 ms) del canvas `saId` — al cambiar de canvas o al cerrarlo, el disparo
 *  con debounce no los escribiría (su canvas no es el abierto) y el último
 *  trazo se perdería. Si falla, el mismo aviso que el guardado con debounce. */
function flushPendingDrawings(saId: string | null, drawings: Drawing[]): void {
  if (!_drawingsTimer || !saId) return;
  clearTimeout(_drawingsTimer); _drawingsTimer = null;
  const cs = _drawingsCs;
  if (stillEditing(cs)) {
    void struct.setSubjectAreaDrawings(saId, drawings)
      .catch((e: unknown) => reportCanvasSaveError(e, cs, "Couldn't save the drawings"));
  }
}

/** Aviso del fallo de un guardado del canvas que corre en segundo plano
 *  (dibujos, posiciones), pedido editando `cs`. Un 403/404/409 de la versión
 *  puede deberse a que cambió por fuera (transferida, eliminada, enviada): se
 *  espera la revalidación y, si la sesión dejó de editar esa versión, ella dio
 *  el aviso correcto. Si sigue igual (rol perdido, nombre duplicado, proxy) o
 *  el error es otro (red), se muestra el motivo real. */
async function reportCanvasSaveError(e: unknown, cs: string | null, fallback: string): Promise<void> {
  if (touchesVersion(e, cs)) {
    await afterRevalidation();
    if (!stillEditing(cs)) return;
  }
  toast.error(failureText(fallback, e));   // qué falló + el motivo
}
// Paste de tabla en vuelo: un Ctrl+V repetido no dispara otro.
let _pasteTableBusy = false;

/** Lo que el popup de pegado mostró y se graba tal cual. */
export interface TablePastePrepared { table: CanonicalTable; cols: CanonicalColumn[]; createSchema?: { name: string } }
/** El proyecto de donde se copió (pegar entre proyectos). */
export interface ClipSource { projectId: string | null; projectName: string }

/** Último nombre conocido de cada proyecto: `refreshExplorer` vacía `projects`
 *  hasta que llega la lista (y, si falla, queda vacía) — lo copiado en ese rato
 *  conserva el nombre de su proyecto. */
const _projectNames = new Map<string, string>();

/** El proyecto de la sesión de canvas, para el `source` del clipboard. */
function clipSource(): ClipSource {
  const st = useModelerStore.getState();
  const projectId = useSessionStore.getState().activeProjectId ?? st.activeProjectId;
  const name = st.projects.find((p) => p.id === projectId)?.name || (projectId ? _projectNames.get(projectId) : undefined);
  return { projectId, projectName: name ?? '' };
}

/** Físicos de tabla del proyecto de la sesión que pueden chocar con
 *  `physicalName` o con sus copias: búsqueda server-side sobre la vista
 *  efectiva de la versión + el diagrama local (un alta propia que aún
 *  no entró al índice). La comparte la vista previa del popup y el paste. */
export async function tableNamesTaken(physicalName: string): Promise<string[]> {
  const pool = await gov.searchTables(copyNameBase(physicalName, 'physical'), 500).catch(() => [] as CanonicalTable[]);
  return [
    ...pool.map((t) => t.physicalName),
    ...(useModelerStore.getState().diagram?.tables ?? []).map((t) => t.physicalName),
  ];
}
// Secuencia de cargas del diagrama: descarta respuestas fuera de orden (dos
// clicks rápidos en el explorer, reload en vuelo al cambiar de canvas).
let _loadSeq = 0;
// La carga que puso `openingSaId` (el spinner del Explorer) — solo ella lo
// apaga.
let _openingSeq = 0;
// `reload()` pedido mientras se abría el mismo canvas (el Refresh lo reabre y
// una edición termina): esa apertura pudo pedir su foto antes del guardado —
// se recarga al terminarla. `prev`: el diagrama que había al pedirlo (el
// Explorer se entera si el cambio fue estructural). También aplica si se abría
// otro canvas — `saId` es el editado.
let _reloadAfterOpening: { saId: string; prev: Diagram | null } | null = null;
// La próxima `reload()` cierra el canvas sin su propio aviso si falla — la
// pide la apertura fallida de otro canvas, cuyo llamador ya avisa la caída
// (una caída, un aviso). La consume la `reload()` al empezar (así no queda
// armada si esta termina antes).
let _quietReloadFailure = false;
// Lo que esta pestaña escribió en el draft y todavía no está en el diagrama en
// pantalla: las tablas que tocó (`lib/diagramSlice.editedTables`) y si hace
// falta el completo, cada uno con el número de la anotación más reciente que lo
// pidió. Una carga lo salda al instalarse — lo anotado hasta que se pidió —; si
// se descarta o falla, sigue pendiente para la siguiente. Lo de una sesión
// anterior lo salda la primera carga de la nueva (completa: no hay diagrama en
// pantalla donde fundir un recorte).
const _owed = { tables: new Map<string, number>(), full: 0 };
let _notes = 0;
// Escrituras del draft (`writeSeq` de su cabecera) desde la última carga
// completa: `atLoad` la vio el servidor; `own` son las de esta pestaña. Una
// escritura que no está entre ellas (otra pestaña u otro equipo, una carga
// Excel, un esquema) pide el diagrama completo.
const seqsFresh = () => ({ atLoad: null as number | null, own: new Set<number>() });
let _seqs = seqsFresh();
// La última carga pedida por `reload()`: sus tablas si es un recorte, null si es
// el diagrama completo. Vale mientras nadie pida otra (`seq === _loadSeq`).
let _lastLoad: { seq: number; tables: Set<string> | null } | null = null;
// Hasta cuántas tablas una recarga va por recorte; más, el diagrama completo.
const SLICE_MAX_TABLES = 30;

/** Salda lo pendiente anotado hasta `upTo` que cubre una carga instalada: todo
 *  si fue el diagrama completo, las tablas del lote si fue un recorte. */
function settleOwed(upTo: number, lot: ReadonlySet<string> | null): void {
  for (const [t, n] of _owed.tables) if (n <= upTo && (!lot || lot.has(t))) _owed.tables.delete(t);
  if (!lot && _owed.full <= upTo) _owed.full = 0;
}

/** ¿Quedó algo anotado después de `upTo`? */
const owedSince = (upTo: number): boolean => _owed.full > upTo || [..._owed.tables.values()].some((n) => n > upTo);

/** Las escrituras del draft vistas por una carga completa instalada. */
function sawDraft(seq: number | null | undefined): void {
  const atLoad = seq ?? null;
  _seqs = { atLoad, own: new Set(atLoad == null ? [] : [..._seqs.own].filter((n) => n > atLoad)) };
}

/** ¿Hay escrituras en el draft que esta pestaña no hizo desde la última carga
 *  completa? Sin números en la respuesta (un backend que no los da) no se sabe:
 *  no. Sin el número de la última carga completa (la trajo un backend sin
 *  ellos), tampoco se sabe qué vio: sí. */
function othersWrote(seq: number | null | undefined): boolean {
  if (seq == null) return false;
  if (_seqs.atLoad == null) return true;
  for (let n = _seqs.atLoad + 1; n <= seq; n++) if (!_seqs.own.has(n)) return true;
  return false;
}

/** Una carga completa que ve escrituras que esta pestaña no hizo: lo pendiente
 *  de rehacer ya no calza (el Redo igual lo verifica antes de escribir). */
function sawOthers(seq: number | null | undefined): void {
  if (othersWrote(seq)) useUndoStore.getState().dropRedo();
}
// Lo mismo para los refrescos del Explorer — solo el más reciente escribe. La
// respuesta tardía de uno anterior (otra sesión: se abrió otra versión, modo o
// proyecto mientras cargaba) no pisa proyectos, proyecto activo, árbol,
// esquemas ni el canvas del vigente.
let _explorerSeq = 0;
/** Lo que el filtro de esquemas de CTAS lee de cada esquema del catálogo. */
const schemasSignature = (rows: DbSchema[]): string => rows.map((s) => `${s.id}|${s.name}|${s.kind ?? ''}`).join('\n');
/** Lo que relee el árbol tras una mutación del Explorer escribe solo si sigue
 *  la sesión en que se pidió la mutación y no empezó un refresco más reciente
 *  (que trae el árbol vigente). Se toma al empezar la mutación. */
const explorerRequest = (): { isCurrent: () => boolean; pin: SessionPin } => {
  const seq = _explorerSeq;
  const pin = pinSession();
  return { isCurrent: () => seq === _explorerSeq && pin.holds(), pin };
};
/** La sesión de canvas actual (proyecto + modo + versión): lo pedido
 *  previamente solo se avisa si la sesión sigue siendo la misma. */
const sessionNow = (): string => {
  const s = useSessionStore.getState();
  return `${s.openMode ?? ''}|${s.activeProjectId ?? ''}|${s.activeChangesetId ?? ''}`;
};
/** Motivo legible de un error para intercalarlo en un aviso (sin punto final). */
const reasonOf = (e: unknown): string => errorReason(e, 'unknown error');

/** Alguna lectura previa al borrado falló — no se borró nada. Es un
 *  `NothingDoneError`, así el Undo que lo pidió vuelve a la pila. Usa el
 *  sustantivo del modelo abierto (entity / table), como el diálogo. */
const dependentsUnreadable = (subject: string) => {
  const reason = `Couldn't check what depends on ${subject}`;
  return new NothingDoneError(reason, `${reason}: nothing was deleted. Try again.`);
};
/** Techo de cambios por request de `PUT /changes/bulk` (backend `ChangesBulkBody`):
 *  un lote que debe grabarse todo o nada no puede pasarlo. */
const BULK_MAX_CHANGES = 2000;
/** La lectura de dónde se usa una vista falló — no se borró nada (`NothingDoneError`). */
const viewUsageUnreadable = () => {
  const reason = "Couldn't check where this view is used";
  return new NothingDoneError(reason, `${reason}: nothing was deleted. Try again.`);
};

/** El error con que termina un borrado cuya lectura previa falló (no se borró
 *  nada). Un 403/404/409 de la versión puede deberse a que cambió de manos: se
 *  espera la revalidación. Si la sesión cambió, sigue el error original — la
 *  revalidación ya avisó y los llamadores lo callan; «Try again» sería falso.
 *  Si no, `unreadable()`; fuera de una sesión de edición, el motivo real (lo
 *  dice el error). */
async function readFailure(e: unknown, askedCs: string | null, pin: SessionPin, unreadable: () => Error): Promise<unknown> {
  if (touchesVersion(e, askedCs)) await afterRevalidation();
  if (!pin.holds()) return e;
  return editingCs() ? unreadable() : e;
}

type ListedViews = Awaited<ReturnType<typeof struct.listedViews>>;
/** Canvases donde es miembro alguna de `viewIds` (vistas de `tableId`). Una
 *  vista multi-fuente puede estar en un canvas que no tiene la tabla que se
 *  borra: la cascada del backend la saca también de ese. */
async function canvasesOfViews(tableId: string, viewIds: string[]): Promise<string[]> {
  const wanted = new Set(viewIds);
  const { views } = await viewsSvc.tableViews(tableId);
  return [...new Set(views.filter((v) => wanted.has(v.id)).flatMap((v) => v.canvases.map((c) => c.id)))];
}

/** De `viewIds`, cuáles lista cada canvas y dónde — se lee antes de borrarlas:
 *  el backend las saca de toda lista en el mismo request y el Undo las repone
 *  con esto. Solo quedan los canvases que listan alguna (un canvas sin lista
 *  explícita de vistas no lista ninguna: su regla por fuentes las vuelve a
 *  mostrar sola). Si una lectura falla, rechaza. */
async function listedViewsBy(canvasIds: string[], viewIds: string[]): Promise<Map<string, ListedViews>> {
  const out = new Map<string, ListedViews>();
  if (!viewIds.length) return out;
  const rows = await Promise.all([...new Set(canvasIds)].map(async (id) => [id, await struct.listedViews(id, viewIds)] as const));
  for (const [id, listed] of rows) if (listed.viewIds.length) out.set(id, listed);
  return out;
}

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
  loadSchemas: async () => {
    // Si mientras cargaba empezó un refresco del Explorer (otra sesión), esta
    // respuesta no le corresponde — el refresco trae la suya.
    const seq = _explorerSeq;
    const schemas = await schemasSvc.listSchemas();
    // El filtro de esquemas de CTAS / Import existing sale de este catálogo: si
    // cambió (alta desde un combo, pegado, carga Excel), lo vuelve a consultar.
    if (schemasSignature(schemas) !== schemasSignature(get().schemas)) invalidateTableSchemas();
    if (seq === _explorerSeq) set({ schemas });
  },
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
    // contrato es una sola tabla fuente por copia.
    if (mode === 'single' || !cur || cur.tableId !== tableId) {
      set({ colSel: { tableId, ids: [colId], anchor: colId } });
      return;
    }
    if (mode === 'toggle') {
      const ids = cur.ids.includes(colId) ? cur.ids.filter((i) => i !== colId) : [...cur.ids, colId];
      set({ colSel: ids.length ? { tableId, ids, anchor: colId } : null });
      return;
    }
    // range: contra el orden visual del nodo (el orden único: PK primero y
    // cada bloque por ordinal) — es lo que el usuario ve al Shift-clickear.
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
    // Snapshot por valor en el orden único de la fuente (PK primero): editar o
    // borrar la fuente después no altera lo copiado.
    const cols = orderColumns(d.columns.filter((c) => c.tableId === sel.tableId && wanted.has(c.id)))
      .map((c) => ({ ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) }));
    if (!cols.length) return 0;
    // Copiar deselecciona: tras el copy el estado que importa es el
    // clipboard; dejar las filas marcadas se leería como "pegado".
    // tblClipboard se limpia: los clipboards son excluyentes.
    set({
      colClipboard: { source: { logicalName: t?.logicalName ?? '', physicalName: t?.physicalName ?? '', ...clipSource() }, cols },
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
    // Snapshot por valor en el orden único (PK primero): editar o borrar el
    // original después no altera lo ya copiado.
    const cols = orderColumns(d.columns.filter((c) => c.tableId === tableId))
      .map((c) => ({ ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) }));
    set({
      tblClipboard: { table: { ...t, ...(t.udpValues ? { udpValues: { ...t.udpValues } } : {}) }, cols, source: clipSource() },
      colClipboard: null, colSel: null,   // excluyentes
    });
    // El nombre que se muestra, según la faceta.
    return get().viewMode === 'logical' ? t.logicalName || t.physicalName : t.physicalName || t.logicalName;
  },
  pasteTable: (prepared) => runBlocking('Creating table…', async () => {
    if (_pasteTableBusy) return null;   // Ctrl+V repetido con el paste en vuelo
    const clip = get().tblClipboard;
    const saId = get().activeSaId;
    if (!clip) throw new Error('Nothing to paste');
    if (!saId) throw new Error('Pick a Subject Area');
    // Lo copiado en otro proyecto lleva los ids de sus estándares (UDP, dominio,
    // theme): solo se pega lo que tradujo su revisión (`PasteTablePopup`).
    const fromOther = !!clip.source?.projectId && clip.source.projectId !== useSessionStore.getState().activeProjectId;
    if (fromOther && !prepared) throw new Error('Open the paste review to paste from another project.');
    // La acción es de la sesión donde empezó (ver `pinSession`).
    const pin = pinSession();
    _pasteTableBusy = true;
    try {
      get().markDirty();
      const table = prepared?.table ?? clip.table;
      const cols = prepared?.cols ?? clip.cols;
      // Procedencia: la tabla y las columnas del clipboard, no los
      // nombres finales de la copia que trae `prepared`.
      const source = { table: clip.table.physicalName || clip.table.logicalName,
        columns: new Map(clip.cols.map((c) => [c.id, c.physicalName])),
        ...(fromOther ? { project: clip.source?.projectName || clip.source?.projectId || undefined } : {}) };
      // Reintentos ante carrera multiusuario: si otro draft ganó el nombre (409
      // de la unicidad por proyecto), ese nombre cuenta como tomado y se recalcula.
      const lost: string[] = [];
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { physicalName, logicalName } = pasteNames(table, [...await tableNamesTaken(table.physicalName), ...lost]);
        const id = crypto.randomUUID();
        const schema = prepared?.createSchema ? { id: crypto.randomUUID(), name: prepared.createSchema.name } : null;
        pin.check();
        try {
          await gov.recordChangesBulk([
            ...(schema ? [gov.bulk.createSchema({ ...schema, kind: 'tables' })] : []),
            ...copyTableToBulk({ table, cols, id, physicalName, logicalName, source }),
          ]);
        } catch (e) {
          lastErr = e;
          if (e instanceof Error && e.message.includes(`Table ${physicalName} already exists`)) {
            lost.push(physicalName);
            continue;
          }
          throw e;
        }
        // Alta en el canvas + bloque al costado del original si está a la vista;
        // si no (o no está en este canvas), en el centro de lo que se ve (junto
        // a un original lejano, la copia quedaría fuera de la vista). En una
        // sola escritura, dentro de la cola del canvas.
        const rf = get().flow;
        const src = rf?.getNode(clip.table.id);
        const beside = src ? { x: Math.round(src.position.x + 36), y: Math.round(src.position.y + 36) } : null;
        const view = canvasView(rf, { panel: 'opens' });
        const size = tableLodSize({ ...table, physicalName, logicalName }, cols, get().viewMode);
        const centered = view ? blockSpot(view, size) : null;
        // «A la vista» = su cabecera entera (ancho × 32 px) dentro de lo que se ve
        // (con solo la esquina, la copia podría quedar a 1 px de la vista).
        const visible = (p: Point) => !view || (insideRect(p, view.rect) && insideRect({ x: p.x + size.w, y: p.y + 32 }, view.rect));
        // Dos pegados seguidos no quedan uno encima del otro (cascada); si la
        // cascada la sacaría de la vista, va al centro de lo que se ve.
        const others = nodeBoxes(rf);
        const recent = recentBoxes(rf, saId);
        const free = (p: Point) => avoidStacking(p, size, others, recent, view?.rect);
        const fallback = centered ?? beside ?? { x: 120, y: 120 };
        const pos = (beside && visible(beside) ? free(beside) : null) ?? free(fallback) ?? cascade(fallback, size, others, recent);
        const release = holdSpots(saId, [{ ...pos, w: size.w }]);
        try {
          pin.check();
          await struct.addToCanvas(saId, { tableIds: [id], layout: { [id]: pos }, ...pinsFor(saId, [id]) });
          await get().reload();
        } finally { release(); }
        // No selecciona en otra sesión ni devuelve el nombre: el llamador
        // avisaría «pasted as» en la otra sesión.
        if (!pin.holds()) return null;
        // El esquema que nació con el pegado entra a los combos de esquema.
        if (schema) void get().loadSchemas().catch(() => undefined);
        set({ selectedTableId: id, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });   // al frente + visible
        get().markFresh({ [saId]: [id] });   // y encima de lo demás aunque se deseleccione
        // El nombre de la copia que se muestra, según la faceta — también en la
        // etiqueta del Undo.
        const shown = get().viewMode === 'logical' ? logicalName || physicalName : physicalName;
        // El esquema que nació con el pegado se va con él si nadie más lo usa (una
        // tabla preexistente pudo estar en ese esquema sin catalogar: entonces queda).
        // Best-effort: un esquema sin uso que quede es inofensivo. Se borra por su
        // endpoint, que vuelve a revisar el uso en el servidor.
        // Rehacer repone el esquema como estaba al borrarlo (mismo id, nombre
        // vigente) y la copia como estaba.
        const dropPaste: HistoryStep = freshStep(async (undo) => {
          const got: { step: HistoryStep | null } = { step: null };
          await get().deleteTable(id, { onUndo: (step) => { got.step = step; } });
          let gone: DbSchema | null = null;
          if (schema) {
            undo.check();
            const use = await schemasSvc.schemaImpact(schema.id).catch(() => null);
            const doc = use && use.tables + use.views === 0
              ? (await schemasSvc.listSchemas().catch(() => [] as DbSchema[])).find((s) => s.id === schema.id) ?? null
              : null;
            if (doc) {
              undo.check();
              gone = await schemasSvc.deleteSchema(doc.id).then(() => doc, () => null);
              void get().loadSchemas().catch(() => undefined);
              get().bumpExplorer();
            }
          }
          const recreate = got.step;
          if (!recreate) return null;
          return async (redo) => {
            if (gone) await gov.recordChangesBulk([gov.bulk.upsertSchema(gone)]);
            redo.check();
            await recreate(redo);
            if (gone) void get().loadSchemas().catch(() => undefined);
            return dropPaste;
          };
        });
        pushUndo(`Paste ${facetNouns(get().viewMode).one} ${shown}`, dropPaste, pin);
        return shown;
      }
      throw lastErr instanceof Error ? lastErr : new Error("Couldn't paste the table");
    } finally { _pasteTableBusy = false; }
  }),
  tablePasteOpen: false,
  setTablePasteOpen: (open) => set({ tablePasteOpen: open }),
  colMenu: null,
  openColMenu: (m) => set({ colMenu: m }),
  closeColMenu: () => { if (get().colMenu) set({ colMenu: null }); },
  pasteTarget: null,
  setPasteTarget: (id) => set({ pasteTarget: id }),
  panelFocusColId: null,
  setPanelFocusCol: (id) => set({ panelFocusColId: id }),
  selectedColumnId: null, selectedViewId: null,
  setSelectedColumn: (id) => set({ selectedColumnId: id }),
  // Click en un nodo de vista abre su panel; cierra los demás contextos.
  setSelectedView: (id) => set({ selectedViewId: id, selectedTableId: null, selectedEdgeId: null, selectedColumnId: null }),
  focusColumnInPanel: (tableId, colId, opts) => {
    // Una columna de otra tabla también la selecciona — se enfoca (salvo que
    // quien llama ya la encuadró, como el Locate).
    const changed = tableId !== get().selectedTableId;
    set({ selectedTableId: tableId, selectedEdgeId: null, selectedColumnId: colId, selectedViewId: null });
    if (changed && opts?.frame !== false) get().frameTable(tableId, { afterClick: true });
  },
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
    const session = useSessionStore.getState();
    // Se dispara en segundo plano (`void`) — un diagrama de otra sesión en
    // pantalla se avisa aquí, nunca como un rechazo sin manejar.
    let dia: Diagram | null;
    try { dia = editableDiagram(); } catch (e) { await reportCanvasSaveError(e, session.activeChangesetId, "Couldn't save the wire route"); return; }
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
    const pin = pinSession();
    get().markDirty();
    try {
      await writeWireRoute(saId, wireId, next.length ? next : null, routableWireIds(dia.relationships));
    } catch (e) {
      // El criterio de los demás guardados del canvas (espera la revalidación
      // ante un error de la versión; qué falló + el motivo).
      await reportCanvasSaveError(e, session.activeChangesetId, "Couldn't save the wire route");
      return;
    }
    const route = (to: RoutePoint[] | null, back: RoutePoint[] | null): HistoryStep => async () => {
      await writeWireRoute(saId, wireId, to);
      return route(back, to);
    };
    pushUndo('Reroute wire', route(prev, next.length ? next : null), pin);
  },
  themes: [],
  themeIdx: new Map(),
  loadThemes: async (projectId) => {
    if (!projectId) return;
    try {
      const themes = await listThemes(projectId);
      const active = get().activeProjectId;
      if (active === projectId || active == null) set({ themes, themeIdx: themeIndex(themes) });
    } catch { /* sin themes las cajas con theme se ven sin color hasta el próximo intento */ }
  },
  canvasColors: {},
  applyCanvasColors: async (patch, label) => {
    const saId = get().activeSaId;
    const session = useSessionStore.getState();
    let dia: Diagram | null;
    try { dia = editableDiagram(); } catch (e) { await reportCanvasSaveError(e, session.activeChangesetId, "Couldn't change the color"); return false; }
    if (!saId || !dia || session.openMode !== 'editing' || !session.activeChangesetId) return false;
    if (dia.subjectArea.id !== saId) return false;
    // Solo tablas y vistas de este canvas (un selector del sistema que se
    // cierra con otro canvas abierto no deja colores huérfanos), con un color
    // válido, y solo lo que cambia.
    const onCanvas = new Set([...dia.tables.map((t) => t.id), ...(dia.views ?? []).map((v) => v.id)]);
    const next: Record<string, string | null> = {};
    const prev: Record<string, string | null> = {};
    for (const [id, ref] of Object.entries(patch)) {
      const value = ref === null ? null : normalColor(ref, true);
      if (!onCanvas.has(id) || (ref !== null && value === null)) continue;
      const before = get().canvasColors[id] ?? null;
      if (before === value) continue;
      next[id] = value;
      prev[id] = before;
    }
    const ids = Object.keys(next);
    if (!ids.length) return true;   // sin cambio real: cero requests
    const pin = pinSession();
    get().markDirty();
    try {
      await writeCanvasColors(saId, next);
    } catch (e) {
      await reportCanvasSaveError(e, session.activeChangesetId, "Couldn't change the color");
      return false;
    }
    const paint = (to: Record<string, string | null>, back: Record<string, string | null>): HistoryStep => async () => {
      await writeCanvasColors(saId, to);
      return paint(back, to);
    };
    pushUndo(label ?? (ids.length === 1 ? 'Change color' : `Change color of ${ids.length} boxes`), paint(prev, next), pin);
    return true;
  },
  setBoxColors: async (ids, ref) => {
    await get().applyCanvasColors(Object.fromEntries([...new Set(ids)].map((id) => [id, ref])));
  },
  colorPreview: null,
  setColorPreview: (p) => set({ colorPreview: p && Object.keys(p).length ? p : null }),
  setObjectColor: (id, ref) => {
    const value = ref === null ? null : normalColor(ref);
    if (ref !== null && value === null) return Promise.resolve();
    const pin = pinSession();
    // En fila con las demás escrituras de la tabla/vista (Properties).
    return inObjectOrder(id, async () => {
      pin.check();
      // El documento vigente en la working copy — no el del diagrama: su
      // recarga pudo fallar o quedar reemplazada por otra y no tener el guardado
      // anterior (se revertiría). Ni el canvas abierto: el color es de la tabla.
      const table = await gov.currentTable(id);
      const view = table ? null : await viewsSvc.currentView(id);
      pin.check();
      if (!table && !view) throw new Error('This table or view is no longer in the working copy.');
      if (((table ?? view)!.color ?? null) === value) return;
      get().markDirty();
      const reload = () => get().reload();
      if (table) {
        await gov.createTable({ ...table, color: value });
        pushUndo(`Change color of ${table.physicalName}`, fieldsStep('table', id, { color: table.color ?? null }, { color: value }, reload), pin);
      } else if (view) {
        await viewsSvc.updateView(view.id, { ...view, color: value } as ViewInput);
        pushUndo(`Change color of ${view.name}`, fieldsStep('view', id, { color: view.color ?? null }, { color: value }, reload), pin);
      }
      await get().reload();
    });
  },
  searchOpen: false,
  setSearchOpen: (v) => set({ searchOpen: v }),
  modelProps: null,
  openModelProps: (boxes) => {
    const saId = get().activeSaId;
    if (saId) set({ modelProps: boxes ? { saId, boxes: [...boxes] } : { saId } });
  },
  closeModelProps: (only) => { if (!only || get().modelProps === only) set({ modelProps: null }); },
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
  // Consumir/abandonar el foco en espera cierra también el overlay de navegación.
  setPendingFocus: (tableId, colId = null) => set({ pendingFocusTableId: tableId, pendingFocusColId: tableId ? colId : null, ...(tableId ? {} : { navigating: null }) }),
  focusColumn: (tableId, colId) => {
    get().focusTable(tableId);
    const exists = get().diagram?.columns.some((c) => c.id === colId && c.tableId === tableId);
    if (!exists) return;
    get().toggleColSelect(tableId, colId, 'single');
    // focusTable ya la encuadró (en el visor no la selecciona: sin esto se
    // encuadraría otra vez, tras la espera de un clic).
    get().focusColumnInPanel(tableId, colId, { frame: false });
  },
  drawings: [],
  justAddedDrawingId: null,
  freshNodes: {},
  markFresh: (byCanvas) => {
    // Cada llamada es una tanda encima de las anteriores del canvas — una
    // segunda carga, o una tabla creada después, queda sobre lo de la primera,
    // que sigue sobre lo que ya había (si la reemplazara, lo de la carga quedaría
    // empatado con lo existente). Un bloque que vuelve a marcarse sube a la
    // tanda más reciente; pasadas FRESH_GENERATIONS se funden las dos más
    // antiguas (descartar una devolvería lo de la carga al nivel de lo existente).
    const next = { ...get().freshNodes };
    let changed = false;
    for (const [saId, ids] of Object.entries(byCanvas)) {
      const gen = [...new Set(ids)];
      if (!gen.length) continue;
      const taken = new Set(gen);
      const gens = [...(next[saId] ?? []).map((g) => g.filter((id) => !taken.has(id))).filter((g) => g.length), gen];
      while (gens.length > FRESH_GENERATIONS) gens.splice(0, 2, [...gens[0], ...gens[1]]);
      next[saId] = gens;
      changed = true;
    }
    if (changed) set({ freshNodes: next });
  },
  addDrawing: (type) => {
    const saId = get().activeSaId; if (!saId) return;
    const rf = get().flow;
    const { w, h } = DRAWING_DEFAULT_SIZE[type];
    // Centro de lo que se ve del canvas, en coordenadas de flujo (el mismo
    // cálculo que la tabla nueva; el centro de la ventana quedaría corrido por
    // el Explorer y el toolbar). Sin canvas montado, cerca del origen.
    const c = canvasView(rf)?.center
      ?? (rf && typeof window !== 'undefined'
        ? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
        : { x: 120, y: 120 });
    // Un texto recién creado nace con el modelo de formato (fuente, color del
    // texto, sin borde ni relleno); las formas, con su borde por defecto.
    const drawing: Drawing = type === 'text'
      ? { id: crypto.randomUUID(), type, x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h,
          text: 'Text', color: null, fill: 'none', font: { size: 11, bold: true, color: '#1A2B4A' },
          align: 'left', valign: 'middle' }
      : { id: crypto.randomUUID(), type, x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h,
          color: DRAWING_DEFAULT_COLOR };
    set({ drawings: [...get().drawings, drawing], justAddedDrawingId: drawing.id });
    get().persistDrawings();
  },
  updateDrawing: (id, patch) => {
    // Un patch que no cambia nada (elegir la alineación o el tamaño
    // que ya tenía) no graba ni marca el canvas sucio.
    const cur = get().drawings.find((d) => d.id === id);
    if (!cur || Object.entries(patch).every(([k, v]) => JSON.stringify(cur[k as keyof Drawing]) === JSON.stringify(v))) return;
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
    const s = useSessionStore.getState();
    _drawingsCs = s.openMode === 'editing' ? s.activeChangesetId : null;
    _drawingsTimer = setTimeout(() => {
      _drawingsTimer = null;
      if (!stillEditing(_drawingsCs)) return;          // la sesión cambió
      // Canvas capturado al agendar el flush: si el usuario cambió de canvas
      // dentro del debounce, los drawings actuales ya son del otro canvas y
      // no deben escribirse con este disparo (selectSubjectArea hace el flush
      // del canvas anterior al cambiar).
      if (get().activeSaId !== saId) return;
      // El guardado corre en segundo plano (debounce): si falla, se avisa — un
      // error silencioso dejaría al usuario creyendo que sus dibujos persistieron.
      const cs = _drawingsCs;
      void struct.setSubjectAreaDrawings(saId, get().drawings)
        .catch((e: unknown) => reportCanvasSaveError(e, cs, "Couldn't save the drawings"));
    }, 500);
  },
  dirty: false,
  markDirty: () => { if (!get().dirty) set({ dirty: true }); },
  clearDirty: () => { if (get().dirty) set({ dirty: false }); },
  saveAll: async () => {
    // Sin sesión de edición no hay nada que guardar (la versión se transfirió,
    // eliminó o envió mientras el aviso de «Save and leave» seguía abierto): no
    // se escribe; de lo contrario la escritura caería a producción sin revisión.
    if (useSessionStore.getState().openMode !== 'editing') {
      if (_drawingsTimer) { clearTimeout(_drawingsTimer); _drawingsTimer = null; }
      set({ dirty: false });
      return;
    }
    const saId = get().activeSaId;
    // Sin el canvas de esta sesión no hay nada que guardar (tras cambiar de
    // versión, sus dibujos ya se limpiaron: grabarlos los borraría). Uno de otra
    // sesión en pantalla falla (con el motivo): no pasa por un guardado exitoso.
    if (!saId || !editableDiagram()) return;
    const pin = pinSession();   // dos escrituras seguidas
    // Capturados junto con saId: si durante el await del layout el usuario
    // cambia de canvas, get().drawings ya sería el del otro canvas y el flush
    // los escribiría bajo el saId original (pisando sus dibujos persistidos).
    const drawings = get().drawings;
    await get().saveAllLayout();
    // Flush inmediato de drawings (cancela el debounce en curso).
    if (saId) {
      if (_drawingsTimer) { clearTimeout(_drawingsTimer); _drawingsTimer = null; }
      pin.check();
      await struct.setSubjectAreaDrawings(saId, drawings);
    }
    set({ dirty: false });
  },
  focusTable: (tableId) => {
    const rf = get().flow; if (!rf) return;
    const node = rf.getNode(tableId);
    if (!node) return;
    // Seleccionar primero: montar el PropertiesPanel encoge el canvas
    // (clase has-props) y el centrado debe computarse contra el ancho final.
    // Los nodos de vista nunca abren el panel y en solo lectura se centra sin
    // seleccionar (viewer-lock).
    if (node.type !== 'view' && useSessionStore.getState().openMode !== 'readonly') {
      set({ selectedTableId: tableId, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });
    }
    // Una tabla se enfoca con sus vistas, como al seleccionarla con un clic.
    if (node.type === 'table') { get().frameTable(tableId); return; }
    // Centrar después de que el layout se asiente (doble rAF). setCenter en
    // vez de fitView: con onlyRenderVisibleElements un nodo fuera del viewport
    // no está montado ⇒ no está medido ⇒ fitView (que usa node.measured) no
    // mueve el viewport en el primer Enter; position+tamaño (con fallback)
    // están siempre disponibles aunque el nodo no exista en el DOM.
    raf(() => raf(() => {
      const n = rf.getNode(tableId); if (!n) return;
      // Una vista se encuadra como una tabla: entera si entra legible y, si es más
      // alta que el canvas, desde su cabecera (centrar su medio dejaba el nombre fuera).
      const area = n.type === 'view' ? paneSize() : null;
      if (area) {
        void rf.setViewport(focusViewport(flowBox(n, get().viewMode), [], area, rf.getZoom()), { duration: 420 });
        return;
      }
      const w = n.measured?.width ?? n.width ?? 260;
      const h = n.measured?.height ?? n.height ?? 140;
      const zoom = Math.min(1.2, Math.max(0.8, rf.getZoom()));
      void rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom, duration: 420 });
    }));
  },
  frameTable: (tableId, opts) => {
    const seq = ++_frameSeq;
    // El 2.º clic de un doble clic — también uno lento — no llega a nada (lo
    // ataja el escudo del canvas): el encuadre no espera.
    if (opts?.afterClick) dblClickShield.arm();
    const selected = get().selectedTableId === tableId;
    const target = (area: { width: number; height: number } | null): FlowViewport | null => {
      const rf = get().flow;
      const node = rf?.getNode(tableId);
      if (!rf || !area || node?.type !== 'table') return null;
      const facet = get().viewMode;
      const views = rf.getNodes().filter((n) => n.type === 'view'
        && viewSourceIds((n.data as { view?: View }).view ?? ({} as View)).includes(tableId));
      return focusViewport(flowBox(node, facet), views.map((v) => flowBox(v, facet)), area, rf.getZoom());
    };
    // La tabla dejó de estar seleccionada (se cerró el panel, se eligió otra cosa).
    const dropped = () => selected && get().selectedTableId !== tableId;
    const start = () => {
      const area = paneSize();
      const first = target(area);
      const rf = get().flow;
      if (!first || !rf || seq !== _frameSeq || dropped() || busyCanvas(get())
        || rf.getNodes().some((n) => n.dragging)) return;
      // Este encuadre interrumpe al anterior si todavía anima (la transición
      // más reciente de d3-zoom corta la vigente).
      _frameLive = seq;
      // Deseleccionada con la animación en curso, se corta donde está; también
      // si se abre un menú contextual (queda junto a su tabla). La suscripción
      // se suelta siempre (`finish`, `settle`).
      const unsub = useModelerStore.subscribe((st) => {
        if (_frameLive !== seq) { unsub(); return; }
        if ((selected && st.selectedTableId !== tableId) || st.colMenu) { unsub(); cutFrame(st.flow); }
      });
      const finish = () => { unsub(); if (_frameLive === seq) _frameLive = 0; };
      void settle(rf.setViewport(first, { duration: FRAME_MS, interpolate: 'linear' }), FRAME_MS + 300).then(() => raf(() => raf(() => {
        // Lejos, el canvas dibuja cajas compactas (LOD) de otro tamaño que el
        // detalle: al acercarse cambian y el grupo quedaría corrido. Se corrige
        // con lo medido — salvo que el usuario ya movió el canvas, eligió otra
        // cosa o cerró el panel (el área cambió).
        const now = get().flow;
        const area2 = paneSize();
        const fixed = now && seq === _frameSeq && _frameLive === seq && sameViewport(now.getViewport(), first) && !dropped()
          && !busyCanvas(get()) && area2 && area && area2.width === area.width && area2.height === area.height ? target(area2) : null;
        if (now && fixed && !sameViewport(fixed, first)) void settle(now.setViewport(fixed, { duration: 150, interpolate: 'linear' }), 150 + 300).then(finish);
        else finish();
      })));
    };
    // Después de que el panel de Properties se monte y el canvas se achique.
    raf(() => raf(start));
  },
  openCanvasAndFocus: async (canvasId, projectId, tableId, colId, label) => {
    // Ya abierto → el nodo está montado, centrar directo (sin pending).
    if (get().activeSaId === canvasId) {
      if (colId) get().focusColumn(tableId, colId); else get().focusTable(tableId);
      return;
    }
    // Overlay bloqueante mientras se abre el canvas y se centra — sin él,
    // cerrar el popup y esperar daría la sensación de que no pasó nada.
    const canvasName = (projectId ? get().trees[projectId]?.subjectAreas : undefined)?.find((s) => s.id === canvasId)?.name
      ?? get().subjectAreas.find((s) => s.id === canvasId)?.name ?? '';
    set({ navigating: { canvas: canvasName, target: label } });
    // Cambio de canvas: primero se carga el diagrama destino y recién después
    // se deja la tabla a enfocar (el diagrama ya es el del destino cuando el
    // efecto de ModelerCanvas la consume ⇒ no centra sobre una tabla homónima
    // del canvas de origen). Los nodos aún no montaron, así que el efecto
    // poll-ea por rAF.
    try {
      await get().selectSubjectArea(canvasId, projectId ?? undefined);
    } catch (e) {
      set({ navigating: null });
      throw e;
    }
    if (get().activeSaId !== canvasId) { set({ navigating: null }); return; }   // otro select ganó
    set({ pendingFocusTableId: tableId, pendingFocusColId: colId ?? null });
  },
  loadProjects: async () => {
    const seq = _explorerSeq;   // ídem loadSchemas
    let projects: Project[];
    try {
      projects = await struct.listProjects();
    } catch (e) {
      // Si un refresco más reciente la dejó atrás, su error tampoco cuenta —
      // el refresco trae (y avisa) lo suyo: una caída, un aviso.
      if (seq !== _explorerSeq) return;
      throw e;
    }
    if (seq !== _explorerSeq) return;
    for (const p of projects) _projectNames.set(p.id, p.name);
    set({ projects });
  },
  selectProject: async (pid) => {
    const { isCurrent } = explorerRequest();   // respuesta de otra sesión → no escribe
    const [folders, subjectAreas] = await Promise.all([struct.listFolders(pid), struct.listSubjectAreas(pid)]);
    if (!isCurrent()) return;
    set((s) => ({
      activeProjectId: pid, folders, subjectAreas, activeFolderId: null, activeSaId: null,
      diagram: null, selectedTableId: null, drawings: [],
      // El clipboard sobrevive (se pega en otro proyecto); la selección y los popups no.
      colSel: null, colMenu: null, pasteTarget: null, tablePasteOpen: false, panelFocusColId: null, selectedColumnId: null, selectedViewId: null,
      trees: { ...s.trees, [pid]: { folders, subjectAreas } },
    }));
  },
  selectFolder: (folderId) => set({ activeFolderId: folderId }),
  loadProjectTree: async (pid) => {
    const { isCurrent } = explorerRequest();   // respuesta de otra sesión → no escribe
    const [folders, subjectAreas] = await Promise.all([struct.listFolders(pid), struct.listSubjectAreas(pid)]);
    if (!isCurrent()) return;
    set((s) => ({ trees: { ...s.trees, [pid]: { folders, subjectAreas } } }));
  },
  refreshExplorer: async () => {
    // Solo el refresco más reciente escribe (`_explorerSeq`).
    const seq = ++_explorerSeq;
    const stale = () => seq !== _explorerSeq;
    // Toda carga del diagrama pedida antes de este refresco (la recarga del
    // refresco anterior, un clic en el Explorer, un reload) es de otra sesión o
    // de un árbol desactualizado: se descarta al llegar — si el canvas no existe
    // aquí, este refresco no lo abre y nada más subiría `_loadSeq`. Su spinner,
    // fuera.
    _loadSeq += 1;
    const prevSaId = get().activeSaId;
    // Un canvas que se estaba abriendo (clic en el Explorer justo antes de
    // Refresh) es el que el usuario quiere: se abre al final si sigue
    // existiendo; sin esto, esta invalidación lo perdería en silencio.
    const openingTarget = get().openingSaId;
    // La sesión de canvas es de un solo proyecto — el explorer muestra ese y
    // solo ese; el resto de proyectos no se carga ni se lista.
    const pid = useSessionStore.getState().activeProjectId;
    set({ trees: {}, projects: [], projectDeletionPending: false, openingSaId: null });
    const gone = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 409);
    // Un 403/404 de la versión abierta no es un proyecto borrado. Se espera la
    // revalidación de la sesión: si la cambió (transferida o eliminada), ella
    // ya avisó y aquí se termina en silencio; si no, el error es real y sigue
    // al llamador. La versión se toma al pedir: cuando el error llega, la
    // revalidación pudo haber cerrado ya la sesión.
    const askedCs = useSessionStore.getState().activeChangesetId;
    const askedKey = sessionNow();
    const versionError = (e: unknown) => isVersionError(e, askedCs);
    const sessionMoved = async (e: unknown) => {
      if (!versionError(e)) return false;
      await afterRevalidation();
      // La sesión (modo, proyecto y versión), no solo la versión — pasar a
      // solo lectura sobre la misma también es otra sesión.
      return sessionNow() !== askedKey;
    };
    // Lo que no corta el refresco (esquemas, recarga del canvas) se avisa solo
    // si la sesión sigue siendo la pedida — mismo criterio que el Explorer
    // (sessionGuard).
    const stillAsked = async (e: unknown) =>
      !stale() && (await stillAskedSession(e, askedCs, askedKey, sessionNow)) && !stale();
    // Los dropdowns de esquema también dependen del overlay de la versión.
    // Su error se avisa solo si el resto del refresco anduvo — si no, ya hay
    // un aviso (el del refresco o el del canvas): una caída, un aviso.
    const schemasLoad = get().loadSchemas().then(() => null, (e: unknown) => ({ e }));
    /** El refresco; true si terminó completo (sin cortar ni avisar nada). */
    const body = async (): Promise<boolean> => {
      try {
        await get().loadProjects();
      } catch (e) {
        if (stale() || await sessionMoved(e)) return false;
        if (versionError(e) || !gone(e)) throw e;
      }
      if (stale()) return false;
      const valid = new Set(get().projects.map((p) => p.id));
      if (!pid || !valid.has(pid)) {
        // El proyecto fue borrado en una versión publicada (o no existe en este
        // contexto): cerrar la sesión de canvas y volver al chooser.
        set({ activeProjectId: null, folders: [], subjectAreas: [], activeFolderId: null,
              activeSaId: null, diagram: null, selectedTableId: null, drawings: [],
              colSel: null, colMenu: null, pasteTarget: null, tablePasteOpen: false, panelFocusColId: null, selectedColumnId: null, selectedViewId: null });
        if (pid) {
          toast.error('This project was deleted in a published version.');
          useSessionStore.getState().closeModel();
        }
        return false;
      }
      set({ activeProjectId: pid });
      try {
        // Depura activeSaId contra la membresía recién leída (si el refresco sigue vigente).
        await get()._refreshProject(pid, () => !stale());
      } catch (e) {
        if (stale() || await sessionMoved(e)) return false;
        if (versionError(e) || !gone(e)) throw e;
        toast.error('This project was deleted in a published version.');
        useSessionStore.getState().closeModel();
        return false;
      }
      if (stale()) return false;
      const saId = get().activeSaId;
      const reopen = openingTarget && get().subjectAreas.some((x) => x.id === openingTarget) ? openingTarget
        : saId && saId === prevSaId ? saId : null;
      // Sin reapertura, una recarga en espera no tiene quién la resuelva — el
      // canvas ya no está.
      if (!reopen) _reloadAfterOpening = null;
      if (reopen) {
        // El canvas sobrevive al cambio de contexto: se recarga completo
        // (diagrama + drawings) bajo el overlay de la versión activa.
        try { await get().selectSubjectArea(reopen); }
        catch (e) {
          // Si la sesión cambió, el refresco de la sesión vigente decide qué
          // canvas queda; si no, se cierra (su diagrama es de la sesión
          // anterior) y se dice por qué, en lugar de cerrarse en silencio.
          if (!(await stillAsked(e))) return false;
          set({ activeSaId: null, diagram: null, selectedTableId: null, drawings: [], colSel: null, colMenu: null, pasteTarget: null, tablePasteOpen: false, panelFocusColId: null, selectedColumnId: null, selectedViewId: null });
          toast.error(`Couldn't reload the canvas: ${reasonOf(e)}. Open it again from the explorer.`,
            { id: `dmh-canvas-reload:${askedKey}` });
          return false;
        }
      }
      return true;
    };
    if (!(await body())) return;
    void schemasLoad.then(async (failed) => {
      if (!failed || !(await stillAsked(failed.e))) return;
      toast.error(`Couldn't load the schemas: ${reasonOf(failed.e)}. Use Refresh in the explorer to try again.`,
        { id: `dmh-schemas-load:${askedKey}` });
    });
  },
  selectSubjectArea: async (saId, projectId) => {
    // Flush inmediato de drawings por guardar del canvas anterior: el debounce
    // de 500ms perdería el último trazo al cambiar de canvas.
    flushPendingDrawings(get().activeSaId, get().drawings);
    const seq = ++_loadSeq;
    _openingSeq = seq;
    const upTo = _notes;   // lo anotado hasta aquí lo trae esta apertura
    const pin = pinSession();   // el sello de la sesión del diagrama
    set({ openingSaId: saId });
    let installed = false;
    let threw = false;   // la apertura falló — quien la pidió lo avisa
    try {
      const asked = canvasClock();
      const loaded = await mod.loadDiagram(saId);
      // Descarta respuestas desfasadas: si mientras cargaba el usuario seleccionó
      // otro canvas (o corrió otro reload), pisar el diagrama con esta
      // respuesta dejaría el canvas mostrando un subject area ajeno.
      if (seq !== _loadSeq) return;
      const diagram = sealDiagram(withWrittenCanvas(loaded, asked), pin);
      // Si el canvas es de otro proyecto, ese pasa a ser el activo y se espejan
      // los campos `folders`/`subjectAreas` desde el cache del árbol.
      let crossProject = {};
      const pid = projectId ?? null;
      if (pid && pid !== get().activeProjectId) {
        const tree = get().trees[pid]
          ?? { folders: await struct.listFolders(pid), subjectAreas: await struct.listSubjectAreas(pid) };
        // El fetch del árbol agrega awaits después del primer guard: se vuelve a
        // chequear antes del set final — otro select pudo ganar mientras tanto y
        // esta respuesta desfasada pisaría su canvas.
        if (seq !== _loadSeq) return;
        crossProject = { activeProjectId: pid, folders: tree.folders, subjectAreas: tree.subjectAreas, activeFolderId: null };
      }
      // La selección/menú/popup son del canvas anterior; el clipboard sobrevive
      // al cambio de canvas (copiar en A, pegar en B). También se limpia el wire
      // seleccionado — la misma relación puede estar en el canvas destino y
      // aparecería seleccionada, con sus tiradores a la vista.
      installed = true;
      settleOwed(upTo, null);
      sawOthers(diagram.draftSeq);
      sawDraft(diagram.draftSeq);
      set({ ...crossProject, activeSaId: saId, diagram, selectedTableId: null, selectedEdgeId: null,
            colSel: null, colMenu: null, pasteTarget: null, tablePasteOpen: false, panelFocusColId: null, selectedColumnId: null, selectedViewId: null,
            drawings: diagram.subjectArea.drawings ?? [] });
      // Reglas de naming del proyecto del canvas (best-effort, no bloquea).
      void get().loadNaming(pid ?? get().activeProjectId);
      // Themes de color del proyecto (best-effort, no bloquea).
      void get().loadThemes(pid ?? get().activeProjectId);
    } catch (e) {
      threw = true;
      throw e;
    } finally {
      // Solo la apertura que puso el spinner lo apaga: una anterior descartada
      // no apaga el de la que sigue en vuelo (y una invalidada por otra carga
      // no lo deja pegado).
      if (seq === _openingSeq && get().openingSaId === saId) {
        set({ openingSaId: null });
        // La recarga pedida durante esta apertura.
        const pending = _reloadAfterOpening;
        _reloadAfterOpening = null;
        if (pending?.saId === saId) {
          if (installed) await reloadAfterOpening(pending.prev);   // el mismo: su foto pudo ser previa al guardado
        } else if (installed) {
          if (pending) get().bumpExplorer();                       // se abrió otro: el Explorer igual se entera
          // Lo escrito mientras se abría pudo quedar fuera de su foto.
          if (owedSince(upTo)) await get().reload();
        } else if (pending) {
          // Falló: sigue el editado, con la foto previa. Si su recarga también
          // falla, cierra el canvas sin otro aviso — el de la apertura ya cuenta
          // la caída.
          await reloadAfterOpening(pending.prev, threw);
        }
      }
    }
  },
  // ── Folders / Canvas / Projects (gestión del Model Explorer) ───────────
  loadFolders: async (projectId) => {
    const { isCurrent } = explorerRequest();   // respuesta de otra sesión → no escribe
    const folders = await struct.listFolders(projectId);
    if (isCurrent()) set({ folders });
  },
  // Refresca folders+canvases del proyecto activo tras una mutación y deja
  // `activeSaId` inválido en null (su canvas pudo haberse borrado).
  // Cada una relee el árbol solo si sigue la sesión en que se pidió
  // (`explorerRequest`): la respuesta tardía de un draft no pisa el Explorer
  // de la versión que se abrió después.
  createFolder: async (projectId, parentFolderId, name) => {
    const { isCurrent } = explorerRequest();
    await struct.createFolder(projectId, parentFolderId, name);
    await get()._refreshProject(projectId, isCurrent);
  },
  renameFolder: async (id, name, projectId) => {
    const { isCurrent } = explorerRequest();
    await struct.renameFolder(id, name);
    const pid = projectId ?? get().activeProjectId; if (pid) await get()._refreshProject(pid, isCurrent);
  },
  deleteFolder: async (id, projectId) => {
    const { isCurrent } = explorerRequest();
    await struct.deleteFolder(id);
    const pid = projectId ?? get().activeProjectId; if (pid) await get()._refreshProject(pid, isCurrent);
  },
  createCanvas: async (projectId, folderId, name) => {
    const { isCurrent, pin } = explorerRequest();
    const sa = await struct.createSubjectArea(projectId, name, folderId);
    await get()._refreshProject(projectId, isCurrent);
    // En otra sesión el canvas recién creado no existe (se creó en el draft de origen).
    if (!pin.holds()) return;
    await get().selectSubjectArea(sa.id, projectId);
  },
  renameCanvas: async (id, name, projectId) => {
    const pid = projectId ?? get().activeProjectId; if (!pid) return;
    const { isCurrent } = explorerRequest();
    const pool = get().trees[pid]?.subjectAreas ?? get().subjectAreas;
    const sa = pool.find((s) => s.id === id);
    await struct.updateSubjectArea(id, { projectId: pid, name, folderId: sa?.folderId ?? null });
    await get()._refreshProject(pid, isCurrent);
  },
  deleteCanvas: async (id, projectId) => {
    const { isCurrent } = explorerRequest();
    await struct.deleteSubjectArea(id);
    const pid = projectId ?? get().activeProjectId; if (pid) await get()._refreshProject(pid, isCurrent);
  },
  moveCanvas: async (id, folderId) => {
    const pid = get().activeProjectId; if (!pid) return;
    const sa = get().subjectAreas.find((s) => s.id === id); if (!sa) return;
    const { isCurrent } = explorerRequest();
    await struct.updateSubjectArea(id, { projectId: pid, name: sa.name, folderId });
    await get()._refreshProject(pid, isCurrent);
  },
  renameProject: async (id, name) => {
    await struct.renameProject(id, name);
    _projectNames.set(id, name);
    set({ projects: get().projects.map((p) => (p.id === id ? { ...p, name } : p)) });
  },
  deleteProject: async (id) => {
    // Un solo cambio en la working copy; la cascada la hace el servidor al
    // aplicar la versión aprobada. El canvas cede al panel de borrado.
    await struct.deleteProject(id);
    get().markDirty();
    set({ projectDeletionPending: true, selectedTableId: null, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });
  },
  projectDeletionPending: false,
  undoProjectDeletion: async () => {
    const pid = get().activeProjectId;
    if (!pid) return;
    const pin = pinSession();   // lee y después escribe
    const published = (await mod.listProjects()).find((p) => p.id === pid);
    if (!published) throw new Error('The published project could not be read.');
    pin.check();
    await struct.reviveProject(pid, published);
    set({ projectDeletionPending: false });
    await get().refreshExplorer();
  },
  // Helper interno: recarga folders+canvases del proyecto al cache `trees` y,
  // si es el proyecto activo, espeja `folders`/`subjectAreas` y depura la
  // selección (el canvas activo pudo haberse borrado).
  _refreshProject: async (projectId, isCurrent) => {
    const [folders, subjectAreas, projectDeletionPending] = await Promise.all([
      struct.listFolders(projectId), struct.listSubjectAreas(projectId), struct.projectDeletionPending(projectId),
    ]);
    if (isCurrent && !isCurrent()) return;   // respuesta de un refresco ya superado
    const st = get();
    const treesPatch = { trees: { ...st.trees, [projectId]: { folders, subjectAreas } }, projectDeletionPending };
    if (projectId !== st.activeProjectId) { set(treesPatch); return; }
    const activeFolderId = st.activeFolderId && folders.some((f) => f.id === st.activeFolderId) ? st.activeFolderId : null;
    const saStillExists = st.activeSaId != null && subjectAreas.some((s) => s.id === st.activeSaId);
    set({
      ...treesPatch,
      folders, subjectAreas, activeFolderId,
      ...(saStillExists ? {} : { activeSaId: null, diagram: null, selectedTableId: null, drawings: [], colSel: null, colMenu: null, pasteTarget: null, tablePasteOpen: false, panelFocusColId: null, selectedColumnId: null, selectedViewId: null }),
    });
  },
  loadNaming: async (projectId) => {
    if (!projectId) return;
    try {
      const naming = await getNamingConfig(projectId);
      // Cambio rápido de canvas entre proyectos: solo aplica si sigue activo.
      // Sin canvas abierto (activeProjectId null) también se cachea — el
      // Object Inspector aplica la regla de case al físico tipeado.
      const active = get().activeProjectId;
      if (active === projectId || active == null) set({ naming });
    } catch { /* sin config el front asume upper (default del backend) */ }
  },
  reload: async (opts) => {
    const quiet = _quietReloadFailure;
    _quietReloadFailure = false;
    const id = get().activeSaId; if (!id) return;
    // Con una apertura de canvas en vuelo (clic en el Explorer, reapertura del
    // refresco) esa trae el diagrama al día — recargar en ese momento la
    // invalidaría y dejaría el spinner pegado.
    if (get().openingSaId) {
      // Lo resuelve esa apertura al terminar (con el diagrama actual para el
      // aviso al Explorer).
      _reloadAfterOpening ??= { saId: id, prev: get().diagram };
      return;
    }
    // Recorte: solo las tablas pendientes (lo escrito que todavía no está en
    // pantalla, también lo de un recorte en vuelo, que esta reemplaza), si todo
    // se acota a tablas, el canvas en pantalla es este y no hay un diagrama
    // completo en vuelo. Si no, el diagrama completo.
    const fullInFlight = _lastLoad?.seq === _loadSeq && _lastLoad.tables === null;
    const upTo = _notes;
    const lot = new Set(_owed.tables.keys());
    const sliced = !opts?.full && !_owed.full && !fullInFlight
      && liveDiagram()?.subjectArea.id === id && lot.size > 0 && lot.size <= SLICE_MAX_TABLES;
    const seq = ++_loadSeq;
    _lastLoad = { seq, tables: sliced ? lot : null };
    const pin = pinSession();   // el sello de la sesión del diagrama
    const askedCs = useSessionStore.getState().activeChangesetId;
    const asked = canvasClock();
    let loaded: Diagram;
    try {
      loaded = await mod.loadDiagram(id, sliced ? { tableIds: [...lot] } : undefined);
    } catch (e) {
      // Un error de la versión espera la revalidación (si la sesión cambió,
      // ella avisó y el canvas ya se limpió). Cualquier otra falla también
      // cierra el canvas, y lo dice — lo que había en pantalla es previo a la
      // escritura que acaba de terminar y editar desde ahí (store, paneles,
      // popups) pisaría lo grabado. Sin reintento automático: se reabre desde
      // el Explorer. Un 404, con su propio aviso.
      if (touchesVersion(e, askedCs)) await afterRevalidation();
      if (seq !== _loadSeq || get().activeSaId !== id) return;   // otra carga (o la sesión cambió: sube `_loadSeq`)
      // Un dibujo del debounce se guarda antes de cerrar (el canvas sigue
      // existiendo); con el 404 el canvas ya no está.
      if (!(e instanceof ApiError && e.status === 404)) flushPendingDrawings(id, get().drawings);
      set({ activeSaId: null, diagram: null, selectedTableId: null, drawings: [], colSel: null, colMenu: null, pasteTarget: null, tablePasteOpen: false, panelFocusColId: null, selectedColumnId: null, selectedViewId: null });
      if (e instanceof ApiError && e.status === 404) {
        toast.error('This canvas is no longer in this version, so it was closed. Open another one from the explorer.', { id: `dmh-canvas-reload:${sessionNow()}` });
      } else if (!quiet) {
        toast.error(`Couldn't reload the canvas: ${reasonOf(e)}. Open it again from the explorer.`, { id: `dmh-canvas-reload:${sessionNow()}` });
      }
      return;
    }
    // Descarta respuestas desfasadas (cambio de canvas o carga más reciente en vuelo).
    if (seq !== _loadSeq || get().activeSaId !== id) return;
    _lastLoad = null;
    // Un recorte se funde en el diagrama en pantalla. Si el canvas cambió fuera
    // de él (membresía) o alguien más escribió en el draft, va el completo; si
    // otra versión cambió lo publicado (sello), el completo después, sin
    // esperarlo. Un servidor sin recortes responde el completo.
    let fresh = loaded;
    let published = false;
    if (isSlice(loaded)) {
      const base = liveDiagram();
      if (!base || base.subjectArea.id !== id || membershipChanged(base, loaded) || othersWrote(loaded.draftSeq)) {
        _quietReloadFailure = quiet;
        await get().reload({ full: true });
        return;
      }
      fresh = mergeSlice(base, loaded);
      published = loaded.productionStamp !== base.productionStamp;
      settleOwed(upTo, new Set(loaded.slice.tableIds));
      sawDraft(loaded.draftSeq);   // hasta aquí, todo lo escrito fue de esta pestaña
    } else {
      settleOwed(upTo, null);
      sawOthers(loaded.draftSeq);
      sawDraft(loaded.draftSeq);
    }
    // Si algo del canvas se grabó después de pedir este diagrama, se repone
    // (la foto puede ser previa a ese guardado).
    const diagram = sealDiagram(withWrittenCanvas(fresh, asked), pin);
    const prev = get().diagram;
    set({ diagram });
    // Un cambio estructural del mismo canvas (tabla/vista nueva,
    // borrada o renombrada, columnas) invalida el catálogo del Explorer; cambiar
    // de canvas no (el inventario es del proyecto, no del canvas).
    if (prev && prev.subjectArea.id === diagram.subjectArea.id && diagramSignature(prev) !== diagramSignature(diagram)) {
      get().bumpExplorer();
    }
    if (published) void get().reload({ full: true });
  },
  saveLayout: (tableId, pos) => get().saveNodePositions({ [tableId]: pos }),
  saveNodePositions: async (positions) => {
    const saId = get().activeSaId; if (!saId) return;
    // El canvas de esta sesión; uno de otra en pantalla se avisa aquí
    // (segundo plano: nunca un rechazo sin manejar).
    let dia: Diagram | null;
    try { dia = editableDiagram(); } catch (e) { await reportCanvasSaveError(e, editingCs(), "Couldn't save the position"); return; }
    if (!dia) return;
    // Solo los bloques del canvas en pantalla — uno de otro canvas (pintado
    // por error bajo este) no entra a su layout.
    const onCanvas = canvasNodeIds(dia);
    const ids = Object.keys(positions).filter((id) => onCanvas.has(id));
    if (!ids.length) return;
    get().markDirty();
    // Las posiciones quedan también en el diagrama del store, en sitio (sin
    // cambiar su identidad, que re-armaría el canvas). El diagrama guarda el
    // layout de su última carga y el canvas se re-arma con él al pasar de
    // Logical a Physical o al guardar Model properties: sin esto el bloque
    // recién movido volvería a su sitio previo hasta el siguiente reload — y un
    // trazo manual quedaría referido a una posición distinta de la de pantalla.
    // En píxeles enteros, igual que lo que se graba.
    const at: Record<string, { x: number; y: number }> = {};
    for (const id of ids) at[id] = wholePoint({ x: positions[id].x, y: positions[id].y });
    const sa = liveDiagram()?.subjectArea;
    if (sa && sa.id === saId) sa.layout = { ...(sa.layout ?? {}), ...at };
    // El canvas lo dispara en segundo plano (`void`): un fallo se avisa aquí,
    // con el criterio de los dibujos — nunca un rechazo sin manejar. Todos los
    // bloques movidos juntos van en una sola escritura (el backend hace merge).
    const cs = editingCs();
    try {
      await struct.setSubjectAreaLayout(saId, at);
    } catch (e) {
      await reportCanvasSaveError(e, cs, "Couldn't save the position");
    }
  },
  saveAllLayout: async () => {
    const saId = get().activeSaId; const rf = get().flow;
    if (!saId || !rf || !editableDiagram()) return;
    const layout: Record<string, { x: number; y: number }> = {};
    // Tablas y vistas (la posición de una vista vive en layout[viewId], misma
    // estructura) y símbolos de subcategoría (layout[symbolId]); los shapes
    // no — sus posiciones viven en `drawings`.
    for (const n of rf.getNodes()) if (n.type === 'table' || n.type === 'view' || n.type === 'subcat') layout[n.id] = { x: n.position.x, y: n.position.y };
    await struct.setSubjectAreaLayout(saId, layout); // el backend hace merge
  },
  autoOrganize: async () => {
    const dia = editableDiagram(); const saId = get().activeSaId;
    if (!dia || !saId) return;
    const pin = pinSession();   // el cálculo de ELK es asíncrono
    // En modo visor el arrange es de esta sesión — ni dirty ni persistencia.
    const viewer = useSessionStore.getState().openMode === 'readonly';
    if (!viewer) get().markDirty();
    // Estado previo al arrange, para el Undo — posiciones de los nodos vivos
    // (las mismas que guarda Save) y trazos manuales del canvas. Se toman antes
    // de calcular — si mientras ELK trabaja se abre otro canvas, los nodos
    // vivos ya serían de ese.
    const prevRoutes = get().canvasRoutes;
    const prevLayout: Record<string, { x: number; y: number }> = {};
    for (const n of get().flow?.getNodes() ?? []) {
      if (n.type === 'table' || n.type === 'view' || n.type === 'subcat') {
        prevLayout[n.id] = { x: n.position.x, y: n.position.y };
      }
    }
    // Grafo + ELK + símbolos de subcategoría en `arrangeGraph.ts` (lo comparte
    // el arrange headless de la carga masiva). Tamaños medidos de los nodos
    // vivos: ELK con tamaño fijo superpondría las tablas altas (30 columnas ≈
    // 700px); un nodo sin medir cae a la estimación LOD.
    const { arrangeDiagram } = await import('@/features/modeler/lib/arrangeGraph');
    const measured = new Map((get().flow?.getNodes() ?? []).map((n) => [n.id, n.measured]));
    const pos = await arrangeDiagram(dia, (id) => {
      const m = measured.get(id);
      return m?.width != null && m?.height != null ? { width: m.width, height: m.height } : undefined;
    }, get().viewMode);
    if (viewer) {
      // Solo en la sesión y el canvas donde empezó — los nodos vivos pueden ser
      // ya los del draft que se abrió mientras ELK calculaba (y un Save los
      // grabaría) o los de otro canvas (tablas homónimas).
      if (!pin.holds() || get().activeSaId !== saId) return;
      // Se aplica a los nodos vivos y se recuerda por canvas (viewerLayout) para
      // que un re-armado del diagrama no lo pierda; nunca viaja al backend.
      // Con todos los bloques en otro sitio, los trazos manuales publicados
      // dejan de calzar — se ocultan en esta sesión (igual de efímero).
      set((st) => ({
        viewerLayout: { ...st.viewerLayout, [saId]: { ...(st.viewerLayout[saId] ?? {}), ...pos } },
        viewerRoutesOff: { ...st.viewerRoutesOff, [saId]: true },
      }));
      get().flow?.setNodes((nodes) => nodes.map((n) => (pos[n.id] ? { ...n, position: pos[n.id] } : n)));
      return;
    }
    // Posiciones calculadas (el backend hace merge) y trazos reiniciados en una
    // sola escritura del canvas: nunca quedan posiciones del arrange con trazos
    // que no les corresponden.
    pin.check();
    await struct.arrangeSubjectArea(saId, pos);
    showRoutes(saId, () => ({}));
    // Deshacer repone posiciones y trazos previos; rehacer, las calculadas con
    // los trazos en cero (como al ordenar). Con otro canvas abierto, solo graba.
    const arranged: HistoryStep = async () => {
      await struct.arrangeSubjectArea(saId, pos);
      if (get().activeSaId !== saId) return before;
      showRoutes(saId, () => ({}));
      await get().reload();
      return before;
    };
    const before: HistoryStep = async () => {
      await struct.arrangeSubjectArea(saId, prevLayout, prevRoutes);
      if (get().activeSaId !== saId) return arranged;
      showRoutes(saId, () => prevRoutes);
      await get().reload();
      return arranged;
    };
    pushUndo('Auto-arrange', before, pin);
    await get().reload();
  },
  createTable: async (input: { logicalName: string; physicalName?: string; schema?: string; mode?: 'logical' | 'physical'; description?: string; udpValues?: Record<string, string> }) => {
    const saId = get().activeSaId; if (!saId) throw new Error('Pick a Subject Area');
    const pin = pinSession();
    get().markDirty();
    const id = crypto.randomUUID();
    // Físico: explícito (New table modal, ya auto-physicalizado scope:'table') →
    // si no, según `mode` ('physical' = tal cual; 'logical'/undefined = derivar).
    const physical = (input.physicalName?.trim())
      || (input.mode === 'physical' ? input.logicalName : (await gov.physicalize(input.logicalName, 'table')).physical);
    const schema = input.schema?.trim() || undefined;
    // El alta captura definición funcional y UDPs (payload limpio, solo con
    // contenido — mismo criterio del alta de columna).
    const description = input.description?.trim() || undefined;
    const udpValues = input.udpValues && Object.keys(input.udpValues).length ? input.udpValues : undefined;
    pin.check();
    await gov.createTable({
      id, logicalName: input.logicalName, physicalName: physical, schema,
      ...(description ? { description } : {}),
      ...(udpValues ? { udpValues } : {}),
    });
    // Referencia la tabla creada en la Subject Area, con su posición, en el
    // centro de lo que se ve (misma escritura).
    const spot = newTableSpot(get().flow, saId, { physicalName: physical, logicalName: input.logicalName, schema }, [], get().viewMode);
    const release = holdSpots(saId, spot ? [spot] : []);
    try {
      pin.check();
      // Sin posición para la tabla creada, no se fija nada (caería en su
      // casilla por número de orden, encima de una tabla fijada).
      await struct.addToCanvas(saId, { tableIds: [id], ...(spot ? { layout: { [id]: { x: spot.x, y: spot.y } }, ...pinsFor(saId, [id]) } : {}) });
      await get().reload();
    } finally { release(); }
    if (!pin.holds()) return;   // lo que sigue es de la sesión de la acción
    // La tabla creada queda seleccionada → sube al frente (zIndex) y no cae
    // oculta detrás de un bloque que ya estaba en el canvas; y sigue encima de
    // lo demás aunque se deseleccione.
    set({ selectedTableId: id, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });
    get().markFresh({ [saId]: [id] });
    // Undo: tabla recién creada — la cascada del delete es trivial.
    pushUndo(`Create table ${physical}`, tableDrop(id), pin);
  },
  addColumn: async (tableId: string, input: AddColumnInput) => {
    const dia = editableDiagram(); if (!dia) return;   // el canvas de esta sesión
    const pin = pinSession();
    get().markDirty();
    const id = crypto.randomUUID();
    // En modo Physical lo tipeado es el físico → se persiste con la regla de
    // case del scope (el backend la aplica igual en el choke point); el
    // lógico queda tal cual. En modo Logical el motor ya la aplicó.
    const physical = input.mode === 'logical'
      ? (await gov.physicalize(input.logicalName)).physical
      : applyNamingCase(input.logicalName, get().naming?.column.case);
    const domains = await gov.listDomains();
    const dom = domains.find((d) => d.id === input.parentDomainId);
    const override = (input.dataType ?? '').trim();
    // El default del dominio se homologa a la grafía canónica (espejo de
    // canonicalize_default_type) — un dominio cargado con `Array` hereda
    // `ARRAY<>`, no el texto crudo de la BD sin homologar.
    const domDefault = canonicalDefaultType(dom?.defaultDataType);
    const dataTypeBase = override || domDefault || '';
    // Faceta lógica del tipo heredada del dominio (homologada). En modo
    // Logical el popup manda el tipo lógico tipeado; si difiere del lógico del
    // dominio es un override lógico.
    const domLogical = dom?.logicalDataType ? canonicalDefaultType(dom.logicalDataType) : '';
    const typedLogical = canonicalDefaultType(input.logicalDataType) || '';
    const logicalBase = typedLogical || domLogical;
    // Un complejo es el mismo en las dos facetas. Un complejo tipeado
    // va a las dos con la misma grafía homologada (gana al default del dominio,
    // `ARRAY<>` incluido); si no, el complejo con estructura de una faceta
    // completa a la otra (p. ej. el `ARRAY<>` genérico de un dominio).
    const typed = input.mode === 'logical' ? (input.logicalDataType ?? '').trim() : override;
    const typedComplex = isComplexTypeStart(typed) ? canonicalDefaultType(typed) : '';
    const dataType = typedComplex || (input.mode === 'logical' ? mirrorComplex(typedLogical, dataTypeBase) : dataTypeBase);
    const logicalType = typedComplex || (input.mode === 'physical' ? mirrorComplex(override, logicalBase) : logicalBase);
    const logicalOverridden = !!dom && !!logicalType && logicalType !== domLogical;
    // Al final del orden físico — coherente con la propagación a vistas de
    // abajo. Una PK agregada entra tras la última PK y las no-PK se corren en
    // el mismo lote (la tabla queda PK primero).
    const siblings = dia.columns.filter((c) => c.tableId === tableId);
    const layout = input.isPrimaryKey ? pkFirstOrdinals(siblings, { toKey: [id], add: [{ id }] }) : null;
    const ordinal = layout ? layout.get(id)!
      : siblings.length ? Math.max(...siblings.map((c) => c.ordinal)) + 1 : 0;
    const shifts = siblings.filter((c) => layout?.has(c.id)).map((c) => gov.bulk.createColumn({ ...c, ordinal: layout!.get(c.id)! }));
    // Metadata del alta: payload limpio como en edición — flags solo cuando
    // se apartan del default (nullable true es el default: no viaja),
    // description/udpValues solo con contenido.
    const description = (input.description ?? '').trim();
    const physicalDescription = (input.physicalDescription ?? '').trim();
    const payload: CanonicalColumn = {
      id, tableId, logicalName: input.logicalName, physicalName: physical,
      // El popup muestra el default del dominio en el campo de tipo, así que
      // recibir dataType no equivale a override. Con dominio, el override real
      // es tipo ≠ default; sin dominio, un tipo tipeado es override.
      parentDomainId: input.parentDomainId || undefined, dataType,
      typeOverridden: dom ? dataType.trim() !== domDefault : !!override,
      ...(logicalType ? { logicalDataType: logicalType, logicalTypeOverridden: logicalOverridden } : {}),
      ordinal,
      ...(description ? { description } : {}),
      ...(physicalDescription ? { physicalDescription } : {}),
      ...(input.isPrimaryKey ? { isPrimaryKey: true } : {}),
      ...(input.isForeignKey ? { isForeignKey: true } : {}),
      ...(input.isNullable === false ? { isNullable: false } : {}),
      ...(input.isPartition ? { isPartition: true } : {}),
      ...(input.udpValues && Object.keys(input.udpValues).length ? { udpValues: input.udpValues } : {}),
    };
    pin.check();
    if (shifts.length) await gov.recordChangesBulk([gov.bulk.createColumn(payload), ...shifts]);
    else await gov.createColumn(payload);
    // La columna agregada entra automáticamente a las vistas espejo de la
    // tabla (las que reflejan todas sus columnas) — al final, o tras las PK si
    // es PK. Las vistas curadas (subset deliberado) no se tocan. Best-effort:
    // un fallo aquí no bloquea el alta (queda "Match physical order" para
    // alinear).
    try {
      const touched = await syncNewColumnToMirrorViews(pinnedViewDeps(pin), tableId, physical, siblings, !!input.isPrimaryKey);
      if (touched && pin.holds()) toast.success(`Column also added to ${touched} mirror view(s)`);
    } catch { /* la vista se alinea después con "Match physical order" */ }
    // Si la sesión cambió mientras sincronizaba, lo que sigue no es de esta.
    if (!pin.holds()) return;
    await get().reload();
    // Undo: la inversa es el delete del store — limpia también las
    // vistas espejo y el panel de columna si quedó abierto sobre ella. Lleva
    // la columna creada: el diagrama en pantalla puede no tenerla.
    pushUndo(`Add column ${physical}`, columnsDrop([id], [], [payload]), pin);
  },
  updateRelationship: async (r) => {
    const dia = editableDiagram(); if (!dia) return;   // el canvas de esta sesión
    const pin = pinSession();
    get().markDirty();
    const pre0 = dia.relationships.find((x) => x.id === r.id);
    const pre = pre0 ? { ...pre0, pairs: pre0.pairs.map((p) => ({ ...p })) } : null;
    await gov.updateRelationship(r);
    const post = { ...r, pairs: r.pairs.map((p) => ({ ...p })) };
    const put = (doc: gov.Relationship, back: gov.Relationship): HistoryStep => async () => {
      await gov.updateRelationship(doc);
      await get().reload();
      return put(back, doc);
    };
    if (pre) pushUndo('Edit relationship', put(pre, post), pin);
    await get().reload();
  },
  deleteRelationship: async (id) => {
    const dia = editableDiagram(); if (!dia) return;   // el canvas de esta sesión
    const pin = pinSession();
    get().markDirty();
    const rel = dia.relationships.find((r) => r.id === id);
    // Pre-imágenes para el Undo: la relación por valor + las FKs que
    // la limpieza de abajo apaga.
    const relPre = rel ? { ...rel, pairs: rel.pairs.map((p) => ({ ...p })) } : null;
    const fkClearedPre: CanonicalColumn[] = [];
    await gov.deleteRelationship(id);
    // Limpieza del flag FK (inverso de markForeignKey en create): si una columna
    // hija de algún par de la relación borrada deja de ser hija en toda otra
    // relación del pool (global, no solo las visibles en este canvas), se le
    // quita isForeignKey. Conservador a propósito; isPrimaryKey nunca se toca.
    if (rel) {
      for (const colId of rel.pairs.map((p) => p.childColumnId)) {
        const col = dia.columns.find((c) => c.id === colId);
        if (!col?.isForeignKey) continue;
        // Slice server-side: solo las relaciones que tocan la tabla de la
        // columna (una relación siempre referencia la tabla de sus columnas).
        const near = (await gov.listRelationships(col.tableId)).filter((r) => r.id !== id);
        const stillLinked = near.some((r) => r.pairs.some((p) => p.childColumnId === colId));
        if (!stillLinked) {
          fkClearedPre.push({ ...col });
          pin.check();
          await gov.updateColumn({ ...col, isForeignKey: false });
        }
      }
    }
    if (relPre) pushUndo('Delete relationship', relRestore(relPre, fkClearedPre), pin);
    await get().reload();
  },
  addExistingTables: async (tableIds: string[], opts) => {
    const saId = get().activeSaId; if (!saId || tableIds.length === 0) return;
    const dia = editableDiagram(); if (!dia) return;   // el canvas de esta sesión
    const pin = pinSession();
    get().markDirty();
    // La membresía de vistas parte de la lista materializada del diagrama (un
    // canvas sin lista explícita la recibe resuelta por el backend). Importar
    // una tabla no arrastra sus vistas — solo si el usuario lo pide.
    const shown = dia.subjectArea.viewIds;
    // Si las vistas no se pueden leer, las tablas entran igual (es lo
    // principal) pero se avisa que entraron sin sus vistas.
    let viewsUnread = false;
    const withViews = opts?.withViews
      ? (await viewsSvc.listViewsForTables(tableIds).catch(() => { viewsUnread = true; return [] as View[]; })).map((v) => v.id)
      : [];
    // Las importadas nacen en el centro de lo que se ve (sin posición, el
    // canvas las ubicaría por número de orden, lejísimos en un modelo grande);
    // varias a la vez, en cascada de 36 px. La que ya estaba en el canvas no se
    // mueve (el servicio solo suma lo que entra y su posición solo cuenta para
    // lo que entra).
    const view = canvasView(get().flow, { panel: 'opens' });
    const known = new Map((opts?.tables ?? []).map((t) => [t.id, t]));
    const inCanvas = new Set(dia.subjectArea.tableIds ?? []);
    const layout: Record<string, Point> = {};
    const held: StackBox[] = [];
    if (view) {
      const others = nodeBoxes(get().flow);
      const recent = recentBoxes(get().flow, saId);
      for (const tid of tableIds.filter((id) => !inCanvas.has(id))) {
        const t = known.get(tid);
        const size = tableLodSize({ physicalName: t?.physicalName ?? '', logicalName: t?.logicalName ?? '', schema: t?.schema } as CanonicalTable, [], get().viewMode);
        const centered = blockSpot(view, { w: size.w, h: size.h });
        const spot = avoidStacking(centered, size, others, recent, view.rect) ?? cascade(centered, size, others, recent);
        layout[tid] = spot;
        recent.push({ ...spot, w: size.w });   // la siguiente del lote la esquiva
        held.push({ ...spot, w: size.w });
      }
    }
    // La lista completa la arma el servicio dentro de la cola del canvas y
    // devuelve lo realmente agregado: la inversa del Undo no debe sacar del
    // canvas una tabla o vista que ya vivía en él.
    const release = holdSpots(saId, held);
    let added: Required<struct.CanvasMembers>;
    try {
      pin.check();
      added = await struct.addToCanvas(saId, {
        tableIds, viewIds: withViews,
        ...(Object.keys(layout).length ? { layout, ...pinsFor(saId, tableIds.filter((tid) => !inCanvas.has(tid))) } : {}),
      }, shown);
      await get().reload();
    } finally { release(); }
    if (!pin.holds()) return;   // lo que sigue es de la sesión de la acción
    // Selecciona la primera importada → al frente (zIndex) y visible.
    set({ selectedTableId: tableIds[0], selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });
    // Lo que entró queda encima de lo demás (lo que ya estaba, no).
    get().markFresh({ [saId]: [...added.tableIds, ...added.viewIds] });
    if (viewsUnread) {
      toast.warning(tableIds.length === 1
        ? "The table was imported, but its views couldn't be loaded: add them from its Views tab (Properties)."
        : "The tables were imported, but their views couldn't be loaded: add them from each table's Views tab (Properties).");
    }
    if (added.tableIds.length || added.viewIds.length) {
      const nt = added.tableIds.length;
      const nv = added.viewIds.length;
      const what = [
        nt ? `${nt} table${nt === 1 ? '' : 's'}` : '',
        nv ? `${nv} view${nv === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' + ');
      // La lista de vistas es la de este canvas al importar: el Undo puede
      // correr con otro canvas abierto (la pila sobrevive al cambio de canvas).
      pushUndo(`Add ${what} to canvas`, membersOut(saId, added, shown), pin);
    }
  },
  addViewsToCanvas: async (viewIds) => {
    const saId = get().activeSaId; if (!saId || viewIds.length === 0) return;
    const dia = editableDiagram(); if (!dia) return;   // el canvas de esta sesión
    const shown = dia.subjectArea.viewIds ?? [];
    if (viewIds.every((v) => shown.includes(v))) return;          // ya eran miembros
    const pin = pinSession();
    get().markDirty();
    // La lista completa la arma el servicio dentro de la cola.
    const added = await struct.addToCanvas(saId, { viewIds }, shown);
    await get().reload();
    const n = added.viewIds.length;
    if (!n) return;
    pushUndo(`Add ${n} view${n === 1 ? '' : 's'} to canvas`, membersOut(saId, { viewIds: added.viewIds }, shown), pin);
  },
  removeViewFromCanvas: async (viewId) => {
    const saId = get().activeSaId; if (!saId) return;
    const dia = editableDiagram(); if (!dia) return;   // el canvas de esta sesión
    const shown = dia.subjectArea.viewIds ?? [];
    if (!shown.includes(viewId)) return;
    const pin = pinSession();
    get().markDirty();
    // Para el Undo: nombre y posición antes de quitarla.
    const name = dia.views.find((v) => v.id === viewId)?.name ?? 'view';
    const node = get().flow?.getNode(viewId);
    const pos = node ? { x: Math.round(node.position.x), y: Math.round(node.position.y) } : null;
    const out = await struct.removeFromCanvas(saId, { viewIds: [viewId] }, shown);
    if (get().selectedViewId === viewId) set({ selectedViewId: null });
    await get().reload();
    // Vuelve con su posición — la de pantalla; sin nodo, la grabada — en una
    // sola escritura (lista de vistas de este canvas, no la del que esté abierto
    // al deshacer), y con su color en este canvas (salió con ella).
    pushUndo(`Remove ${name} from canvas`, membersIn(saId, {
      ...out, tableIds: [], viewIds: [viewId], layout: { ...out.layout, ...(pos ? { [viewId]: pos } : {}) }, routes: {},
    }, shown), pin);
  },
  deleteView: async (view, opts) => {
    const pin = pinSession();
    const askedCs = useSessionStore.getState().activeChangesetId;
    const saId = get().activeSaId;
    const onActive = !!saId && !!liveDiagram()?.views.some((v) => v.id === view.id);
    // Dónde está antes de borrarla: el backend la saca de cada canvas que la
    // lista, con su posición, en el mismo request. Si no se puede leer, no se
    // borra (el Undo quedaría incompleto).
    let placed: Map<string, ListedViews>;
    // Documento para el Undo: el del llamador (panel de la tabla, inspector) o,
    // sin lista de canvases (panel de la vista, que parte del diagrama: ahí la
    // vista no trae su `sql`), la fila de su tabla que se lee para ubicarla; si
    // esa lista no la trae (diagrama desactualizado, vista re-apuntada), el
    // documento vigente.
    let doc: View = view;
    try {
      const src = view.sourceTableIds?.[0] ?? view.tableId;
      let canvasIds = opts?.canvasIds;
      if (!canvasIds) {
        const row = src ? (await viewsSvc.tableViews(src)).views.find((v) => v.id === view.id) : undefined;
        doc = row ?? (await viewsSvc.currentView(view.id)) ?? view;
        canvasIds = (row?.canvases ?? []).map((c) => c.id);
      }
      placed = await listedViewsBy([...canvasIds, ...(onActive && saId ? [saId] : [])], [view.id]);
    } catch (e) {
      throw await readFailure(e, askedCs, pin, viewUsageUnreadable);   // ídem deleteTable
    }
    // Pre-imagen por valor: el documento completo, sin `canvases` (la fila
    // del panel o del inspector no es parte del documento).
    const pre = JSON.parse(JSON.stringify(doc)) as View & { canvases?: unknown };
    delete pre.canvases;
    pin.check();
    get().markDirty();
    await viewsSvc.deleteView(view.id);
    if (get().selectedViewId === view.id) set({ selectedViewId: null });
    // Su contrario la vuelve a borrar, fresca (relee dónde está).
    const restore: HistoryStep = async (undo) => {
      await viewsSvc.updateView(pre.id, pre as ViewInput);
      // Cada canvas la vuelve a listar dentro de su cola, en una sola escritura
      // con su posición. Un canvas sin lista explícita no se toca: su regla por
      // fuentes la vuelve a mostrar (y conserva su sitio). Solo mientras siga
      // la sesión del Undo.
      for (const [canvasId, listed] of placed) {
        undo.check();
        try {
          await struct.addToCanvas(canvasId, {
            viewIds: listed.viewIds, ...(Object.keys(listed.layout).length ? { layout: listed.layout } : {}),
            colors: listed.colors,   // la cascada se llevó también su color en el canvas
          });
        } catch { /* el canvas pudo desaparecer */ }
      }
      await get().reload();
      // Si no volvió al canvas activo, el Explorer se refresca a mano.
      get().syncExplorer(!!get().diagram?.views.some((v) => v.id === pre.id));
      return viewDrop(pre);
    };
    if (opts?.onUndo) opts.onUndo(restore);
    else pushUndo(`Delete view ${pre.name}`, restore, pin);
  },
  createTableFromSources: ({ logicalName, schema, columns }) => runBlocking('Creating table…', async () => {
    const saId = get().activeSaId; if (!saId) throw new Error('Pick a Subject Area');
    const pin = pinSession();
    get().markDirty();
    const id = crypto.randomUUID();
    const physical = (await gov.physicalize(logicalName, 'table')).physical;
    // Tabla + columnas en un solo lote: un request por columna serían N
    // requests secuenciales (cientos de columnas de tablas fuente). El backend
    // valida el lote completo antes de escribir: una columna inválida/duplicada
    // no deja la tabla a medias. Cada columna hereda su metadata individual del
    // origen: definición, PK/FK/nullable/partition, UDPs, dominio y tipo. Lo
    // que no se arrastra: relaciones (isForeignKey queda como marca individual,
    // sin relationship en la tabla creada) ni vistas. Ordinal secuencial en el
    // orden elegido con las PK primero (sort estable). Claves opcionales solo
    // si aportan (payload limpio, mismo patrón que addColumn).
    let ordinal = 0;
    const pkFirst = [...columns.filter((c) => c.isPrimaryKey), ...columns.filter((c) => !c.isPrimaryKey)];
    pin.check();
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
        // Procedencia: "Created from source <tabla>.<col> (CTAS)".
        }, { kind: 'ctas', ...(c.sourceTable ? { sourceTable: c.sourceTable } : {}), sourceColumn: c.physicalName });
      }),
    ]);
    // En el centro de lo que se ve, con el tamaño de sus columnas.
    const spot = newTableSpot(get().flow, saId, { physicalName: physical, logicalName, schema: schema?.trim() || undefined }, columns, get().viewMode);
    const release = holdSpots(saId, spot ? [spot] : []);
    try {
      pin.check();
      await struct.addToCanvas(saId, { tableIds: [id], ...(spot ? { layout: { [id]: { x: spot.x, y: spot.y } }, ...pinsFor(saId, [id]) } : {}) });
      await get().reload();
    } finally { release(); }
    if (!pin.holds()) return;   // no selecciona en otra sesión
    set({ selectedTableId: id, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });   // al frente + visible
    get().markFresh({ [saId]: [id] });   // encima aunque se deseleccione
    pushUndo(`Create table ${physical}`, tableDrop(id), pin);
  }),
  setColumnTarget: (id: string | null) => set({ columnTarget: id }),
  // Seleccionar tabla o edge cambia de contexto: cierra el panel de columna.
  setSelectedTable: (id) => set({ selectedTableId: id, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null }),
  selectTable: (id) => {
    const changed = id !== get().selectedTableId;
    get().setSelectedTable(id);
    if (!id) { _unframed = null; return; }
    // Con la herramienta de relación o subcategoría armada, el canvas no se
    // mueve (rompería el trazo clic en el padre → clic en el hijo). Desarmada,
    // otro clic en esa tabla la encuadra.
    if (get().relPreset || get().subcatArmed) { if (changed) _unframed = id; return; }
    if (changed || _unframed === id) { _unframed = null; get().frameTable(id, { afterClick: true }); }
  },
  setSelectedEdge: (id) => set({ selectedEdgeId: id, selectedTableId: null, selectedColumnId: null, selectedViewId: null }),
  removeTableFromArea: async (tableId) => {
    get().markDirty();
    const saId = get().activeSaId; if (!saId) return;
    const d = editableDiagram(); if (!d) return;   // el canvas de esta sesión
    const pin = pinSession();
    // Para el Undo: nombre y posición antes de quitarla (el remove
    // también borra su entrada del layout).
    const name = d?.tables.find((t) => t.id === tableId)?.physicalName ?? 'table';
    const flow = get().flow;
    const posOf = (id: string) => {
      const n = flow?.getNode(id);
      return n ? { x: Math.round(n.position.x), y: Math.round(n.position.y) } : null;
    };
    const pos = posOf(tableId);
    // Las vistas que quedan sin fuente en el canvas salen con la tabla
    // (siguen en el modelo). La membresía parte de la lista materializada.
    const remaining = (d?.subjectArea.tableIds ?? []).filter((t) => t !== tableId);
    const orphans = orphanViewIds(d?.views ?? [], remaining);
    const orphanPos = Object.fromEntries(orphans.map((vid) => [vid, posOf(vid)] as const).filter(([, p]) => p));
    // Los trazos manuales de los wires de la tabla salen con ella (si vuelve
    // al canvas en otra posición dejarían de calzar); el Undo los repone.
    const wireIds = wireIdsOfTable(d?.relationships ?? [], tableId);
    const droppedRoutes = routesOf(get().canvasRoutes, wireIds);
    // quita de tableIds + layout (+ vistas huérfanas) (+ trazos de sus wires).
    // Las listas las arma el servicio dentro de la cola del canvas.
    const shown = d?.subjectArea.viewIds;
    const out = await struct.removeFromCanvas(saId, {
      tableIds: [tableId], viewIds: orphans, ...(Object.keys(droppedRoutes).length ? { dropRouteIds: wireIds } : {}),
      ...pinsOut(saId, [tableId]),
    }, shown);
    // La inversa es una sola escritura (tablas, vistas, posiciones y trazos
    // juntos, sin que cada parte lea el canvas por su cuenta). Las vistas son
    // las de este canvas al sacar la tabla (el Undo puede correr con otro
    // canvas abierto) y solo cuentan si salieron huérfanas: sin ellas, un canvas
    // sin lista explícita sigue sin lista. Su color en este canvas (y el de sus
    // vistas huérfanas) vuelve con ella, y sus trazos. Las posiciones, las de
    // pantalla; si no hay nodo (en lógico las vistas no lo son), las del canvas
    // grabado que devolvió el servicio. Rehacer y volver a deshacer usan lo que
    // el servicio dice que salió (posición, color, vistas y trazos).
    pushUndo(`Remove ${name} from canvas`, tableIn(saId, tableId, {
      ...out, viewIds: orphans, routes: droppedRoutes,
      layout: { ...out.layout, ...(pos ? { [tableId]: pos } : {}), ...orphanPos } as Record<string, { x: number; y: number }>,
    }, wireIds, shown), pin);
    if (get().selectedTableId === tableId) set({ selectedTableId: null, selectedColumnId: null, selectedViewId: null });
    await get().reload();
  },
  deleteTable: (tableId, opts) => runBlocking('Deleting table…', async () => {
    // Cascada completa en el changeset (versionada), grabada en lote: cambio por
    // cambio serían ~1 request por columna — con miles de columnas el borrado
    // tomaría minutos. Las lecturas van primero (estado pre-borrado: ninguna
    // afecta a las otras), luego un solo bulk con vistas + relaciones +
    // columnas, y la tabla al final fuera del lote: si algo se interrumpe, la
    // tabla sigue viva y repetir el delete converge. Un solo reload al terminar.
    // Todas las lecturas tienen que llegar: si una cayera a `[]`, la tabla se
    // borraría igual y dejaría vistas y relaciones huérfanas en el draft. Si
    // alguna falla, no se borra nada. Todo es de la sesión donde empezó el
    // borrado — también como inversa de «Create table» o «Paste table»; cada
    // escritura lo verifica.
    const pin = pinSession();
    const askedCs = useSessionStore.getState().activeChangesetId;
    const noun = facetNouns(get().viewMode).one;
    let views: View[], rels: gov.Relationship[], cols: CanonicalColumn[], usage: gov.TableUsageRow[];
    let viewCanvasIds: string[];
    let viewsBack: Map<string, ListedViews>;
    let others: Map<string, Diagram>;
    let tableDoc: CanonicalTable | null = null;
    const fkClearedPre: CanonicalColumn[] = [];
    try {
      // vistas que la usan (cualquier fuente: tableId o sourceTableIds)
      const viewsRead = viewsSvc.listViews(tableId);
      // El documento de la tabla, para el Undo, si no está en el canvas abierto
      // ni lo trae el llamador (p. ej. deshacer «Create table» con otro canvas
      // abierto).
      const docRead = opts?.pre || liveDiagram()?.tables.some((x) => x.id === tableId)
        ? Promise.resolve(null) : gov.currentTable(tableId);
      [views, rels, cols, usage, viewCanvasIds, tableDoc] = await Promise.all([
        viewsRead,
        // relaciones donde es extremo (globales)
        gov.listRelationships(tableId),
        gov.listColumns(tableId),
        // canvases que la contienen
        gov.tableUsage(tableId).then((u) => u.usage),
        // y los de sus vistas (una multi-fuente puede estar en un canvas sin
        // esta tabla).
        viewsRead.then((vs) => (vs.length ? canvasesOfViews(tableId, vs.map((v) => v.id)) : [])),
        docRead,
      ]);
      // El lote de abajo saca cada vista borrada de todo canvas que la lista
      // (cascada del backend): antes se anota qué lista cada canvas y dónde,
      // para que el Undo las reponga; y el diagrama de los otros canvases de la
      // tabla.
      [viewsBack, others] = await Promise.all([
        listedViewsBy([...usage.map((u) => u.canvasId), ...viewCanvasIds], views.map((v) => v.id)),
        diagramsBefore(usage.map((u) => u.canvasId)),
      ]);
      // FK huérfano en columnas hija de la otra tabla (misma regla conservadora
      // que deleteRelationship: si ya no participan en ninguna relación). Se
      // decide antes del lote, descontando las relaciones que este borrado se
      // lleva; una lectura fallida aborta el borrado en lugar de apagar el FK
      // de una hija que sigue en otra relación.
      const gone = new Set(rels.map((r) => r.id));
      const children = new Map<string, Set<string>>();   // childTableId → childColumnIds
      for (const r of rels) {
        if (r.parentTableId !== tableId || r.childTableId === tableId) continue;
        const set = children.get(r.childTableId) ?? new Set<string>();
        r.pairs.forEach((p) => set.add(p.childColumnId));
        children.set(r.childTableId, set);
      }
      const childReads = await Promise.all([...children].map(async ([ctid, colIds]) => {
        const [near, ccols] = await Promise.all([gov.listRelationships(ctid), gov.listColumns(ctid)]);
        return { colIds, near, ccols };
      }));
      for (const { colIds, near, ccols } of childReads) {
        for (const colId of colIds) {
          if (near.some((r) => !gone.has(r.id) && r.pairs.some((p) => p.childColumnId === colId))) continue;
          const c = ccols.find((x) => x.id === colId);
          if (c?.isForeignKey) fkClearedPre.push({ ...c });
        }
      }
    } catch (e) {
      throw await readFailure(e, askedCs, pin, () => dependentsUnreadable(`this ${noun}`));
    }
    pin.check();
    get().markDirty();
    // Pre-imágenes para el Undo: las lecturas de arriba ya traen el estado
    // pre-borrado — se congelan por valor antes de tocar nada. Sin canvas
    // (inspector) la pre-imagen viene del dossier efectivo.
    const t0 = liveDiagram()?.tables.find((x) => x.id === tableId) ?? opts?.pre ?? tableDoc;
    const tPre = t0 ? { ...t0, ...(t0.udpValues ? { udpValues: { ...t0.udpValues } } : {}) } : null;
    const undoSaId = get().activeSaId;
    const undoNode = get().flow?.getNode(tableId);
    const undoPos = undoNode ? { x: Math.round(undoNode.position.x), y: Math.round(undoNode.position.y) } : null;
    const colsPre = cols.map((c) => ({ ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) }));
    const relsPre = rels.map((r) => ({ ...r, pairs: r.pairs.map((p) => ({ ...p })) }));
    const viewsPre = views.map((v) => JSON.parse(JSON.stringify(v)) as View);
    // Dónde se veía en cada canvas que no estaba abierto.
    const seenPre = new Map([...others].map(([id, dia]) => [id, seenAt(dia, tableId)] as const));
    await gov.recordChangesBulk([
      ...views.map((v) => gov.bulk.deleteView(v.id)),
      ...rels.map((r) => gov.bulk.deleteRelationship(r.id)),
      ...cols.map((c) => gov.bulk.deleteColumn(c.id)),
    ]);
    // FK huérfano en columnas hija sobrevivientes (decidido arriba, antes del lote).
    for (const c of fkClearedPre) {
      pin.check();
      await gov.updateColumn({ ...c, isForeignKey: false });
    }
    // Sacar de todos los canvases que la contienen (tableIds + layout), y con
    // ella los trazos manuales de sus wires (las relaciones de arriba se
    // borran; sus trazos quedarían huérfanos en cada canvas) y sus vistas, si
    // el backend no las sacó ya; cada canvas dice qué salió.
    const wireIds = wireIdsOfTable(rels, tableId);
    const viewIdsOut = views.map((v) => v.id);
    const removed = new Map<string, struct.CanvasMembersOut>();
    // Los canvases de la tabla y, además, los que solo listaban alguna de sus
    // vistas (multi-fuente): de esos salen solo las vistas.
    const tableCanvases = new Set(usage.map((u) => u.canvasId));
    const canvasIds = [...tableCanvases, ...[...viewsBack.keys()].filter((id) => !tableCanvases.has(id))];
    for (const canvasId of canvasIds) {
      pin.check();
      const withTable = tableCanvases.has(canvasId);
      removed.set(canvasId, await struct.removeFromCanvas(canvasId, {
        ...(withTable ? { tableIds: [tableId] } : {}),
        ...(viewIdsOut.length ? { viewIds: viewIdsOut } : {}),
        ...(withTable && wireIds.length ? { dropRouteIds: wireIds } : {}),
        ...(withTable ? pinsOut(canvasId, [tableId], others.get(canvasId)) : {}),   // en todos sus canvases
      }));
    }
    // La tabla.
    pin.check();
    await gov.deleteTable(tableId);
    // Undo: un solo lote restaura tabla + columnas + FKs limpiadas +
    // relaciones + vistas (el guard N=N resuelve la llave con las columnas del
    // mismo lote), y después las membresías de canvas. Su contrario la vuelve
    // a borrar, fresca.
    if (tPre) {
      const restore: HistoryStep = async (undo) => {
        await gov.recordChangesBulk([
          gov.bulk.createTable(tPre),
          ...colsPre.map((c) => gov.bulk.createColumn(c)),
          ...fkClearedPre.map((c) => gov.bulk.createColumn(c)),
          ...relsPre.map((r) => gov.bulk.upsertRelationship(r)),
          ...viewsPre.map((v) => gov.bulk.upsertView(v)),
        ]);
        // Una escritura por canvas, dentro de su cola. La tabla vuelve a su
        // posición en cada canvas (en el activo, a la de pantalla), con los
        // trazos que ese canvas quitó, y las vistas que ese canvas listaba, a
        // la suya; un canvas sin lista explícita sigue sin lista. Mientras
        // siga la sesión del Undo — si se abrió otra versión, lo que falta no
        // va a ella. Un canvas que solo listaba sus vistas recupera esas, no la
        // tabla (nunca la tuvo).
        for (const canvasId of canvasIds) {
          undo.check();
          const withTable = tableCanvases.has(canvasId);
          const active = withTable && canvasId === undoSaId;
          const out = removed.get(canvasId);
          const back = viewsBack.get(canvasId);
          const viewIds = [...new Set([...(back?.viewIds ?? []), ...(out?.viewIds ?? [])])];
          const seen = withTable && !active ? seenPre.get(canvasId) : null;
          const layout = {
            ...(out?.layout ?? {}), ...(back?.layout ?? {}),
            ...(active && undoPos ? { [tableId]: undoPos } : {}),
            ...(seen ? { [tableId]: seen } : {}),
          };
          // El color de cada caja en ese canvas vuelve con ella.
          const colors = { ...(out?.colors ?? {}), ...(back?.colors ?? {}) };
          try {
            await struct.addToCanvas(canvasId, {
              ...(withTable ? { tableIds: [tableId] } : {}),
              ...(viewIds.length ? { viewIds } : {}),
              ...(Object.keys(layout).length ? { layout } : {}),
              ...(out && Object.keys(out.routes).length ? { routes: out.routes } : {}),
              colors,
            });
          } catch { /* el canvas pudo desaparecer */ }
        }
        await get().reload();
        get().syncExplorer(canvasIds.includes(get().activeSaId ?? ''));
        return tableDrop(tableId, tPre);
      };
      if (opts?.onUndo) opts.onUndo(restore);
      else pushUndo(`Delete table ${tPre.physicalName}`, restore, pin);
    }
    if (get().selectedTableId === tableId) set({ selectedTableId: null, selectedColumnId: null, selectedViewId: null });
    await get().reload();
    // Si la tabla no estaba en el canvas activo (o no hay canvas — borrado
    // desde el Object Inspector), reload() no cambia ninguna firma → el
    // Explorer se refresca a mano. Complementa la regla de `reload()` (firma
    // del diagrama). Un canvas que listaba sus vistas también cambió de firma.
    get().syncExplorer(canvasIds.includes(get().activeSaId ?? ''));
  }),
  updateTable: async (id, fields) => {
    get().markDirty();
    const t = editableDiagram()?.tables.find((x) => x.id === id);
    if (!t) return;
    await gov.createTable({ ...t, ...fields }); // upsert por id = update
    await get().reload();
  },
  updateColumn: async (colId, fields) => {
    const dia = editableDiagram();   // el canvas de esta sesión
    const c = dia?.columns.find((x) => x.id === colId);
    if (!dia || !c) return;
    const pin = pinSession();
    get().markDirty();
    // Entrar o salir de la llave re-ubica la columna en la frontera del bloque
    // de PK — ella y las que se corren viajan en un solo lote, con un solo Undo.
    if (fields.isPrimaryKey !== undefined && !!fields.isPrimaryKey !== !!c.isPrimaryKey) {
      const mine = dia.columns.filter((x) => x.tableId === c.tableId);
      const { changes, pres } = keyLayoutBulk(mine, { [colId]: fields });
      await gov.recordChangesBulk(changes);
      pushUndo(`Edit column ${c.physicalName}`, lotStep(pres.map((p) => gov.bulk.createColumn(p)), changes, () => get().reload()), pin);
      await get().reload();
      return;
    }
    // Pre-imagen por valor para el Undo.
    const pre = { ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) };
    const post = { ...c, ...fields };
    await gov.updateColumn(post); // upsert por id = update (merge)
    // Undo y Redo por valor. Si el cambio renombró el físico, las vistas
    // quedaron re-apuntadas al nombre nuevo (sync del panel): deshacer las
    // devuelve al original y rehacer, otra vez al nuevo.
    pushUndo(`Edit column ${pre.physicalName}`,
      columnStep(pre, { ...post, ...(post.udpValues ? { udpValues: { ...post.udpValues } } : {}) }, () => get().reload()), pin);
    await get().reload();
  },
  reorderColumns: async (tableId, orderedIds) => {
    const dia = editableDiagram(); if (!dia) return;
    const pin = pinSession();   // tandas de escrituras
    const onCanvas = dia.columns.filter((c) => c.tableId === tableId);
    // Si la tabla no está en el canvas en pantalla (un drop que terminó con
    // otro canvas abierto), el orden se arma con sus columnas vigentes del
    // modelo.
    const mine = onCanvas.length ? onCanvas : await gov.listColumns(tableId);
    pin.check();   // si mientras leía cambió la sesión, nada se marca en la otra
    // Una PK nunca queda debajo de una no-PK (guard final: los paneles ya lo
    // impiden al arrastrar).
    if (!isPkFirst(mine, orderedIds)) {
      toast.error("A primary key column can't go below a column that isn't part of the key.");
      return;
    }
    get().markDirty();
    // Optimista: la UI reordena al soltar (posición = índice de destino, local); la
    // persistencia corre detrás y el reload final reconcilia con el overlay.
    if (onCanvas.length) {
      set({
        diagram: {
          ...dia,
          columns: dia.columns.map((c) => {
            const idx = orderedIds.indexOf(c.id);
            return idx >= 0 && c.ordinal !== idx ? { ...c, ordinal: idx } : c;
          }),
        },
      });
    }
    // Se persisten solo las columnas cuya posición cambió, en tandas de 5:
    // mover una columna al tope de una tabla de 30 dispararía 30 PUT simultáneos
    // (ráfaga que con varios usuarios satura el backend). El backend graba cada
    // cambio con $set atómico por entidad, así que no se pisan entre sí.
    const changed = reorderPlan(mine, orderedIds);
    // El upsert es del documento completo — cada columna con su documento
    // vigente (otra edición pudo recargar el diagrama mientras se esperaba),
    // nunca uno capturado antes: pisaría esa edición.
    const reads: ColumnReads = new Map();   // una lectura por tabla y tanda
    await persistReorder(changed, async (c, idx) => {
      const cur = await currentColumn(c, reads);   // borrada mientras tanto → no se revive
      if (!cur) return;
      pin.check();
      await gov.updateColumn({ ...cur, ordinal: idx });
    });
    if (changed.length) {
      // Undo por valor: las pre-imágenes de las columnas movidas vuelven a su
      // ordinal tal cual, sin pasar por la guarda «PK primero» — el estado
      // previo pudo ser un dato cargado desordenado, o la llave pudo cambiar en
      // el medio (drop en el canvas: llave + reorden).
      const pres = sortByOrdinal(changed.map(({ c }) => ({ ...c })));
      // Solo el orden va y vuelve: sobre el documento vigente.
      const order = (plan: { c: CanonicalColumn; idx: number }[], back: typeof plan): HistoryStep => async (stepPin) => {
        const reads: ColumnReads = new Map();
        await persistReorder(plan, async (c, idx) => {
          const cur = await currentColumn(c, reads);
          if (!cur) return;
          stepPin.check();
          await gov.updateColumn({ ...cur, ordinal: idx });
        });
        await get().reload();
        return order(back, plan);
      };
      pushUndo('Reorder columns', order(pres.map((c) => ({ c, idx: c.ordinal })), changed.map(({ c, idx }) => ({ c, idx }))), pin);
    }
    await get().reload();
  },
  applyCanvasDrop: async (tableId, plan) => {
    // Drop de una fila en el bloque: los cambios de llave van por el mismo
    // camino que el panel (gov.updateColumn + Undo por valor) y después el
    // reorden de columnas (reorderColumns).
    const dia = editableDiagram(); if (!dia) return;
    const pin = pinSession();
    if (plan.key.length) {
      get().markDirty();
      const pres: CanonicalColumn[] = [];
      const flags = new Map(plan.key.map((k) => [k.id, k.isPrimaryKey]));
      const reads: ColumnReads = new Map();
      for (const step of plan.key) {
        const captured = dia.columns.find((c) => c.id === step.id);
        if (!captured) continue;
        // El documento vigente — tras la primera escritura, otra edición pudo
        // recargar el diagrama; o nada, si se borró mientras tanto.
        const col = await currentColumn(captured, reads);
        if (!col) continue;
        pres.push({ ...col });
        pin.check();
        await gov.updateColumn({ ...col, isPrimaryKey: step.isPrimaryKey });
      }
      // Si mientras escribía se abrió otra versión, el set de abajo
      // reinstalaría en pantalla el diagrama de esta (y el refresco ya reabrió
      // el de la otra): la acción termina aquí.
      if (!pin.holds()) return;
      // Optimista: la llave modificada ya en el diagrama local, así el reorden
      // de abajo valida «PK primero» contra ella. Sobre el diagrama vigente —
      // el capturado al empezar reinstalaría lo previo a otra edición que
      // recargó mientras se grababa, o el canvas A bajo el B que se abrió (y un
      // arrastre grabaría sus bloques en B). Si el abierto es otro, solo cambia
      // si también tiene esta tabla.
      const cur = get().diagram;
      if (cur) set({ diagram: { ...cur, columns: cur.columns.map((c) => (flags.has(c.id) ? { ...c, isPrimaryKey: flags.get(c.id) } : c)) } });
      if (pres.length) {
        const keys = (write: CanonicalColumn[], back: CanonicalColumn[]): HistoryStep => async (stepPin) => {
          for (const c of write) { stepPin.check(); await gov.updateColumn(c); }
          await get().reload();
          return keys(back, write);
        };
        pushUndo('Edit key', keys(pres, pres.map((c) => ({ ...c, isPrimaryKey: flags.get(c.id) }))), pin);
      }
      if (!plan.order) await get().reload();
    }
    if (plan.order) { pin.check(); await get().reorderColumns(tableId, plan.order); }
  },
  deleteColumn: (colId, relIds = [], opts) => get().deleteColumns([colId], relIds, opts?.col ? { cols: [opts.col] } : undefined),
  deleteColumns: async (colIds, relIds = [], opts) => {
    // De la sesión donde empezó — también como inversa de «Add column».
    const pin = pinSession();
    const askedCs = useSessionStore.getState().activeChangesetId;
    const nouns = facetNouns(get().viewMode);
    const ids = [...new Set(colIds)];
    if (!ids.length) return;
    const gone = new Set(ids);
    const rels = [...new Set(relIds)];
    // Las relaciones elegidas en el diálogo de impacto, las FK que quedan
    // huérfanas, las columnas y las vistas que las listan van en un solo lote:
    // se graban juntas o nada (una vista que no valida deja las columnas como
    // estaban). De una relación con más pares salen los pares de estas
    // columnas; si no le queda ninguno, se borra completa.
    // Por id en un mapa: en un canvas de decenas de miles de columnas, buscar
    // cada una recorriendo el diagrama crece con columnas × diagrama.
    const drawn = new Map((liveDiagram()?.columns ?? []).map((c) => [c.id, c]));
    const known = new Map((opts?.cols ?? []).map((c) => [c.id, c]));
    const cols = ids.flatMap((id) => {
      const c = drawn.get(id) ?? known.get(id);
      return c ? [c] : [];
    });
    const tableId = cols[0]?.tableId;
    if (cols.some((c) => c.tableId !== tableId)) throw new Error(`${nouns.Members} from more than one ${nouns.one} can't be deleted together`);
    // Todas las lecturas antes de la primera escritura — si alguna falla no se
    // escribe nada (leer las relaciones de las hijas después de borrar las
    // elegidas dejaría, ante una caída, relaciones borradas con las columnas
    // vivas y sin Undo). La FK huérfana se decide con lo leído aquí,
    // descontando lo que este borrado le hace a cada relación elegida.
    let pool: gov.Relationship[];
    // Vistas que referencian alguna de las columnas: el documento sin ellas
    // (una columna borrada no queda en ningún SELECT) y, para el Undo, sus
    // fuentes con su posición.
    const viewsNext: View[] = [];
    const viewsRemoved: { id: string; removed: RemovedColumn[] }[] = [];
    const fkClearedPre: CanonicalColumn[] = [];
    /** Pares con que queda cada relación elegida (vacío = se borra entera). */
    const after = new Map<string, gov.RelationshipPair[]>();
    const touches = (p: gov.RelationshipPair) => gone.has(p.parentColumnId) || gone.has(p.childColumnId);
    /** Las del impacto que todavía tocan estas columnas: una que otro borrado ya
     *  recortó o re-apuntó (un impacto viejo) no se toca. Sin la tabla no hay
     *  relaciones leídas: van todas. */
    let fix = rels;
    try {
      let views: View[];
      let tableCols: CanonicalColumn[];
      // Las columnas vigentes de la tabla, del servidor (el diagrama puede ir
      // atrasado), en paralelo con las demás lecturas.
      [pool, views, tableCols] = await Promise.all([
        (rels.length || opts?.exact) && tableId ? gov.listRelationships(tableId) : Promise.resolve([] as gov.Relationship[]),
        tableId ? viewsSvc.listViews(tableId) : Promise.resolve([] as View[]),
        tableId ? gov.listColumns(tableId) : Promise.resolve([] as CanonicalColumn[]),
      ]);
      // Un nombre que conserva otra columna de la tabla (homónima) no sale de
      // las vistas: sus fuentes siguen resolviendo a ella.
      const names = namesLeavingTable(cols.map((c) => c.physicalName), tableCols.filter((c) => !gone.has(c.id)));
      for (const v of views) {
        const out = tableId ? removeColumnsSources(v, tableId, names) : null;
        if (!out) continue;
        viewsNext.push(viewsSvc.viewWriteDoc(v.id, { ...v, sources: out.sources }));
        viewsRemoved.push({ id: v.id, removed: out.removed });
      }
      // Columnas hijas del otro extremo de los pares afectados: al caer el
      // par/relación pueden quedar con un isForeignKey huérfano (misma limpieza
      // conservadora que deleteRelationship — isPrimaryKey nunca se toca). Una
      // hija que también se borra no se toca.
      if (tableId) fix = rels.filter((rid) => pool.find((r) => r.id === rid)?.pairs.some(touches));
      const candidates = new Map<string, string[]>();   // childTableId → childColumnIds
      for (const rid of fix) {
        const rel = pool.find((r) => r.id === rid);
        const remaining = rel?.pairs.filter((p) => !touches(p)) ?? [];
        for (const p of rel?.pairs.filter(touches) ?? []) {
          if (!rel || gone.has(p.childColumnId)) continue;
          const list = candidates.get(rel.childTableId) ?? [];
          if (!list.includes(p.childColumnId)) candidates.set(rel.childTableId, [...list, p.childColumnId]);
        }
        after.set(rid, rel && remaining.length > 0 && remaining.length < rel.pairs.length ? remaining : []);
      }
      // Una lectura por tabla hija, todas a la vez. La hija puede no estar en
      // el diagrama (inspector sin canvas u otra tabla fuera de este canvas) →
      // se resuelve por API, como deleteTable; si es la misma tabla, sus
      // relaciones ya están leídas.
      const onCanvas = new Map((liveDiagram()?.columns ?? []).map((c) => [c.id, c]));
      const cleared = await Promise.all([...candidates].map(async ([ctid, cids]) => {
        const shown = cids.map((cid) => onCanvas.get(cid));
        const [listed, near] = await Promise.all([
          shown.every(Boolean) ? Promise.resolve([] as CanonicalColumn[]) : gov.listColumns(ctid),
          ctid === tableId ? Promise.resolve(pool) : gov.listRelationships(ctid),
        ]);
        return cids.flatMap((cid, i) => {
          const c = shown[i] ?? listed.find((x) => x.id === cid);
          if (!c?.isForeignKey) return [];
          const still = near.some((r) => (after.get(r.id) ?? r.pairs).some((p) => p.childColumnId === cid));
          return still ? [] : [{ ...c }];
        });
      }));
      fkClearedPre.push(...cleared.flat());
    } catch (e) {
      throw await readFailure(e, askedCs, pin, () => dependentsUnreadable(ids.length === 1 ? `this ${nouns.member}` : `these ${nouns.members}`));
    }
    // Rehacer el borrado toca solo las relaciones de su impacto: una que ahora
    // usa estas columnas quedaría colgando. Borrarlas de nuevo muestra el impacto.
    if (opts?.exact && pool.some((r) => !rels.includes(r.id) && r.pairs.some(touches))) {
      const one = cols.length === 1;
      const what = one ? `${nouns.member} ${facetName(cols[0], get().viewMode)}` : `these ${cols.length} ${nouns.members}`;
      throw new Error(`Couldn't redo: ${what} ${one ? 'is' : 'are'} now used by another relationship. `
        + `Delete ${one ? 'it' : 'them'} again to choose what happens to that relationship.`);
    }
    pin.check();
    // Pre-imágenes para el Undo: columnas y relaciones afectadas (por valor).
    const colsPre = cols.map((c) => ({ ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) }));
    const relsPre = pool.filter((r) => fix.includes(r.id))
      .map((r) => ({ ...r, pairs: r.pairs.map((p) => ({ ...p })) }));
    // El guard N=N del backend resuelve la llave del padre con las columnas del
    // mismo lote: una relación que pierde los pares de una PK borrada valida.
    // Va en un solo request: partido en tandas dejaría de ser todo o nada.
    const lot = [
      ...fix.map((rid) => {
        const rel = pool.find((r) => r.id === rid);
        const remaining = after.get(rid) ?? [];
        return rel && remaining.length
          ? gov.bulk.upsertRelationship({ ...rel, pairs: remaining })
          : gov.bulk.deleteRelationship(rid);
      }),
      ...fkClearedPre.map((c) => gov.bulk.updateColumn({ ...c, isForeignKey: false })),
      ...ids.map((id) => gov.bulk.deleteColumn(id)),
      ...viewsNext.map((v) => gov.bulk.upsertView(v)),
    ];
    if (lot.length > BULK_MAX_CHANGES) {
      throw new Error(`This delete needs ${lot.length} changes and the limit is ${BULK_MAX_CHANGES} at a time: nothing was deleted. Delete fewer ${nouns.members} at a time.`);
    }
    get().markDirty();
    await gov.recordChangesBulk(lot, lot.length);
    // Undo: un solo lote repone columnas, FKs limpiadas y relaciones, y vuelve
    // a poner cada columna en sus vistas sobre su documento vigente (lo editado
    // después del borrado no se pisa; una que ya no las tiene como fuente de
    // esta tabla, borrada o re-apuntada, queda como está).
    if (colsPre.length) {
      const undoTable = colsPre[0].tableId;
      const what = colsPre.length === 1 ? colsPre[0].physicalName : `these ${colsPre.length} ${nouns.members}`;
      const label = colsPre.length === 1
        ? `Delete ${nouns.member} ${facetName(colsPre[0], get().viewMode)}` : `Delete ${colsPre.length} ${nouns.members}`;
      const restore: HistoryStep = async (undo) => {
        const undoCs = useSessionStore.getState().activeChangesetId;
        let current: View[] = [];
        try {
          if (viewsRemoved.length) current = await viewsSvc.listViews(undoTable);
        } catch (e) {
          const reason = `Couldn't read the views of ${what}`;
          throw await readFailure(e, undoCs, undo, () => new NothingDoneError(reason, `${reason}: nothing was undone.`));
        }
        const byId = new Map(current.map((v) => [v.id, v]));
        const views = viewsRemoved.flatMap(({ id, removed }) => {
          const cur = byId.get(id);
          const sources = cur && restoreColumnsSources(cur, undoTable, removed);
          return cur && sources ? [gov.bulk.upsertView(viewsSvc.viewWriteDoc(id, { ...cur, sources }))] : [];
        });
        const inverse = [
          ...colsPre.map((c) => gov.bulk.createColumn(c)),
          ...fkClearedPre.map((c) => gov.bulk.createColumn(c)),
          ...relsPre.map((r) => gov.bulk.upsertRelationship(r)),
          ...views,
        ];
        undo.check();
        await gov.recordChangesBulk(inverse, inverse.length);
        await get().reload();
        get().syncExplorer(!!get().diagram?.tables.some((t) => t.id === undoTable));
        // Volver a borrar: exacto si es rehacer este borrado (también cuando este ya
        // era un paso exacto); el borrado que deshace «Add column» sigue sin serlo.
        return columnsDrop(ids, fix, colsPre, !opts?.onUndo || !!opts.exact);
      };
      if (opts?.onUndo) opts.onUndo(restore);
      else pushUndo(label, restore, pin);
    }
    // Si estaba abierto el Properties de una columna borrada, se cierra — el
    // sidebar vuelve al Properties de la tabla. La selección de filas era de
    // columnas que ya no existen.
    const open = get().selectedColumnId;
    if (open && gone.has(open)) set({ selectedColumnId: null, selectedViewId: null });
    if (get().colSel?.ids.some((i) => gone.has(i))) set({ colSel: null });
    // Las vistas son del modelo físico: listan columnas, en cualquier faceta.
    if (viewsNext.length && pin.holds()) toast.success(`${ids.length === 1 ? 'Column' : 'Columns'} also removed from ${viewsNext.length} view(s)`);
    // Si la sesión cambió mientras se grababa, lo que sigue no es de esta.
    if (!pin.holds()) return;
    await get().reload();
    // Tabla fuera del canvas activo (o sin canvas) → tick a mano.
    get().syncExplorer(!!tableId && !!get().diagram?.tables.some((t) => t.id === tableId));
  },
  // La subcategoría es exclusiva del modelo lógico — pasar a físico desarma
  // la herramienta (el botón del toolbar también se deshabilita). Las vistas
  // son exclusivas del físico — entrar a lógico cierra el panel de vista (su
  // bloque desaparece del canvas).
  setViewMode: (m: 'logical' | 'physical') =>
    set(m === 'physical' ? { viewMode: m, subcatArmed: false } : { viewMode: m, selectedViewId: null }),
  createSubjectArea: async (name: string) => {
    const pid = get().activeProjectId;
    if (!pid) throw new Error('Pick a Project first');
    const { isCurrent, pin } = explorerRequest();   // ídem createCanvas
    const sa = await struct.createSubjectArea(pid, name);
    await get()._refreshProject(pid, isCurrent);
    if (!pin.holds()) return;
    await get().selectSubjectArea(sa.id);
  },
}));

// ── Trazos manuales de wires ───────────────────────────────────────────────────────

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

// ── El diagrama, sellado con su sesión ─────────────────────────────────────
// Cada carga sella el diagrama con el pin de la sesión en que se pidió (las
// copias `{ ...diagram }` lo conservan). Al cambiar de sesión el store lo
// limpia en el acto; como defensa, las acciones que escriben leen el diagrama
// por `liveDiagram()`: uno de otra sesión (reinstalado por error, p. ej. un set
// optimista tardío) no sirve para armar escrituras.
const DIAGRAM_PIN: unique symbol = Symbol('diagramSession');
type SealedDiagram = Diagram & { [DIAGRAM_PIN]?: SessionPin };

function sealDiagram(d: Diagram, pin: SessionPin): Diagram {
  (d as SealedDiagram)[DIAGRAM_PIN] = pin;
  return d;
}

/** El diagrama abierto si es de la sesión actual (sin sello — armado a mano,
 *  p. ej. en tests — cuenta como vigente); si no, null. */
function liveDiagram(): Diagram | null {
  const d = useModelerStore.getState().diagram;
  const pin = d ? (d as SealedDiagram)[DIAGRAM_PIN] : undefined;
  return d && (!pin || pin.holds()) ? d : null;
}

/** Los ids con posición en el layout de un canvas — tablas, vistas y
 *  símbolos de subcategoría (los de sus relaciones `subcategory`, como
 *  `isSubcategory`). */
function canvasNodeIds(d: Diagram): Set<string> {
  return new Set([
    ...d.tables.map((t) => t.id), ...d.views.map((v) => v.id),
    ...(d.subjectArea.tableIds ?? []), ...(d.subjectArea.viewIds ?? []),
    ...d.relationships.filter((r) => r.subcategory && r.subtypeSymbolId).map((r) => r.subtypeSymbolId as string),
  ]);
}

/** Las lecturas de columnas de una acción, por tabla. Cada entrada vive
 *  mientras su lectura está en vuelo: las columnas de una tanda (que la piden
 *  juntas) comparten una sola lectura, y la tanda siguiente relee — lo que
 *  cambió entre tandas (p. ej. una columna borrada) se ve. */
type ColumnReads = Map<string, Promise<CanonicalColumn[]>>;

/** El documento vigente de una columna para re-grabarlo (el upsert es del
 *  documento completo): el del diagrama en pantalla — otra edición pudo
 *  recargarlo mientras se esperaba —; si su tabla no está en él (otro canvas),
 *  el que se relee del servidor. null si la columna ya no existe. */
async function currentColumn(c: CanonicalColumn, reads: ColumnReads): Promise<CanonicalColumn | null> {
  // Con su tabla en el canvas en pantalla, vale lo que hay ahí — y si ya no
  // está, se borró mientras se esperaba: null (no se escribe; el upsert la
  // re-crearía). Con la tabla fuera, se relee del servidor una vez por tabla y
  // tanda (no la tabla completa por cada columna).
  const d = liveDiagram();
  if (d && d.tables.some((t) => t.id === c.tableId)) return d.columns.find((x) => x.id === c.id) ?? null;
  let read = reads.get(c.tableId);
  if (!read) {
    const own = gov.listColumns(c.tableId);
    reads.set(c.tableId, own);
    const done = () => { if (reads.get(c.tableId) === own) reads.delete(c.tableId); };
    own.then(done, done);
    read = own;
  }
  return (await read).find((x) => x.id === c.id) ?? null;
}

/** La recarga pedida mientras se abría el mismo canvas. `reload()` avisa al
 *  Explorer si el cambio es estructural respecto de lo que abrió la apertura;
 *  si la apertura ya trajo el cambio, se compara con lo que había cuando se
 *  pidió (`prev`) — un solo aviso. */
async function reloadAfterOpening(prev: Diagram | null, quiet = false): Promise<void> {
  const st = useModelerStore.getState;
  const opened = st().diagram;
  _quietReloadFailure = quiet;   // la consume esta `reload()` al empezar
  await st().reload();
  const now = st().diagram;
  if (prev && opened && now && prev.subjectArea.id === now.subjectArea.id
      && diagramSignature(opened) === diagramSignature(now) && diagramSignature(prev) !== diagramSignature(now)) {
    st().bumpExplorer();
  }
}

/** El diagrama en pantalla es de una sesión que ya no está abierta (no
 *  debería pasar: lo reinstaló un set tardío). */
class StaleCanvasError extends Error {
  constructor() {
    super('This canvas is from a version that is no longer open — open it again from the explorer.');
    this.name = 'StaleCanvasError';
  }
}

/** El diagrama en pantalla para editarlo: `null` si no hay (nada que editar:
 *  se calla); si es de otra sesión, `StaleCanvasError` — se avisa en vez de
 *  callar, y Save no pasa por un guardado exitoso. */
function editableDiagram(): Diagram | null {
  const d = useModelerStore.getState().diagram;
  if (d && !liveDiagram()) throw new StaleCanvasError();
  return d;
}

/** Un diagrama pedido antes de que terminara un guardado del canvas puede
 *  traer la posición o el trazo previos: se reponen los grabados. Las
 *  posiciones se mezclan (lo grabado encima); los trazos se reemplazan — un
 *  trazo recién quitado no tiene que volver. */
function withWrittenCanvas(diagram: Diagram, asked: number): Diagram {
  const session = useSessionStore.getState();
  const cs = session.openMode === 'editing' ? session.activeChangesetId : null;
  const fresh = writtenSince(cs, diagram.subjectArea.id, asked);
  if (!fresh) return diagram;
  const sa = diagram.subjectArea;
  return { ...diagram, subjectArea: { ...sa, layout: { ...(sa.layout ?? {}), ...fresh.layout }, routes: fresh.routes,
                                      colors: fresh.colors } };
}

/** Cambia los colores en pantalla del canvas `saId` (no hace nada si hay otro
 *  abierto, u otra versión) y deja el canvas del diagrama al día en sitio,
 *  como `showRoutes`. `patch`: null quita la excepción. */
function showColors(saId: string, patch: Record<string, string | null>, cs: string | null): void {
  useModelerStore.setState((st) => {
    if (st.activeSaId !== saId || editingCsNow() !== cs) return {};
    const colors = { ...st.canvasColors };
    for (const [id, ref] of Object.entries(patch)) {
      if (ref === null) delete colors[id]; else colors[id] = ref;
    }
    if (st.diagram?.subjectArea.id === saId) st.diagram.subjectArea.colors = colors;
    return { canvasColors: colors };
  });
}

/** Guardado en vuelo del color de una caja (como `RouteTicket`):
 *  `ref` = lo pedido (null = sin excepción); `base` = lo último grabado, a lo
 *  que vuelve la pantalla si falla (`undefined` = no se sabe: su canvas no
 *  estaba abierto al pedirlo). */
interface ColorTicket { ref: string | null; base: string | null | undefined }

/** Colores en vuelo, por versión + canvas y por caja: un diagrama que llega
 *  mientras tanto puede traer todavía el color previo — manda el que está en
 *  vuelo (solo en su versión: otra que abre el mismo canvas no lo hereda). Cada
 *  entrada es la ficha del último guardado pedido para esa caja. */
const _pendingColors = new Map<string, Map<string, ColorTicket>>();
const editingCsNow = (): string | null => {
  const s = useSessionStore.getState();
  return s.openMode === 'editing' ? s.activeChangesetId : null;
};
const colorKey = (cs: string | null, saId: string) => `${cs ?? ''}\n${saId}`;

/** Colores a pintar para un diagrama recién llegado: los del canvas, saneados,
 *  con los guardados en vuelo encima (y cada uno se entera de lo grabado). */
function seedColors(diagram: Diagram | null): Record<string, string> {
  if (!diagram) return {};
  const base = cleanColors(diagram.subjectArea.colors);
  const pending = _pendingColors.get(colorKey(editingCsNow(), diagram.subjectArea.id));
  if (!pending?.size) return base;
  const out = { ...base };
  for (const [id, ticket] of pending) {
    ticket.base = base[id] ?? null;
    if (ticket.ref === null) delete out[id]; else out[id] = ticket.ref;
  }
  return out;
}

/** Pinta y graba colores del canvas. Si el guardado falla, las cajas vuelven
 *  a lo último grabado (un pedido más reciente de la misma caja gana) y se
 *  re-lanza. Con otro canvas abierto graba igual, sin tocar la pantalla. */
async function writeCanvasColors(saId: string, patch: Record<string, string | null>): Promise<void> {
  const st = useModelerStore.getState();
  const cs = editingCsNow();
  const key = colorKey(cs, saId);
  const pending = _pendingColors.get(key) ?? new Map<string, ColorTicket>();
  _pendingColors.set(key, pending);
  const tickets = new Map<string, ColorTicket>();
  for (const [id, ref] of Object.entries(patch)) {
    const earlier = pending.get(id);
    const ticket: ColorTicket = {
      ref, base: earlier ? earlier.base : st.activeSaId === saId ? st.canvasColors[id] ?? null : undefined,
    };
    pending.set(id, ticket);
    tickets.set(id, ticket);
  }
  const latest = (id: string) => pending.get(id) === tickets.get(id);
  try {
    showColors(saId, patch, cs);
    await struct.setCanvasColors(saId, patch);
    for (const [id, ticket] of tickets) {
      const next = pending.get(id);
      if (next && next !== ticket) next.base = ticket.ref;   // grabado: base de lo que siga en vuelo
    }
  } catch (e) {
    const revert: Record<string, string | null> = {};
    for (const [id, ticket] of tickets) if (latest(id) && ticket.base !== undefined) revert[id] = ticket.base;
    if (Object.keys(revert).length) showColors(saId, revert, cs);
    throw e;
  } finally {
    for (const id of tickets.keys()) if (latest(id)) pending.delete(id);
    if (!pending.size && _pendingColors.get(key) === pending) _pendingColors.delete(key);
  }
}

/** Escrituras del documento de una tabla o vista, en fila. Cada una arma su
 *  payload al ejecutarse desde el documento vigente de la working copy
 *  (`gov.currentTable`/`viewsSvc.currentView`), no del diagrama: el guardado
 *  de la definición al salir del campo y el color elegido enseguida no se
 *  pisan, aunque una recarga falle o quede reemplazada. */
const _objectWrites = new Map<string, Promise<unknown>>();
/** Paso del historial de una escritura de una tabla o vista: graba `fields`
 *  sobre el documento vigente, en la fila del objeto, y devuelve el paso que
 *  graba `other` — deshacer y rehacer son el mismo paso con los valores
 *  cruzados (los previos y los nuevos de los campos que esa escritura cambió).
 *  Con la foto completa, deshacer revertiría también lo que otra escritura (el
 *  color, la definición) grabó después. */
export function fieldsStep(kind: 'table' | 'view', id: string, fields: Record<string, unknown>,
  other: Record<string, unknown>, reload: () => Promise<void>): HistoryStep {
  return async (pin) => {
    await inObjectOrder(id, async () => {
      const cur = kind === 'table' ? await gov.currentTable(id) : await viewsSvc.currentView(id);
      pin.check();
      if (!cur) throw new Error(`This ${kind} is no longer in the working copy.`);
      if (kind === 'table') await gov.createTable({ ...(cur as CanonicalTable), ...fields });
      else await viewsSvc.updateView(id, { ...(cur as View), ...fields } as ViewInput);
    });
    await reload();
    return fieldsStep(kind, id, other, fields, reload);
  };
}

export function inObjectOrder<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const run = trackDraftWork((_objectWrites.get(id) ?? Promise.resolve()).then(fn, fn));
  const tail = run.then(() => undefined, () => undefined);
  _objectWrites.set(id, tail);
  void tail.then(() => { if (_objectWrites.get(id) === tail) _objectWrites.delete(id); });
  return run;
}

/** Guardado en vuelo del trazo de un wire.
 *  · `points` — lo que el usuario dejó en pantalla (null = lo quitó).
 *  · `base`   — lo último grabado que se conoce de ese wire: a eso vuelve la
 *               pantalla si el guardado falla. `undefined` = no se sabe (su
 *               canvas no estaba abierto cuando se pidió el guardado). */
interface RouteTicket { points: RoutePoint[] | null; base: RoutePoint[] | null | undefined }

/** Guardados en vuelo, por canvas y por wire. Un diagrama que llega mientras
 *  tanto puede traer todavía el trazo previo — manda el que está en vuelo, que
 *  es lo que el usuario acaba de dejar en pantalla. Cada entrada es la ficha
 *  del último guardado pedido para ese wire: su identidad dice si un guardado
 *  que termina sigue siendo el vigente. */
const _pendingRoutes = new Map<string, Map<string, RouteTicket>>();

/** Trazos a pintar para un diagrama recién llegado: los del canvas, saneados y
 *  solo de wires que existen, con los guardados en vuelo encima. De paso, cada
 *  guardado en vuelo se entera de qué hay grabado según este diagrama. */
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

/** Cambia los trazos en pantalla del canvas `saId` (no hace nada si hay otro
 *  abierto). El diagrama del store guarda el canvas de su última carga: se le
 *  deja el trazo al día en sitio — sin cambiar su identidad, que re-armaría
 *  todo el canvas — para que el código que copia ese canvas para cambiarle un
 *  campo (guardar Model properties) no re-siembre trazos desactualizados. */
function showRoutes(saId: string, change: (cur: WireRoutes) => WireRoutes): void {
  useModelerStore.setState((st) => {
    if (st.activeSaId !== saId) return {};
    const routes = change(st.canvasRoutes);
    if (st.diagram?.subjectArea.id === saId) st.diagram.subjectArea.routes = routes;
    return { canvasRoutes: routes };
  });
}

/** Pinta y graba el trazo de un wire. Si el guardado falla la pantalla vuelve
 *  a lo último grabado — no a lo que se veía antes del gesto, que puede ser el
 *  trazo de otro gesto cuyo guardado también falló — y re-lanza. El fallo de un
 *  guardado anterior no pisa un trazo más reciente del mismo wire (gana el
 *  último pedido). Con otro canvas abierto graba igual, sin tocar la pantalla. */
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
    // Con un guardado del mismo wire en vuelo, lo que se ve es su trazo, aún
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

// Siembra: cada vez que cambia el canvas del diagrama (abrir, recargar, cerrar)
// los trazos se toman de él, y el canvas del diagrama queda con los mismos
// trazos que la pantalla (en sitio, como en `showRoutes`). No re-siembran: un
// cambio local del diagrama que conserva el mismo `subjectArea` (reorden
// optimista de columnas) ni una copia local del canvas (guardar Model
// properties), que trae los mismos trazos que ya están en pantalla.
useModelerStore.subscribe((s, prev) => {
  const sa = s.diagram?.subjectArea;
  if (sa === prev.diagram?.subjectArea) return;
  if (sa && sa.routes === s.canvasRoutes) return;
  const routes = seedRoutes(s.diagram);
  if (sa) sa.routes = routes;
  useModelerStore.setState({ canvasRoutes: routes });
});

// La ficha de un canvas (Model properties) se cierra si se abre otro
// canvas (o ninguno) — por el buscador, el Explorer o al borrarlo.
useModelerStore.subscribe((s, prev) => {
  if (s.modelProps && s.activeSaId !== prev.activeSaId) useModelerStore.setState({ modelProps: null });
});

// Los colores del canvas se siembran igual — cada vez que cambia el
// canvas del diagrama (abrir, recargar, cerrar), saneados y con los guardados
// en vuelo encima; una copia local que trae el mismo objeto no re-siembra.
useModelerStore.subscribe((s, prev) => {
  const sa = s.diagram?.subjectArea;
  if (sa === prev.diagram?.subjectArea) return;
  if (sa && sa.colors === s.canvasColors) return;
  const colors = seedColors(s.diagram);
  if (sa) sa.colors = colors;
  useModelerStore.setState({ canvasColors: colors });
});

// Al cambiar de sesión (proyecto, modo o versión) se van la selección, el menú
// y los popups de pegado; el clipboard queda — se pega en otra versión u otro
// proyecto tras su revisión —, y lo limpia el logout (`resetAppState`).
// Suscripción a nivel de módulo (useSessionStore no importa este store, así que
// no hay ciclo). La sesión es la única fuente del changeset activo.
// Lo que esta pestaña escribe en el draft de la sesión abierta: la próxima
// `reload()` recarga esas tablas (`lib/diagramSlice`) y su número no cuenta como
// escritura de otro.
onDraftWrite((cs, changes, writeSeq) => {
  const s = useSessionStore.getState();
  if (s.openMode !== 'editing' || s.activeChangesetId !== cs) return;
  const edited = noEdits();
  // Mientras se abre un canvas, su foto puede ser previa a lo escrito: si es
  // otro, el de pantalla no dice dónde cae nada (va el completo); si es este,
  // lo que el de pantalla no tiene tampoco se puede ubicar.
  const shown = liveDiagram();
  const opening = useModelerStore.getState().openingSaId;
  if (opening && opening !== shown?.subjectArea.id) {
    // Salvo lo que no es de ningún canvas o es de otro (al cambiar de canvas,
    // el anterior guarda su dibujo).
    edited.full = changes.some((ch) => !(ch.collection === 'projects' || ch.collection === 'folders'
      || (ch.collection === 'subject_areas' && ch.entityId !== opening)));
  } else editedTables(shown, changes, edited, !!opening);
  const n = ++_notes;
  for (const t of edited.tables) _owed.tables.set(t, n);
  if (edited.full) _owed.full = n;
  if (writeSeq != null) _seqs.own.add(writeSeq);
});

useSessionStore.subscribe((s, prev) => {
  // La pila de Undo es de la sesión — proyecto, modo y versión, como
  // `canvasSessionKey` —, no solo de la versión: editar → solo lectura →
  // editar la misma versión (p. ej. transferida de ida y vuelta) no debe dejar
  // inversas de la sesión anterior.
  const sessionChanged = s.openMode !== prev.openMode || s.activeProjectId !== prev.activeProjectId
    || s.activeChangesetId !== prev.activeChangesetId;
  if (sessionChanged) {
    useUndoStore.getState().clear();
    // El canvas de la sesión anterior se va en el acto — si siguiera vivo y
    // editable hasta que el refresco lo reabra (varias idas y vueltas), sus
    // escrituras llevarían el documento de A a la versión B. Se conserva
    // `activeSaId`: el refresco lo reabre si existe en la sesión vigente. Las
    // cargas en vuelo de la anterior se descartan al llegar (`_loadSeq`).
    _loadSeq += 1;
    _reloadAfterOpening = null;   // una recarga en espera es de la sesión anterior
    _seqs = seqsFresh();          // los números propios son de su versión
    useModelerStore.setState({
      diagram: null, drawings: [], openingSaId: null,
      selectedTableId: null, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null,
      columnTarget: null, relPreset: null, subcatArmed: false, hoverEdgeId: null, hoverNodeId: null,
      colSel: null, colMenu: null, pasteTarget: null, tablePasteOpen: false, panelFocusColId: null,
      inspect: null, searchOpen: false, navigating: null, pendingFocusTableId: null, pendingFocusColId: null,
      modelProps: null, colorPreview: null, freshNodes: {},
    });
  }
});

/**
 * Arma el árbol del Model Explorer del proyecto activo a partir del estado plano
 * `folders`/`subjectAreas`: project → carpetas anidadas (por `parentFolderId`) →
 * canvases (por `folderId`; los de `folderId == null` cuelgan de la raíz).
 * Carpetas (= subject areas de Erwin) y canvases se ordenan alfabéticamente
 * (case-insensitive); `order` (el orden de Erwin que estampa el kit) queda solo
 * como desempate.
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

/** Objeto abierto en el Object Inspector (sin canvas). Una columna
 *  abre el inspector de su tabla con la columna preseleccionada. */
export interface InspectTarget { kind: 'table' | 'view'; id: string; colId?: string | null }

