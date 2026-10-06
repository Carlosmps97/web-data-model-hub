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
import { facetNouns } from '@/lib/facets';
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
  afterRevalidation, isVersionError, pinSession, stillAskedSession, touchesVersion, type SessionPin,
} from '@/features/modeler/lib/sessionGuard';
import { bestEffort, pinnedViewDeps } from '@/features/modeler/lib/pinnedWrites';
import {
  cleanRoute, cleanRoutes, pruneRoutes, routableWireIds, routeOf, sameRoute, wireIdsOfTable,
} from '@/features/modeler/lib/wireRoute';
import type { RoutePoint, WireRoutes } from '@/features/modeler/lib/wireRoute';
import {
  removeColumnSource, syncNewColumnToMirrorViews, syncRemovedColumnFromViews, syncRenamedColumnInViews,
} from '@/features/modeler/lib/viewSync';
import * as viewsSvc from '@/services/views.service';
import type { View, ViewInput } from '@/services/views.service';
import { useSessionStore } from '@/store/useSessionStore';
import { NothingDoneError, pushUndo, useUndoStore } from '@/store/useUndoStore';
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
  /** Doc 109: `kind` = qué bloque abrió el menú (default tabla); una vista sólo
   *  ofrece el color. */
  colMenu: { x: number; y: number; tableId: string; colId: string | null; kind?: 'table' | 'view' } | null;
  openColMenu: (m: { x: number; y: number; tableId: string; colId: string | null; kind?: 'table' | 'view' }) => void;
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
  /** Doc 112: la ficha del canvas abierto (Model properties: sus UDPs y sus
   *  colores) se abre desde el toolbar Y desde el color en Properties. `boxes`
   *  = las cajas a pintar en ese canvas (Properties pasa la suya); sin `boxes`,
   *  las seleccionadas en el canvas. Se cierra sola al cambiar de canvas o de
   *  sesión: lo que muestra y graba es de UN canvas. */
  modelProps: { saId: string; boxes?: string[] } | null;
  openModelProps: (boxes?: string[]) => void;
  /** Cierra la ficha; con `only`, sólo si la abierta es ESA (un Save lento de
   *  una ficha ya cerrada no cierra otra que se abrió después). */
  closeModelProps: (only?: { saId: string; boxes?: string[] }) => void;
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
  /** Doc 109: themes de color del proyecto activo (Data Standards → Themes) y
   *  su índice por id. Las cajas los usan por referencia ('theme:<id>'). */
  themes: Theme[];
  themeIdx: Map<string, Theme>;
  /** Carga los themes de `projectId` (best-effort; descarta respuestas de un
   *  proyecto que dejó de ser el activo). */
  loadThemes: (projectId: string | null) => Promise<void>;
  /** Doc 109: colores de las cajas EN el canvas abierto (excepciones sobre el
   *  color propio de cada tabla/vista: {id: ColorRef}). Se siembran del
   *  diagrama; cada bloque lee el suyo por selector. */
  canvasColors: Record<string, string>;
  /** Doc 109: pinta las cajas `ids` EN ESTE canvas — `ref` = ColorRef ('none'
   *  = sin color aquí), `null` = vuelven al color de su tabla/vista. Pinta al
   *  instante, graba UNA vez en la working copy y apila su Undo; si falla,
   *  vuelve a lo anterior y avisa. Fuera de una sesión de edición, nada. */
  setBoxColors: (ids: string[], ref: string | null) => Promise<void>;
  /** Doc 112: graba de una vez varias cajas del canvas abierto con colores
   *  distintos — `patch` = {id: ColorRef | null} (null = vuelve al color de su
   *  tabla). La usa la ficha del canvas al Save: UN request y UN Undo (`label`).
   *  Sólo lo que de verdad cambia; true si quedó grabado (o no había nada que
   *  grabar), false si no se pudo (ya avisó). */
  applyCanvasColors: (patch: Record<string, string | null>, label?: string) => Promise<boolean>;
  /** Doc 112: colores PENDIENTES de la ficha del canvas abierta (sin grabar),
   *  que las cajas muestran encima de los grabados; null = no hay. */
  colorPreview: Record<string, string | null> | null;
  setColorPreview: (p: Record<string, string | null> | null) => void;
  /** Doc 109: color PROPIO de una tabla o vista (todos sus canvases); null =
   *  sin color. Un cambio del modelo (changeset), con Undo. */
  setObjectColor: (id: string, ref: string | null) => Promise<void>;
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
  /** Doc 111: el dibujo recién creado — el canvas lo deja SELECCIONADO (si no,
   *  nacía detrás de la tabla del centro y parecía no haberse creado) y lo
   *  limpia. */
  justAddedDrawingId: string | null;
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
  /** @internal recarga folders+canvases del proyecto y depura la selección.
   *  `isCurrent` (doc 105): si al llegar la respuesta devuelve false, no escribe. */
  _refreshProject: (projectId: string, isCurrent?: () => boolean) => Promise<void>;
  reload: () => Promise<void>;
  /** Doc 83: cachea el naming config de `projectId` (descarta respuestas de
   *  un proyecto que dejó de ser el activo; un fallo no pisa lo cacheado). */
  loadNaming: (projectId: string | null) => Promise<void>;
  saveLayout: (tableId: string, pos: { x: number; y: number }) => Promise<void>;
  /** Doc 105 (A4-o1): posiciones de VARIOS bloques movidos juntos (selección
   *  múltiple) en UNA escritura. Corre en segundo plano: un fallo se avisa acá. */
  saveNodePositions: (positions: Record<string, { x: number; y: number }>) => Promise<void>;
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
  /** Doc 105 (A4-o4): borra la vista del MODELO (todos los canvases) con Undo —
   *  el mismo desde los paneles del canvas y el Object Inspector: repone el doc
   *  y la vuelve a listar, en su posición, en cada canvas que la listaba.
   *  `canvasIds`: dónde se usa, si el llamador ya lo sabe (si no, se consulta).
   *  El refresco posterior al borrado queda en manos del llamador. */
  deleteView: (view: View, opts?: { canvasIds?: string[] }) => Promise<void>;
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
// Doc 104: la versión en edición cuando se AGENDÓ el guardado de dibujos. Si al
// dispararse la sesión ya no edita esa versión (transferida, eliminada,
// enviada a revisión), el guardado se descarta: ya no le corresponde.
let _drawingsCs: string | null = null;
/** ¿La sesión sigue EDITANDO la versión `cs`? */
const stillEditing = (cs: string | null): boolean => {
  const s = useSessionStore.getState();
  return !!cs && s.openMode === 'editing' && s.activeChangesetId === cs;
};
/** Versión en edición AHORA (null fuera de una sesión de edición). */
const editingCs = (): string | null => {
  const s = useSessionStore.getState();
  return s.openMode === 'editing' ? s.activeChangesetId : null;
};
/** Doc 105 (O1): «<qué falló>: <motivo>.» — el motivo solo (p. ej. «Internal
 *  server error…», junto a «View created») no dice QUÉ falló. Sin motivo
 *  legible, sólo el contexto; si el motivo ya empieza como el contexto, va solo. */
export function failureText(context: string, e: unknown): string {
  const reason = e instanceof Error ? e.message.trim() : '';
  if (!reason) return context;
  if (reason.toLowerCase().startsWith(context.toLowerCase())) return reason;
  return `${context}: ${reason.replace(/[.\s]+$/, '')}.`;
}

/** Guarda YA los dibujos con el guardado pendiente (debounce de 500 ms) del
 *  canvas `saId` — al cambiar de canvas o al cerrarlo, el disparo con debounce
 *  ya no los escribiría (su canvas no es el abierto) y el último trazo se
 *  perdía. Doc 105 (F1): si falla, el mismo aviso que el guardado con debounce. */
function flushPendingDrawings(saId: string | null, drawings: Drawing[]): void {
  if (!_drawingsTimer || !saId) return;
  clearTimeout(_drawingsTimer); _drawingsTimer = null;
  const cs = _drawingsCs;
  if (stillEditing(cs)) {
    void struct.setSubjectAreaDrawings(saId, drawings)
      .catch((e: unknown) => reportCanvasSaveError(e, cs, "Couldn't save the drawings"));
  }
}

/** Doc 104 (dibujos) / doc 105 (F1): aviso del fallo de un guardado del canvas
 *  que corre en SEGUNDO PLANO (dibujos, posiciones), pedido editando `cs`. Un
 *  403/404/409 de la versión puede ser que cambió por fuera (transferida,
 *  eliminada, enviada): se espera la revalidación y, si la sesión ya no edita
 *  esa versión, ella dio el aviso correcto. Si sigue igual (rol perdido, nombre
 *  duplicado, proxy) o el error es otro (red), se muestra el motivo real. */
async function reportCanvasSaveError(e: unknown, cs: string | null, fallback: string): Promise<void> {
  if (touchesVersion(e, cs)) {
    await afterRevalidation();
    if (!stillEditing(cs)) return;
  }
  toast.error(failureText(fallback, e));   // doc 105 (O1): qué falló + el motivo
}
// Paste de tabla en vuelo (doc 50): un Ctrl+V repetido no dispara otro.
let _pasteTableBusy = false;
// Secuencia de cargas del diagrama: descarta respuestas fuera de orden (dos
// clicks rápidos en el explorer, reload en vuelo al cambiar de canvas).
let _loadSeq = 0;
// Doc 105 (ronda 3, R7-D): la carga que puso `openingSaId` (el spinner del
// Explorer) — sólo ella lo apaga.
let _openingSeq = 0;
// Doc 105 (ronda 4, R10-B): `reload()` pedido mientras se ABRÍA el mismo
// canvas (el Refresh lo reabre y una edición termina): esa apertura pudo pedir
// su foto antes del guardado — se recarga al terminarla. `prev`: el diagrama
// que había al pedirlo (el Explorer se entera si el cambio fue estructural).
// Ronda 5 (R15-H3): también si se abría OTRO canvas — `saId` es el editado.
let _reloadAfterOpening: { saId: string; prev: Diagram | null } | null = null;
// Doc 105 (ronda 7, R18a-6): la PRÓXIMA `reload()` cierra el canvas sin su
// propio aviso si falla — la pide la apertura fallida de otro canvas, cuyo
// llamador ya avisa la caída (una caída, un aviso). La consume la `reload()`
// al empezar (así no queda armada si ésta termina antes).
let _quietReloadFailure = false;
// Doc 105 (A4-o2): lo mismo para los refrescos del Explorer — sólo el MÁS
// RECIENTE escribe. La respuesta tardía de uno anterior (otra sesión: se abrió
// otra versión, modo o proyecto mientras cargaba) no pisa proyectos, proyecto
// activo, árbol, esquemas ni el canvas del vigente.
let _explorerSeq = 0;
/** Doc 105 (H4b): lo que relee el árbol tras una mutación del Explorer escribe
 *  sólo si sigue la sesión en que se PIDIÓ la mutación y no empezó un refresco
 *  más nuevo (que trae el árbol vigente). Se toma al empezar la mutación. */
const explorerRequest = (): { isCurrent: () => boolean; pin: SessionPin } => {
  const seq = _explorerSeq;
  const pin = pinSession();
  return { isCurrent: () => seq === _explorerSeq && pin.holds(), pin };
};
/** La sesión de canvas AHORA (proyecto + modo + versión): algo pedido antes
 *  sólo se avisa si sigue siendo la misma (doc 105). */
const sessionNow = (): string => {
  const s = useSessionStore.getState();
  return `${s.openMode ?? ''}|${s.activeProjectId ?? ''}|${s.activeChangesetId ?? ''}`;
};
/** Motivo legible de un error para intercalarlo en un aviso (sin punto final). */
const reasonOf = (e: unknown): string => errorReason(e, 'unknown error');

/** Doc 105 (A3/A5): alguna lectura previa al borrado falló — no se borró nada.
 *  H3: como `NothingDoneError`, así el Undo que lo pidió vuelve a la pila. O3:
 *  con el sustantivo del modelo abierto (entity / table), como el diálogo. */
const dependentsUnreadable = (noun: string) => {
  const reason = `Couldn't check what depends on this ${noun}`;
  return new NothingDoneError(reason, `${reason}: nothing was deleted. Try again.`);
};
const VIEW_USAGE_UNREADABLE = "Couldn't check where this view is used: nothing was deleted. Try again.";

/** Doc 105 (H5): el error con que termina un borrado cuya lectura previa falló
 *  (no se borró nada). Un 403/404/409 de la versión puede ser que cambió de
 *  manos: se espera la revalidación. Si la sesión cambió, sigue el error
 *  ORIGINAL — la revalidación ya avisó y los llamadores del doc 104 lo callan;
 *  «Try again» sería falso. Si no, `unreadable()`; fuera de una sesión de
 *  edición, el motivo real (lo dice el error). */
async function readFailure(e: unknown, askedCs: string | null, pin: SessionPin, unreadable: () => Error): Promise<unknown> {
  if (touchesVersion(e, askedCs)) await afterRevalidation();
  if (!pin.holds()) return e;
  return editingCs() ? unreadable() : e;
}

type ListedViews = Awaited<ReturnType<typeof struct.listedViews>>;
/** Doc 105 (H2): canvases donde es miembro alguna de `viewIds` (vistas de
 *  `tableId`). Una vista MULTI-FUENTE puede estar en un canvas que no tiene la
 *  tabla que se borra: la cascada del backend la saca también de ése. */
async function canvasesOfViews(tableId: string, viewIds: string[]): Promise<string[]> {
  const wanted = new Set(viewIds);
  const { views } = await viewsSvc.tableViews(tableId);
  return [...new Set(views.filter((v) => wanted.has(v.id)).flatMap((v) => v.canvases.map((c) => c.id)))];
}

/** Doc 105 (F4, A4-o4): de `viewIds`, cuáles lista cada canvas y dónde — se lee
 *  ANTES de borrarlas: el backend las saca de toda lista en el mismo request
 *  (doc 88 §4) y el Undo las repone con esto. Sólo quedan los canvases que
 *  listan alguna (un canvas legacy no lista ninguna: su regla por fuentes las
 *  vuelve a mostrar sola). Si una lectura falla, rechaza. */
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
    // Doc 105 (A4-o2): si mientras cargaba empezó un refresco del Explorer (otra
    // sesión), esta respuesta ya no le corresponde — el refresco trae la suya.
    const seq = _explorerSeq;
    const schemas = await schemasSvc.listSchemas();
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
    // Doc 105 (ronda 5, R15-H9): el nombre que se muestra, según la faceta.
    return get().viewMode === 'logical' ? t.logicalName || t.physicalName : t.physicalName || t.logicalName;
  },
  pasteTable: () => runBlocking('Creating table…', async () => {
    if (_pasteTableBusy) return null;   // Ctrl+V repetido con el paste en vuelo
    const clip = get().tblClipboard;
    const saId = get().activeSaId;
    if (!clip) throw new Error('Nothing to paste');
    if (!saId) throw new Error('Pick a Subject Area');
    // Doc 105 (H1): la acción es de la sesión donde empezó (ver `pinSession`).
    const pin = pinSession();
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
        pin.check();
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
        pin.check();
        await struct.addToCanvas(saId, { tableIds: [id], layout: { [id]: pos } });
        await get().reload();
        // Doc 105 (R7-E): no selecciona en otra sesión; ronda 4 (6c): tampoco
        // devuelve el nombre — el llamador avisaría «pasted as» en la nueva.
        if (!pin.holds()) return null;
        set({ selectedTableId: id, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });   // al frente + visible
        // Ronda 5 (R15-H9): el nombre de la copia que se muestra, según la faceta —
        // ronda 6 (R17a-11): también en la etiqueta del Undo.
        const shown = get().viewMode === 'logical' ? logicalName || physicalName : physicalName;
        pushUndo(`Paste ${facetNouns(get().viewMode).one} ${shown}`, () => get().deleteTable(id), pin);
        return shown;
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
    const session = useSessionStore.getState();
    // Doc 105 (ronda 4): se dispara en segundo plano (`void`) — un diagrama de
    // otra sesión en pantalla se avisa acá, nunca un rechazo sin manejar.
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
    const pin = pinSession();                        // doc 105 (H1)
    get().markDirty();
    try {
      await writeWireRoute(saId, wireId, next.length ? next : null, routableWireIds(dia.relationships));
    } catch (e) {
      // Doc 105: el criterio de los demás guardados del canvas (espera la
      // revalidación ante un error de la versión; qué falló + el motivo).
      await reportCanvasSaveError(e, session.activeChangesetId, "Couldn't save the wire route");
      return;
    }
    pushUndo('Reroute wire', () => writeWireRoute(saId, wireId, prev), pin);
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
    // Sólo tablas y vistas de ESTE canvas (un selector del sistema que se
    // cierra con otro canvas abierto no deja colores huérfanos), con un color
    // válido, y sólo lo que cambia.
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
    pushUndo(label ?? (ids.length === 1 ? 'Change color' : `Change color of ${ids.length} boxes`),
      () => writeCanvasColors(saId, prev), pin);
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
      // El documento VIGENTE en la working copy — no el del diagrama: su
      // recarga pudo fallar o quedar reemplazada por otra y no tener el guardado
      // anterior (lo revertía). Ni el canvas abierto: el color es de la tabla.
      const table = await gov.currentTable(id);
      const view = table ? null : await viewsSvc.currentView(id);
      pin.check();
      if (!table && !view) throw new Error('This table or view is no longer in the working copy.');
      if (((table ?? view)!.color ?? null) === value) return;
      get().markDirty();
      const reload = () => get().reload();
      if (table) {
        await gov.createTable({ ...table, color: value });
        pushUndo(`Change color of ${table.physicalName}`, undoFields('table', id, { color: table.color ?? null }, pin, reload), pin);
      } else if (view) {
        await viewsSvc.updateView(view.id, { ...view, color: value } as ViewInput);
        pushUndo(`Change color of ${view.name}`, undoFields('view', id, { color: view.color ?? null }, pin, reload), pin);
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
  justAddedDrawingId: null,
  addDrawing: (type) => {
    const saId = get().activeSaId; if (!saId) return;
    const rf = get().flow;
    const { w, h } = DRAWING_DEFAULT_SIZE[type];
    // Centro del viewport actual en coordenadas de flujo (cae al origen sin instancia).
    const c = rf
      ? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      : { x: 120, y: 120 };
    // Doc 109: un texto nuevo nace con el modelo de formato (fuente, color del
    // texto, sin borde ni relleno); las formas, con su borde de siempre.
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
    // Doc 109: un patch que no cambia nada (elegir la alineación o el tamaño
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
      if (!stillEditing(_drawingsCs)) return;          // doc 104: la sesión cambió
      // Canvas capturado al AGENDAR el flush: si el usuario cambió de canvas
      // dentro del debounce, los drawings actuales ya son del canvas nuevo y
      // no deben escribirse con este disparo (selectSubjectArea hace el flush
      // del canvas anterior al cambiar).
      if (get().activeSaId !== saId) return;
      // El guardado es en background (debounce): si falla, avisar — un error
      // silencioso deja al usuario creyendo que sus dibujos persistieron.
      const cs = _drawingsCs;
      void struct.setSubjectAreaDrawings(saId, get().drawings)
        .catch((e: unknown) => reportCanvasSaveError(e, cs, "Couldn't save the drawings"));
    }, 500);
  },
  dirty: false,
  markDirty: () => { if (!get().dirty) set({ dirty: true }); },
  clearDirty: () => { if (get().dirty) set({ dirty: false }); },
  saveAll: async () => {
    // Doc 104: sin sesión de edición no hay nada que guardar (la versión se
    // transfirió, eliminó o envió mientras el aviso de «Save and leave» seguía
    // abierto): no se escribe — antes caía a producción sin revisión.
    if (useSessionStore.getState().openMode !== 'editing') {
      if (_drawingsTimer) { clearTimeout(_drawingsTimer); _drawingsTimer = null; }
      set({ dirty: false });
      return;
    }
    const saId = get().activeSaId;
    // Doc 105 (R7-A): sin el canvas de ESTA sesión no hay nada que guardar (tras
    // cambiar de versión, sus dibujos ya se limpiaron: grabarlos los borraría).
    // Doc 105 (ronda 4): uno de otra sesión en pantalla FALLA (con el motivo):
    // no pasa por un guardado exitoso.
    if (!saId || !editableDiagram()) return;
    const pin = pinSession();   // doc 105 (H1): dos escrituras seguidas
    // Capturados JUNTO con saId: si durante el await del layout el usuario
    // cambia de canvas, get().drawings ya sería el canvas NUEVO y el flush
    // los escribiría bajo el saId viejo (pisando sus dibujos persistidos).
    const drawings = get().drawings;
    await get().saveAllLayout();
    // Flush inmediato de drawings (cancela el debounce pendiente).
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
  loadProjects: async () => {
    const seq = _explorerSeq;   // doc 105 (A4-o2): ídem loadSchemas
    let projects: Project[];
    try {
      projects = await struct.listProjects();
    } catch (e) {
      // Doc 105 (H6): si un refresco más nuevo la dejó atrás, su error tampoco
      // cuenta — el refresco trae (y avisa) lo suyo: una caída, un aviso.
      if (seq !== _explorerSeq) return;
      throw e;
    }
    if (seq === _explorerSeq) set({ projects });
  },
  selectProject: async (pid) => {
    const { isCurrent } = explorerRequest();   // doc 105 (R7-C): respuesta de otra sesión → no escribe
    const [folders, subjectAreas] = await Promise.all([struct.listFolders(pid), struct.listSubjectAreas(pid)]);
    if (!isCurrent()) return;
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
    const { isCurrent } = explorerRequest();   // doc 105 (R7-C): respuesta de otra sesión → no escribe
    const [folders, subjectAreas] = await Promise.all([struct.listFolders(pid), struct.listSubjectAreas(pid)]);
    if (!isCurrent()) return;
    set((s) => ({ trees: { ...s.trees, [pid]: { folders, subjectAreas } } }));
  },
  refreshExplorer: async () => {
    // Doc 105 (A4-o2): sólo el refresco más reciente escribe (`_explorerSeq`).
    const seq = ++_explorerSeq;
    const stale = () => seq !== _explorerSeq;
    // Doc 105 (H4a): toda carga del diagrama pedida ANTES (la recarga del
    // refresco anterior, un clic en el Explorer, un reload) es de otra sesión o
    // de un árbol viejo: se descarta al llegar — si el canvas no existe acá,
    // este refresco no lo abre y nada más subiría `_loadSeq`. Su spinner, fuera.
    _loadSeq += 1;
    const prevSaId = get().activeSaId;
    // Doc 105 (ronda 3): un canvas que se estaba ABRIENDO (clic en el Explorer
    // justo antes de Refresh) es el que el usuario quiere: se abre al final si
    // sigue existiendo — antes esta invalidación lo perdía en silencio.
    const openingTarget = get().openingSaId;
    // Doc 75 D8: la sesión de canvas es de UN proyecto — el explorer muestra
    // ese y sólo ese; el resto de proyectos no se carga ni se lista.
    const pid = useSessionStore.getState().activeProjectId;
    set({ trees: {}, projects: [], projectDeletionPending: false, openingSaId: null });
    const gone = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 409);
    // Doc 104: un 403/404 de la VERSIÓN abierta no es un proyecto borrado.
    // Se espera la revalidación de la sesión: si la cambió (transferida o
    // eliminada), ella ya avisó y acá se termina en silencio; si no, el error
    // es real y sigue al llamador. La versión se toma AL PEDIR: cuando el
    // error llega, la revalidación pudo haber cerrado ya la sesión.
    const askedCs = useSessionStore.getState().activeChangesetId;
    const askedKey = sessionNow();
    const versionError = (e: unknown) => isVersionError(e, askedCs);
    const sessionMoved = async (e: unknown) => {
      if (!versionError(e)) return false;
      await afterRevalidation();
      // Doc 105 (ronda 3): la SESIÓN (modo, proyecto y versión), no sólo la
      // versión — pasar a solo lectura sobre la misma también es otra sesión.
      return sessionNow() !== askedKey;
    };
    // Doc 105 (A4-o3): lo que no corta el refresco (esquemas, recarga del
    // canvas) se avisa sólo si la sesión sigue siendo la pedida — mismo
    // criterio que el Explorer (sessionGuard).
    const stillAsked = async (e: unknown) =>
      !stale() && (await stillAskedSession(e, askedCs, askedKey, sessionNow)) && !stale();
    // Los dropdowns de esquema también dependen del overlay de la versión.
    // Doc 105 (H6): su error se avisa sólo si el resto del refresco anduvo —
    // si no, ya hay un aviso (el del refresco o el del canvas): una caída, un aviso.
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
              colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null, colClipboard: null, tblClipboard: null });
        if (pid) {
          toast.error('This project was deleted in a published version.');
          useSessionStore.getState().closeModel();
        }
        return false;
      }
      set({ activeProjectId: pid });
      try {
        // Depura activeSaId vs la nueva membresía (si el refresco sigue vigente).
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
      // Ronda 5 (observación R15): sin reapertura, una recarga pendiente no
      // tiene quién la resuelva — el canvas ya no está.
      if (!reopen) _reloadAfterOpening = null;
      if (reopen) {
        // El canvas sobrevive al cambio de contexto: re-cargarlo COMPLETO
        // (diagrama + drawings) bajo el overlay de la versión nueva.
        try { await get().selectSubjectArea(reopen); }
        catch (e) {
          // Doc 105 (A4-o3): si la sesión cambió, el refresco de la nueva decide
          // qué canvas queda; si no, se cierra (su diagrama es de la sesión
          // anterior) y se dice por qué — antes se cerraba en silencio.
          if (!(await stillAsked(e))) return false;
          set({ activeSaId: null, diagram: null, selectedTableId: null, drawings: [], colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null });
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
    // Flush inmediato de drawings pendientes del canvas ANTERIOR: el debounce
    // de 500ms perdería el último trazo al cambiar de canvas.
    flushPendingDrawings(get().activeSaId, get().drawings);
    const seq = ++_loadSeq;
    _openingSeq = seq;
    const pin = pinSession();   // doc 105 (R7-A): el sello de la sesión del diagrama
    set({ openingSaId: saId });
    let installed = false;
    let threw = false;   // ronda 7 (R18a-6): la apertura falló — quien la pidió lo avisa
    try {
      const asked = canvasClock();
      const loaded = await mod.loadDiagram(saId);
      // Descarta respuestas VIEJAS: si mientras cargaba el usuario seleccionó
      // otro canvas (o corrió otro reload), pisar el diagrama con esta
      // respuesta dejaría el canvas mostrando un subject area ajeno.
      if (seq !== _loadSeq) return;
      const diagram = sealDiagram(withWrittenCanvas(loaded, asked), pin);
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
      installed = true;
      set({ ...crossProject, activeSaId: saId, diagram, selectedTableId: null, selectedEdgeId: null,
            colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null,
            drawings: diagram.subjectArea.drawings ?? [] });
      // Doc 83: reglas de naming del proyecto del canvas (best-effort, no bloquea).
      void get().loadNaming(pid ?? get().activeProjectId);
      // Doc 109: themes de color del proyecto (best-effort, no bloquea).
      void get().loadThemes(pid ?? get().activeProjectId);
    } catch (e) {
      threw = true;
      throw e;
    } finally {
      // Sólo la apertura que puso el spinner lo apaga: una vieja descartada no
      // apaga el de la que sigue en vuelo (doc 105: y una invalidada por otra
      // carga no lo deja pegado).
      if (seq === _openingSeq && get().openingSaId === saId) {
        set({ openingSaId: null });
        // La recarga pedida durante ESTA apertura (ronda 4, R10-B / ronda 5, R15-H3).
        const pending = _reloadAfterOpening;
        _reloadAfterOpening = null;
        if (pending?.saId === saId) {
          if (installed) await reloadAfterOpening(pending.prev);   // el mismo: su foto pudo ser de antes
        } else if (pending && installed) {
          get().bumpExplorer();                                    // se abrió otro: el Explorer igual se entera
        } else if (pending) {
          // Falló: sigue el editado, con la foto de antes. Ronda 7 (R18a-6): si
          // su recarga también falla, cierra el canvas sin otro aviso — el de la
          // apertura ya cuenta la caída.
          await reloadAfterOpening(pending.prev, threw);
        }
      }
    }
  },
  // ── Folders / Canvas / Projects (gestión del Model Explorer) ───────────
  loadFolders: async (projectId) => {
    const { isCurrent } = explorerRequest();   // doc 105 (R7-C): respuesta de otra sesión → no escribe
    const folders = await struct.listFolders(projectId);
    if (isCurrent()) set({ folders });
  },
  // Refresca folders+canvases del proyecto activo tras una mutación y deja
  // `activeSaId` inválido en null (su canvas pudo haberse borrado).
  // Doc 105 (H4b): cada una relee el árbol sólo si sigue la sesión en que se
  // pidió (`explorerRequest`): la respuesta tardía de un draft no pisa el
  // Explorer de la versión que se abrió después.
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
    // En otra sesión el canvas nuevo no existe (se creó en el draft anterior).
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
    const pin = pinSession();   // doc 105 (H1): lee y después escribe
    const published = (await mod.listProjects()).find((p) => p.id === pid);
    if (!published) throw new Error('The published project could not be read.');
    pin.check();
    await struct.reviveProject(pid, published);
    set({ projectDeletionPending: false });
    await get().refreshExplorer();
  },
  // Helper interno: recarga folders+canvases del proyecto al cache `trees` y,
  // si es el proyecto ACTIVO, espeja los campos legacy y depura la selección
  // (el canvas activo pudo haberse borrado).
  _refreshProject: async (projectId, isCurrent) => {
    const [folders, subjectAreas, projectDeletionPending] = await Promise.all([
      struct.listFolders(projectId), struct.listSubjectAreas(projectId), struct.projectDeletionPending(projectId),
    ]);
    if (isCurrent && !isCurrent()) return;   // doc 105 (A4-o2): respuesta de un refresco viejo
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
    const quiet = _quietReloadFailure;
    _quietReloadFailure = false;
    const id = get().activeSaId; if (!id) return;
    // Doc 105 (ronda 3, R7-D/E): con una APERTURA de canvas en vuelo (clic en
    // el Explorer, reapertura del refresco) ésa trae el diagrama al día —
    // recargar ahora la invalidaba y dejaba el spinner pegado.
    if (get().openingSaId) {
      // Ronda 4 (R10-B) / ronda 5 (R15-H3): lo resuelve esa apertura al terminar
      // (con el diagrama de ahora para el aviso al Explorer).
      _reloadAfterOpening ??= { saId: id, prev: get().diagram };
      return;
    }
    const seq = ++_loadSeq;
    const pin = pinSession();   // doc 105 (R7-A): el sello de la sesión del diagrama
    const askedCs = useSessionStore.getState().activeChangesetId;
    const asked = canvasClock();
    let loaded: Diagram;
    try {
      loaded = await mod.loadDiagram(id);
    } catch (e) {
      // Doc 105 (ronda 5, R15-H6): antes cerraba el canvas EN SILENCIO ante
      // cualquier falla. Un error de la versión espera la revalidación (si la
      // sesión cambió, ella avisó y el canvas ya se limpió). Ronda 7 (R18a-1):
      // cualquier otra falla también lo CIERRA, y lo dice — lo que había en
      // pantalla es de antes de la escritura que acaba de terminar y editar
      // desde ahí (store, paneles, popups) pisaba lo grabado. Sin reintento
      // automático: se reabre desde el Explorer. Un 404, con su propio aviso.
      if (touchesVersion(e, askedCs)) await afterRevalidation();
      if (seq !== _loadSeq || get().activeSaId !== id) return;   // otra carga (o la sesión cambió: sube `_loadSeq`)
      // Ronda 7: un dibujo del debounce se guarda antes de cerrar (el canvas
      // sigue existiendo); con el 404 ya no está.
      if (!(e instanceof ApiError && e.status === 404)) flushPendingDrawings(id, get().drawings);
      set({ activeSaId: null, diagram: null, selectedTableId: null, drawings: [], colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null });
      if (e instanceof ApiError && e.status === 404) {
        toast.error('This canvas is no longer in this version, so it was closed. Open another one from the explorer.', { id: `dmh-canvas-reload:${sessionNow()}` });
      } else if (!quiet) {
        toast.error(`Couldn't reload the canvas: ${reasonOf(e)}. Open it again from the explorer.`, { id: `dmh-canvas-reload:${sessionNow()}` });
      }
      return;
    }
    // Descarta respuestas viejas (cambio de canvas o carga más nueva en vuelo).
    if (seq !== _loadSeq || get().activeSaId !== id) return;
    // Doc 99: si algo del canvas se grabó después de pedir este diagrama, se
    // repone (la foto puede ser de antes de ese guardado).
    const diagram = sealDiagram(withWrittenCanvas(loaded, asked), pin);
    const prev = get().diagram;
    set({ diagram });
    // Doc 88 §2: un cambio ESTRUCTURAL del MISMO canvas (tabla/vista nueva,
    // borrada o renombrada, columnas) invalida el catálogo del Explorer; cambiar
    // de canvas no (el inventario es del proyecto, no del canvas).
    if (prev && prev.subjectArea.id === diagram.subjectArea.id && diagramSignature(prev) !== diagramSignature(diagram)) {
      get().bumpExplorer();
    }
  },
  saveLayout: (tableId, pos) => get().saveNodePositions({ [tableId]: pos }),
  saveNodePositions: async (positions) => {
    const saId = get().activeSaId; if (!saId) return;
    // Doc 105 (R7-A / ronda 4): el canvas de ESTA sesión; uno de otra en
    // pantalla se avisa acá (segundo plano: nunca un rechazo sin manejar).
    let dia: Diagram | null;
    try { dia = editableDiagram(); } catch (e) { await reportCanvasSaveError(e, editingCs(), "Couldn't save the position"); return; }
    if (!dia) return;
    // Doc 105 (ronda 5, R15-H1): sólo los bloques del canvas en pantalla — uno
    // de otro canvas (pintado por error bajo éste) no entra a su layout.
    const onCanvas = canvasNodeIds(dia);
    const ids = Object.keys(positions).filter((id) => onCanvas.has(id));
    if (!ids.length) return;
    get().markDirty();
    // Doc 99: las posiciones quedan también en el diagrama del store, EN SITIO
    // (sin cambiar su identidad, que re-armaría el canvas). El diagrama guarda
    // el layout de su última carga y el canvas se re-arma con él al pasar de
    // Logical a Physical o al guardar Model properties: sin esto el bloque
    // recién movido volvía a su sitio viejo hasta el siguiente reload — y un
    // trazo manual quedaba referido a una posición que ya no era la de pantalla.
    // Doc 100 (P6): en píxeles enteros, igual que lo que se graba.
    const at: Record<string, { x: number; y: number }> = {};
    for (const id of ids) at[id] = wholePoint({ x: positions[id].x, y: positions[id].y });
    const sa = liveDiagram()?.subjectArea;
    if (sa && sa.id === saId) sa.layout = { ...(sa.layout ?? {}), ...at };
    // Doc 105 (F1): el canvas lo dispara en segundo plano (`void`): un fallo se
    // avisa acá, con el criterio de los dibujos — nunca un rechazo sin manejar.
    // A4-o1: todos los bloques movidos juntos van en UNA escritura (MERGEA).
    const cs = editingCs();
    try {
      await struct.setSubjectAreaLayout(saId, at);
    } catch (e) {
      await reportCanvasSaveError(e, cs, "Couldn't save the position");
    }
  },
  saveAllLayout: async () => {
    const saId = get().activeSaId; const rf = get().flow;
    if (!saId || !rf || !editableDiagram()) return;   // doc 105 (R7-A / ronda 4)
    const layout: Record<string, { x: number; y: number }> = {};
    // Tablas Y vistas (F3: la posición de una vista vive en layout[viewId],
    // misma estructura) Y símbolos de subcategoría (doc 53: layout[symbolId]);
    // los shapes NO — sus posiciones viven en `drawings`.
    for (const n of rf.getNodes()) if (n.type === 'table' || n.type === 'view' || n.type === 'subcat') layout[n.id] = { x: n.position.x, y: n.position.y };
    await struct.setSubjectAreaLayout(saId, layout); // MERGEA en backend (M3a)
  },
  autoOrganize: async () => {
    const dia = editableDiagram(); const saId = get().activeSaId;   // doc 105 (ronda 4)
    if (!dia || !saId) return;
    const pin = pinSession();   // doc 105 (H1): el cálculo de ELK es asíncrono
    // Doc 84 E: en modo visor el arrange es de ESTA sesión — ni dirty ni persistencia.
    const viewer = useSessionStore.getState().openMode === 'readonly';
    if (!viewer) get().markDirty();
    // Doc 99: estado ANTES del arrange, para el Undo — posiciones de los nodos
    // vivos (las mismas que guarda Save) y trazos manuales del canvas. Doc 105
    // (ronda 3): se toman ANTES de calcular — si mientras ELK trabaja se abre
    // otro canvas, los nodos vivos ya serían de ése.
    const prevRoutes = get().canvasRoutes;
    const prevLayout: Record<string, { x: number; y: number }> = {};
    for (const n of get().flow?.getNodes() ?? []) {
      if (n.type === 'table' || n.type === 'view' || n.type === 'subcat') {
        prevLayout[n.id] = { x: n.position.x, y: n.position.y };
      }
    }
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
      // Doc 105 (ronda 4, R10-C): sólo en la sesión y el canvas donde empezó —
      // los nodos vivos pueden ser ya los del draft que se abrió mientras ELK
      // calculaba (y un Save los grabaría) o los de otro canvas (tablas homónimas).
      if (!pin.holds() || get().activeSaId !== saId) return;
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
    // Posiciones nuevas (MERGEA, M3a) y trazos REINICIADOS en una sola
    // escritura del canvas: nunca quedan posiciones nuevas con trazos viejos.
    pin.check();
    await struct.arrangeSubjectArea(saId, pos);
    showRoutes(saId, () => ({}));
    pushUndo('Auto-arrange', async () => {
      await struct.arrangeSubjectArea(saId, prevLayout, prevRoutes);
      if (get().activeSaId !== saId) return;
      showRoutes(saId, () => prevRoutes);
      await get().reload();
    }, pin);
    await get().reload();
  },
  createTable: async (input: { logicalName: string; physicalName?: string; schema?: string; mode?: 'logical' | 'physical'; description?: string; udpValues?: Record<string, string> }) => {
    const saId = get().activeSaId; if (!saId) throw new Error('Pick a Subject Area');
    const pin = pinSession();   // doc 105 (H1)
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
    pin.check();
    await gov.createTable({
      id, logicalName: input.logicalName, physicalName: physical, schema,
      ...(description ? { description } : {}),
      ...(udpValues ? { udpValues } : {}),
    });
    // referenciar la nueva tabla en la Subject Area
    pin.check();
    await struct.addToCanvas(saId, { tableIds: [id] });
    await get().reload();
    if (!pin.holds()) return;   // doc 105 (R7-E): lo que sigue es de la sesión de la acción
    // La tabla nueva queda SELECCIONADA → sube al frente (zIndex) y no cae oculta
    // detrás de un bloque que ya estaba en el canvas (pedido owner).
    set({ selectedTableId: id, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });
    // Undo (doc 50): tabla recién creada — la cascada del delete es trivial.
    pushUndo(`Create table ${physical}`, () => get().deleteTable(id), pin);
  },
  addColumn: async (tableId: string, input: AddColumnInput) => {
    const dia = editableDiagram(); if (!dia) return;   // doc 105 (R7-A / ronda 4): el canvas de ESTA sesión
    const pin = pinSession();   // doc 105 (H1)
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
    const siblings = dia.columns.filter((c) => c.tableId === tableId);
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
    pin.check();
    if (shifts.length) await gov.recordChangesBulk([gov.bulk.createColumn(payload), ...shifts]);
    else await gov.createColumn(payload);
    // V1 (doc 19 §12b): la columna nueva entra AUTOMÁTICAMENTE a las vistas
    // ESPEJO de la tabla (las que reflejan TODAS sus columnas) — al final, o
    // tras las PK si es PK (doc 94 D4). Las vistas curadas (subset deliberado)
    // no se tocan. Best-effort: un fallo acá no bloquea el alta (queda "Match
    // physical order" para alinear).
    try {
      const touched = await syncNewColumnToMirrorViews(pinnedViewDeps(pin), tableId, physical, siblings, !!input.isPrimaryKey);
      if (touched && pin.holds()) toast.success(`Column also added to ${touched} mirror view(s)`);
    } catch { /* la vista se alinea después con "Match physical order" */ }
    // Doc 105 (ronda 3): si la sesión cambió mientras sincronizaba, lo que sigue ya no es de ésta.
    if (!pin.holds()) return;
    await get().reload();
    // Undo (doc 50): la inversa es el delete del store — limpia también las
    // vistas espejo y el panel de columna si quedó abierto sobre ella.
    pushUndo(`Add column ${physical}`, () => get().deleteColumn(id), pin);
  },
  updateRelationship: async (r) => {
    const dia = editableDiagram(); if (!dia) return;   // doc 105 (R7-A / ronda 4): el canvas de ESTA sesión
    const pin = pinSession();   // doc 105 (H1)
    get().markDirty();
    const pre0 = dia.relationships.find((x) => x.id === r.id);
    const pre = pre0 ? { ...pre0, pairs: pre0.pairs.map((p) => ({ ...p })) } : null;
    await gov.updateRelationship(r);
    if (pre) pushUndo('Edit relationship', async () => { await gov.updateRelationship(pre); await get().reload(); }, pin);
    await get().reload();
  },
  deleteRelationship: async (id) => {
    const dia = editableDiagram(); if (!dia) return;   // doc 105 (R7-A / ronda 4): el canvas de ESTA sesión
    const pin = pinSession();   // doc 105 (H1)
    get().markDirty();
    const rel = dia.relationships.find((r) => r.id === id);
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
        const col = dia.columns.find((c) => c.id === colId);
        if (!col?.isForeignKey) continue;
        // Slice server-side: sólo las relaciones que tocan la TABLA de la
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
    if (relPre) {
      pushUndo('Delete relationship', async () => {
        await gov.recordChangesBulk([
          ...fkClearedPre.map((c) => gov.bulk.createColumn(c)),
          gov.bulk.upsertRelationship(relPre),
        ]);
        await get().reload();
      }, pin);
    }
    await get().reload();
  },
  addExistingTables: async (tableIds: string[], opts) => {
    const saId = get().activeSaId; if (!saId || tableIds.length === 0) return;
    const dia = editableDiagram(); if (!dia) return;   // doc 105 (R7-A / ronda 4): el canvas de ESTA sesión
    const pin = pinSession();   // doc 105 (H1)
    get().markDirty();
    // Doc 70: la membresía de vistas parte de la lista MATERIALIZADA del
    // diagrama (un canvas legacy la recibe resuelta por el backend). Importar
    // una tabla NO arrastra sus vistas — sólo si el usuario lo pide.
    const shown = dia.subjectArea.viewIds;
    // Doc 105 (A5-o1): si las vistas no se pueden leer, las tablas entran igual
    // (es lo principal) pero se avisa — antes entraban sin sus vistas, callado.
    let viewsUnread = false;
    const withViews = opts?.withViews
      ? (await viewsSvc.listViewsForTables(tableIds).catch(() => { viewsUnread = true; return [] as View[]; })).map((v) => v.id)
      : [];
    // Doc 100: la lista completa la arma el servicio DENTRO de la cola del
    // canvas y devuelve lo REALMENTE agregado: la inversa del Undo no debe
    // sacar del canvas una tabla o vista que ya vivía acá.
    pin.check();
    const added = await struct.addToCanvas(saId, { tableIds, viewIds: withViews }, shown);
    await get().reload();
    if (!pin.holds()) return;   // doc 105 (R7-E): lo que sigue es de la sesión de la acción
    // Selecciona la primera importada → al frente (zIndex) y visible (owner).
    set({ selectedTableId: tableIds[0], selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });
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
      // La lista de vistas es la de ESTE canvas al importar: el Undo puede
      // correr con otro canvas abierto (la pila sobrevive al cambio de canvas).
      pushUndo(`Add ${what} to canvas`, async () => {
        await struct.removeFromCanvas(saId, added, shown);
        await get().reload();
      }, pin);
    }
  },
  addViewsToCanvas: async (viewIds) => {
    const saId = get().activeSaId; if (!saId || viewIds.length === 0) return;
    const dia = editableDiagram(); if (!dia) return;   // doc 105 (R7-A / ronda 4): el canvas de ESTA sesión
    const shown = dia.subjectArea.viewIds ?? [];
    if (viewIds.every((v) => shown.includes(v))) return;          // ya eran miembros
    const pin = pinSession();   // doc 105 (H1)
    get().markDirty();
    // Doc 100: la lista completa la arma el servicio dentro de la cola.
    const added = await struct.addToCanvas(saId, { viewIds }, shown);
    await get().reload();
    const n = added.viewIds.length;
    if (!n) return;
    pushUndo(`Add ${n} view${n === 1 ? '' : 's'} to canvas`, async () => {
      await struct.removeFromCanvas(saId, { viewIds: added.viewIds }, shown);
      await get().reload();
    }, pin);
  },
  removeViewFromCanvas: async (viewId) => {
    const saId = get().activeSaId; if (!saId) return;
    const dia = editableDiagram(); if (!dia) return;   // doc 105 (R7-A / ronda 4): el canvas de ESTA sesión
    const shown = dia.subjectArea.viewIds ?? [];
    if (!shown.includes(viewId)) return;
    const pin = pinSession();   // doc 105 (H1)
    get().markDirty();
    // Para el Undo (doc 50): nombre y posición ANTES de quitarla.
    const name = dia.views.find((v) => v.id === viewId)?.name ?? 'view';
    const node = get().flow?.getNode(viewId);
    const pos = node ? { x: Math.round(node.position.x), y: Math.round(node.position.y) } : null;
    const out = await struct.removeFromCanvas(saId, { viewIds: [viewId] }, shown);
    if (get().selectedViewId === viewId) set({ selectedViewId: null });
    await get().reload();
    // Doc 100: vuelve con su posición en UNA escritura (lista de vistas de ESTE
    // canvas, no la del que esté abierto al deshacer). Doc 112: y con su color
    // en este canvas (salió con ella).
    pushUndo(`Remove ${name} from canvas`, async () => {
      await struct.addToCanvas(saId, {
        viewIds: [viewId], ...(pos ? { layout: { [viewId]: pos } } : {}), colors: out.colors,
      }, shown);
      await get().reload();
    }, pin);
  },
  deleteView: async (view, opts) => {
    const pin = pinSession();   // doc 105 (H1)
    const askedCs = useSessionStore.getState().activeChangesetId;
    const saId = get().activeSaId;
    const onActive = !!saId && !!liveDiagram()?.views.some((v) => v.id === view.id);
    // Pre-imagen POR VALOR (doc 50): el doc completo, sin `canvases` (la fila
    // del panel o del inspector no es parte del doc).
    const pre = JSON.parse(JSON.stringify(view)) as View & { canvases?: unknown };
    delete pre.canvases;
    // Dónde está ANTES de borrarla: el backend la saca de cada canvas que la
    // lista, con su posición, en el mismo request (doc 88 §4). Si no se puede
    // leer, no se borra (el Undo quedaría incompleto).
    let placed: Map<string, ListedViews>;
    try {
      const src = view.sourceTableIds?.[0] ?? view.tableId;
      const canvasIds = opts?.canvasIds ?? (src
        ? ((await viewsSvc.tableViews(src)).views.find((v) => v.id === view.id)?.canvases ?? []).map((c) => c.id)
        : []);
      placed = await listedViewsBy([...canvasIds, ...(onActive && saId ? [saId] : [])], [view.id]);
    } catch (e) {
      throw await readFailure(e, askedCs, pin, () => new Error(VIEW_USAGE_UNREADABLE));   // ídem deleteTable
    }
    pin.check();
    get().markDirty();
    await viewsSvc.deleteView(view.id);
    if (get().selectedViewId === view.id) set({ selectedViewId: null });
    pushUndo(`Delete view ${pre.name}`, async (undo) => {
      await viewsSvc.updateView(pre.id, pre as ViewInput);
      // Doc 100 (P5): cada canvas la vuelve a listar DENTRO de su cola, en UNA
      // escritura con su posición. Un canvas sin lista explícita (legacy) no se
      // toca: su regla por fuentes la vuelve a mostrar (y conserva su sitio).
      // Doc 105 (H1): sólo mientras siga la sesión del Undo.
      for (const [canvasId, listed] of placed) {
        undo.check();
        try {
          await struct.addToCanvas(canvasId, {
            viewIds: listed.viewIds, ...(Object.keys(listed.layout).length ? { layout: listed.layout } : {}),
            colors: listed.colors,   // doc 112: la cascada se llevó también su color en el canvas
          });
        } catch { /* el canvas pudo desaparecer */ }
      }
      await get().reload();
      // Doc 89 §3.6: si no volvió al canvas activo, el Explorer se refresca a mano.
      get().syncExplorer(!!get().diagram?.views.some((v) => v.id === pre.id));
    }, pin);
  },
  createTableFromSources: ({ logicalName, schema, columns }) => runBlocking('Creating table…', async () => {
    const saId = get().activeSaId; if (!saId) throw new Error('Pick a Subject Area');
    const pin = pinSession();   // doc 105 (H1)
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
        // Procedencia (doc 51): "Created from source <tabla>.<col> (CTAS)".
        }, { kind: 'ctas', ...(c.sourceTable ? { sourceTable: c.sourceTable } : {}), sourceColumn: c.physicalName });
      }),
    ]);
    pin.check();
    await struct.addToCanvas(saId, { tableIds: [id] });
    await get().reload();
    if (!pin.holds()) return;   // doc 105 (R7-E): no selecciona en otra sesión
    set({ selectedTableId: id, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null });   // al frente + visible (owner)
    pushUndo(`Create table ${physical}`, () => get().deleteTable(id), pin);
  }),
  setColumnTarget: (id: string | null) => set({ columnTarget: id }),
  // Seleccionar tabla o edge cambia de contexto: cierra el panel de columna.
  setSelectedTable: (id) => set({ selectedTableId: id, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null }),
  setSelectedEdge: (id) => set({ selectedEdgeId: id, selectedTableId: null, selectedColumnId: null, selectedViewId: null }),
  removeTableFromArea: async (tableId) => {
    get().markDirty();
    const saId = get().activeSaId; if (!saId) return;
    const d = editableDiagram(); if (!d) return;   // doc 105 (R7-A / ronda 4): el canvas de ESTA sesión
    const pin = pinSession();   // doc 105 (H1)
    // Para el Undo (doc 50): nombre y posición ANTES de quitarla (el remove
    // también borra su entrada del layout).
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
    const out = await struct.removeFromCanvas(saId, {
      tableIds: [tableId], viewIds: orphans, ...(Object.keys(droppedRoutes).length ? { dropRouteIds: wireIds } : {}),
    }, shown);
    // Doc 100: la inversa es UNA escritura (antes hasta 4: tablas, vistas,
    // posiciones y trazos, cada una leyendo el canvas por su cuenta). Las vistas
    // son las de ESTE canvas al sacar la tabla (el Undo puede correr con otro
    // canvas abierto) y sólo cuentan si salieron huérfanas: sin ellas, un canvas
    // sin lista explícita (doc 70) sigue sin lista.
    // Doc 112: y su color en este canvas (y el de sus vistas huérfanas) vuelve con ella.
    // Las posiciones, las de pantalla; si no hay nodo (en lógico las vistas no lo
    // son, doc 63), las del canvas grabado que devolvió el servicio.
    pushUndo(`Remove ${name} from canvas`, async () => {
      const layout = { ...out.layout, ...(pos ? { [tableId]: pos } : {}), ...orphanPos } as Record<string, { x: number; y: number }>;
      await struct.addToCanvas(saId, { tableIds: [tableId], viewIds: orphans, layout, routes: droppedRoutes, colors: out.colors },
        orphans.length ? shown : undefined);
      await get().reload();
    }, pin);
    if (get().selectedTableId === tableId) set({ selectedTableId: null, selectedColumnId: null, selectedViewId: null });
    await get().reload();
  },
  deleteTable: (tableId, opts) => runBlocking('Deleting table…', async () => {
    // Cascada COMPLETA en el changeset (versionada), grabada EN LOTE (doc 39):
    // el camino cambio-por-cambio eran ~1 request por columna — a 4k columnas
    // (tablas DDV reales) el borrado tomaba minutos. Las LECTURAS van primero
    // (estado pre-borrado, como el loop viejo: ninguna afecta a las otras),
    // luego UN bulk con vistas + relaciones + columnas, y la tabla AL FINAL
    // fuera del lote — mismo orden observable: si algo se interrumpe, la tabla
    // sigue viva y repetir el delete converge. Un solo reload al terminar.
    // Doc 105 (A3/A5): TODAS las lecturas tienen que llegar — antes cada una
    // caía a `[]` y la tabla se borraba igual, dejando vistas y relaciones
    // huérfanas en el draft. Si alguna falla, no se borra nada.
    // Doc 105 (H1): todo es de la sesión donde empezó el borrado — también
    // como inversa de «Create table» o «Paste table»; cada escritura lo verifica.
    const pin = pinSession();
    const askedCs = useSessionStore.getState().activeChangesetId;
    const noun = facetNouns(get().viewMode).one;
    let views: View[], rels: gov.Relationship[], cols: CanonicalColumn[], usage: gov.TableUsageRow[];
    let viewCanvasIds: string[];
    let viewsBack: Map<string, ListedViews>;
    const fkClearedPre: CanonicalColumn[] = [];
    try {
      // vistas que la usan (cualquier fuente: tableId o sourceTableIds)
      const viewsRead = viewsSvc.listViews(tableId);
      [views, rels, cols, usage, viewCanvasIds] = await Promise.all([
        viewsRead,
        // relaciones donde es extremo (globales)
        gov.listRelationships(tableId),
        gov.listColumns(tableId),
        // canvases que la contienen
        gov.tableUsage(tableId).then((u) => u.usage),
        // Doc 105 (H2): y los de sus vistas (una multi-fuente puede estar en un
        // canvas SIN esta tabla).
        viewsRead.then((vs) => (vs.length ? canvasesOfViews(tableId, vs.map((v) => v.id)) : [])),
      ]);
      // Doc 105 (F4, doc 100 P8): el lote de abajo saca cada vista borrada de
      // todo canvas que la lista (cascada del backend, doc 88 §4): ANTES se
      // anota qué lista cada canvas y dónde, para que el Undo las reponga.
      viewsBack = await listedViewsBy([...usage.map((u) => u.canvasId), ...viewCanvasIds], views.map((v) => v.id));
      // Doc 105 (ronda 3): FK huérfano en columnas HIJA de la OTRA tabla (misma
      // regla conservadora que deleteRelationship: si ya no participan en
      // ninguna relación). Se decide AHORA, descontando las relaciones que este
      // borrado se lleva — antes se leía después del lote con `.catch(() => [])`:
      // una caída apagaba el FK de una hija que seguía en otra relación.
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
      throw await readFailure(e, askedCs, pin, () => dependentsUnreadable(noun));
    }
    pin.check();
    get().markDirty();
    // Pre-imágenes para el Undo (doc 50): las lecturas de arriba YA traen el
    // estado pre-borrado — se congelan por valor antes de tocar nada.
    // Doc 89: sin canvas (inspector) la pre-imagen viene del dossier efectivo.
    const t0 = liveDiagram()?.tables.find((x) => x.id === tableId) ?? opts?.pre;
    const tPre = t0 ? { ...t0, ...(t0.udpValues ? { udpValues: { ...t0.udpValues } } : {}) } : null;
    const undoSaId = get().activeSaId;
    const undoNode = get().flow?.getNode(tableId);
    const undoPos = undoNode ? { x: Math.round(undoNode.position.x), y: Math.round(undoNode.position.y) } : null;
    const colsPre = cols.map((c) => ({ ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) }));
    const relsPre = rels.map((r) => ({ ...r, pairs: r.pairs.map((p) => ({ ...p })) }));
    const viewsPre = views.map((v) => JSON.parse(JSON.stringify(v)) as View);
    await gov.recordChangesBulk([
      ...views.map((v) => gov.bulk.deleteView(v.id)),
      ...rels.map((r) => gov.bulk.deleteRelationship(r.id)),
      ...cols.map((c) => gov.bulk.deleteColumn(c.id)),
    ]);
    // FK huérfano en columnas HIJA sobrevivientes (decidido arriba, antes del lote).
    for (const c of fkClearedPre) {
      pin.check();
      await gov.updateColumn({ ...c, isForeignKey: false });
    }
    // Sacar de TODOS los canvases que la contienen (tableIds + layout). Doc 99:
    // y con ella los trazos manuales de sus wires (las relaciones de arriba se
    // borran; sus trazos quedarían huérfanos en cada canvas). Doc 105 (F4): y
    // sus vistas, si el backend no las sacó ya; cada canvas dice qué salió.
    const wireIds = wireIdsOfTable(rels, tableId);
    const droppedRoutes = routesOf(get().canvasRoutes, wireIds);   // del canvas ACTIVO, para el Undo
    const viewIdsOut = views.map((v) => v.id);
    const removed = new Map<string, struct.CanvasMembersOut>();
    // Doc 105 (H2): los canvases de la tabla y, además, los que sólo listaban
    // alguna de sus vistas (multi-fuente): de ésos salen sólo las vistas.
    const tableCanvases = new Set(usage.map((u) => u.canvasId));
    const canvasIds = [...tableCanvases, ...[...viewsBack.keys()].filter((id) => !tableCanvases.has(id))];
    for (const canvasId of canvasIds) {
      pin.check();
      const withTable = tableCanvases.has(canvasId);
      removed.set(canvasId, await struct.removeFromCanvas(canvasId, {
        ...(withTable ? { tableIds: [tableId] } : {}),
        ...(viewIdsOut.length ? { viewIds: viewIdsOut } : {}),
        ...(withTable && wireIds.length ? { dropRouteIds: wireIds } : {}),
      }));
    }
    // La tabla.
    pin.check();
    await gov.deleteTable(tableId);
    // Undo (doc 50): UN lote restaura tabla + columnas + FKs limpiadas +
    // relaciones + vistas (el guard N=N resuelve la llave con las columnas del
    // mismo lote), y después las membresías de canvas.
    if (tPre) {
      pushUndo(`Delete table ${tPre.physicalName}`, async (undo) => {
        await gov.recordChangesBulk([
          gov.bulk.createTable(tPre),
          ...colsPre.map((c) => gov.bulk.createColumn(c)),
          ...fkClearedPre.map((c) => gov.bulk.createColumn(c)),
          ...relsPre.map((r) => gov.bulk.upsertRelationship(r)),
          ...viewsPre.map((v) => gov.bulk.upsertView(v)),
        ]);
        // Doc 100: una escritura por canvas, dentro de su cola. Doc 105 (F4):
        // la tabla vuelve a SU posición en cada canvas (en el activo, a la de
        // pantalla) y las vistas que ese canvas listaba, a la suya; un canvas
        // sin lista explícita (legacy) sigue sin lista. Los trazos (doc 99)
        // sólo vuelven al canvas activo. Doc 105 (H1): mientras siga la sesión
        // del Undo — si se abrió otra versión, lo que falta no va a ella.
        // Doc 105 (H2): un canvas que sólo listaba sus vistas recupera ésas,
        // no la tabla (nunca la tuvo).
        for (const canvasId of canvasIds) {
          undo.check();
          const withTable = tableCanvases.has(canvasId);
          const active = withTable && canvasId === undoSaId;
          const out = removed.get(canvasId);
          const back = viewsBack.get(canvasId);
          const viewIds = [...new Set([...(back?.viewIds ?? []), ...(out?.viewIds ?? [])])];
          const layout = {
            ...(out?.layout ?? {}), ...(back?.layout ?? {}),
            ...(active && undoPos ? { [tableId]: undoPos } : {}),
          };
          // Doc 112: el color de cada caja en ESE canvas vuelve con ella.
          const colors = { ...(out?.colors ?? {}), ...(back?.colors ?? {}) };
          try {
            await struct.addToCanvas(canvasId, {
              ...(withTable ? { tableIds: [tableId] } : {}),
              ...(viewIds.length ? { viewIds } : {}),
              ...(Object.keys(layout).length ? { layout } : {}),
              ...(active ? { routes: droppedRoutes } : {}),
              colors,
            });
          } catch { /* el canvas pudo desaparecer */ }
        }
        await get().reload();
        get().syncExplorer(canvasIds.includes(get().activeSaId ?? ''));
      }, pin);
    }
    if (get().selectedTableId === tableId) set({ selectedTableId: null, selectedColumnId: null, selectedViewId: null });
    await get().reload();
    // Doc 89 §3.6: si la tabla NO estaba en el canvas activo (o no hay canvas —
    // borrado desde el Object Inspector), reload() no cambia ninguna firma → el
    // Explorer se refresca a mano. Regla complementaria a la del doc 88 §2.
    // Doc 105 (H2): un canvas que listaba sus vistas también cambió de firma.
    get().syncExplorer(canvasIds.includes(get().activeSaId ?? ''));
  }),
  updateTable: async (id, fields) => {
    get().markDirty();
    const t = editableDiagram()?.tables.find((x) => x.id === id);   // doc 105 (R7-A / ronda 4)
    if (!t) return;
    await gov.createTable({ ...t, ...fields }); // upsert por id = update
    await get().reload();
  },
  updateColumn: async (colId, fields) => {
    const dia = editableDiagram();   // doc 105 (R7-A / ronda 4): el canvas de ESTA sesión
    const c = dia?.columns.find((x) => x.id === colId);
    if (!dia || !c) return;
    const pin = pinSession();   // doc 105 (H1)
    get().markDirty();
    // Doc 94 D2: entrar o salir de la llave re-ubica la columna en la frontera
    // del bloque de PK — ella y las que se corren viajan en UN lote, con UN Undo.
    if (fields.isPrimaryKey !== undefined && !!fields.isPrimaryKey !== !!c.isPrimaryKey) {
      const mine = dia.columns.filter((x) => x.tableId === c.tableId);
      const { changes, pres } = keyLayoutBulk(mine, { [colId]: fields });
      await gov.recordChangesBulk(changes);
      pushUndo(`Edit column ${c.physicalName}`, async () => {
        await gov.recordChangesBulk(pres.map((p) => gov.bulk.createColumn(p)));
        await get().reload();
      }, pin);
      await get().reload();
      return;
    }
    // Pre-imagen POR VALOR para el Undo (doc 50).
    const pre = { ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) };
    await gov.updateColumn({ ...c, ...fields }); // upsert por id = update (merge)
    pushUndo(`Edit column ${pre.physicalName}`, async (undo) => {
      await gov.updateColumn(pre);
      // Si el cambio renombró el FÍSICO, las vistas quedaron re-apuntadas al
      // nombre nuevo (sync del panel): deshacer las devuelve al viejo. Doc 105
      // (H1): sólo mientras siga la sesión del Undo.
      if (typeof fields.physicalName === 'string' && fields.physicalName !== pre.physicalName) {
        const renamedTo = fields.physicalName;
        await bestEffort(() => syncRenamedColumnInViews(pinnedViewDeps(undo), pre.tableId, renamedTo, pre.physicalName));
      }
      await get().reload();
    }, pin);
    await get().reload();
  },
  reorderColumns: async (tableId, orderedIds) => {
    const dia = editableDiagram(); if (!dia) return;   // doc 105 (R7-A / ronda 4)
    const pin = pinSession();   // doc 105 (H1): tandas de escrituras
    const onCanvas = dia.columns.filter((c) => c.tableId === tableId);
    // Doc 105 (ronda 5, R15-H1): la tabla no está en el canvas en pantalla (un
    // drop que terminó con otro canvas abierto): el orden se arma con sus
    // columnas VIGENTES del modelo — antes se perdía.
    const mine = onCanvas.length ? onCanvas : await gov.listColumns(tableId);
    pin.check();   // ronda 6 (R17a-10): si mientras leía cambió la sesión, nada se marca en la nueva
    // Doc 94 D3: una PK nunca queda debajo de una no-PK (guard final: los
    // paneles ya lo impiden al arrastrar).
    if (!isPkFirst(mine, orderedIds)) {
      toast.error("A primary key column can't go below a column that isn't part of the key.");
      return;
    }
    get().markDirty();
    // OPTIMISTA: la UI reordena al soltar (posición = índice nuevo, local); la
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
    // Persistí SOLO las columnas cuya posición cambió, en TANDAS de 5: mover una
    // columna al tope de una tabla de 30 disparaba 30 PUT simultáneos (ráfaga
    // que con varios usuarios satura el backend). El backend graba cada
    // cambio con $set atómico por entidad, así que no se pisan entre sí.
    const changed = reorderPlan(mine, orderedIds);
    // Ronda 5 (R15-H1): el upsert es del documento COMPLETO — cada columna con
    // su documento VIGENTE (otra edición pudo recargar el diagrama mientras se
    // esperaba), nunca uno capturado antes: pisaría esa edición.
    const reads: ColumnReads = new Map();   // ronda 7 (R18a-2): una lectura por tabla y tanda
    await persistReorder(changed, async (c, idx) => {
      const cur = await currentColumn(c, reads);   // ronda 6 (R17a-2): borrada mientras tanto → no se revive
      if (!cur) return;
      pin.check();
      await gov.updateColumn({ ...cur, ordinal: idx });
    });
    if (changed.length) {
      // Undo POR VALOR (doc 50): las pre-imágenes de las columnas movidas
      // vuelven a su ordinal tal cual, SIN pasar por la guarda «PK primero» —
      // el estado previo pudo ser un dato viejo desordenado, o la llave pudo
      // cambiar en el medio (drop en el canvas: llave + reorden).
      const pres = sortByOrdinal(changed.map(({ c }) => ({ ...c })));
      pushUndo('Reorder columns', async (undo) => {
        // Sólo el orden vuelve atrás: sobre el documento vigente (ronda 5).
        const undoReads: ColumnReads = new Map();
        await persistReorder(pres.map((c) => ({ c, idx: c.ordinal })), async (c, idx) => {
          const cur = await currentColumn(c, undoReads);
          if (!cur) return;
          undo.check();
          await gov.updateColumn({ ...cur, ordinal: idx });
        });
        await get().reload();
      }, pin);
    }
    await get().reload();
  },
  applyCanvasDrop: async (tableId, plan) => {
    // Doc 73 §10.4 — drop de una fila en el bloque: los cambios de LLAVE van
    // por el mismo camino que el panel (gov.updateColumn + Undo por valor,
    // doc 50) y después el reorden de columnas (reorderColumns).
    const dia = editableDiagram(); if (!dia) return;   // doc 105 (R7-A / ronda 4)
    const pin = pinSession();   // doc 105 (H1)
    if (plan.key.length) {
      get().markDirty();
      const pres: CanonicalColumn[] = [];
      const flags = new Map(plan.key.map((k) => [k.id, k.isPrimaryKey]));
      const reads: ColumnReads = new Map();   // ronda 7 (R18a-2)
      for (const step of plan.key) {
        const captured = dia.columns.find((c) => c.id === step.id);
        if (!captured) continue;
        // Ronda 5 (R15-H1): el documento VIGENTE — tras la primera escritura,
        // otra edición pudo recargar el diagrama. Ronda 6 (R17a-2): o nada, si
        // se borró mientras tanto.
        const col = await currentColumn(captured, reads);
        if (!col) continue;
        pres.push({ ...col });
        pin.check();
        await gov.updateColumn({ ...col, isPrimaryKey: step.isPrimaryKey });
      }
      // Doc 105 (ronda 4, R10-D): si mientras escribía se abrió otra versión,
      // el set de abajo reinstalaría en pantalla el diagrama de ésta (y el
      // refresco ya reabrió el de la nueva): la acción termina acá.
      if (!pin.holds()) return;
      // OPTIMISTA (doc 94): la llave nueva ya en el diagrama local, así el
      // reorden de abajo valida «PK primero» contra ella. Ronda 5 (R15-H1):
      // sobre el diagrama VIGENTE — el capturado al empezar reinstalaba lo de
      // antes de otra edición que recargó mientras se grababa, o el canvas A
      // bajo el B que se abrió (y un arrastre grababa sus bloques en B). Si el
      // abierto es otro, sólo cambia si también tiene esta tabla.
      const cur = get().diagram;
      if (cur) set({ diagram: { ...cur, columns: cur.columns.map((c) => (flags.has(c.id) ? { ...c, isPrimaryKey: flags.get(c.id) } : c)) } });
      if (pres.length) {
        pushUndo('Edit key', async (undo) => {
          for (const c of pres) { undo.check(); await gov.updateColumn(c); }
          await get().reload();
        }, pin);
      }
      if (!plan.order) await get().reload();
    }
    if (plan.order) { pin.check(); await get().reorderColumns(tableId, plan.order); }
  },
  deleteColumn: async (colId, relIds = [], opts) => {
    // Doc 105 (H1): de la sesión donde empezó — también como inversa de «Add column».
    const pin = pinSession();
    const askedCs = useSessionStore.getState().activeChangesetId;
    const noun = facetNouns(get().viewMode).member;
    // Primero las relaciones (elegidas en el dialog de impacto), después la
    // columna: el changeset nunca queda con pares colgando de una columna
    // borrada (spec 10 §8). v2 (doc 19): si la relación tiene MÁS pares, sólo
    // se quita el par de esta columna; si era el último, se borra completa.
    const col = liveDiagram()?.columns.find((c) => c.id === colId) ?? opts?.col;
    // Doc 105 (ronda 3): TODAS las lecturas antes de la primera escritura — si
    // alguna falla no se escribe nada (antes las relaciones de la hija se leían
    // DESPUÉS de borrar las elegidas: una caída dejaba relaciones borradas con
    // la columna viva y sin Undo). La FK huérfana se decide con lo leído AHORA,
    // descontando lo que este borrado le hace a cada relación elegida.
    let pool: gov.Relationship[];
    let viewsPre: View[];
    const fkClearedPre: CanonicalColumn[] = [];
    /** Pares con que queda cada relación elegida (vacío = se borra entera). */
    const after = new Map<string, gov.RelationshipPair[]>();
    try {
      let views: View[];
      [pool, views] = await Promise.all([
        relIds.length && col ? gov.listRelationships(col.tableId) : Promise.resolve([] as gov.Relationship[]),
        col ? viewsSvc.listViews(col.tableId) : Promise.resolve([] as View[]),
      ]);
      // Pre-imágenes para el Undo (doc 50): vistas que referencian la columna.
      viewsPre = col
        ? views.filter((v) => removeColumnSource(v, col.tableId, col.physicalName) != null)
          .map((v) => JSON.parse(JSON.stringify(v)) as View)
        : [];
      // Columnas HIJAS del otro extremo de los pares afectados: al caer el
      // par/relación pueden quedar con un isForeignKey huérfano (misma limpieza
      // conservadora que deleteRelationship — isPrimaryKey nunca se toca).
      const fkCandidates = new Map<string, string>();   // childColumnId → childTableId
      for (const rid of relIds) {
        const rel = pool.find((r) => r.id === rid);
        const dropped = rel?.pairs.filter((p) => p.parentColumnId === colId || p.childColumnId === colId) ?? [];
        const remaining = rel?.pairs.filter((p) => p.parentColumnId !== colId && p.childColumnId !== colId) ?? [];
        dropped.forEach((p) => { if (p.childColumnId !== colId && rel) fkCandidates.set(p.childColumnId, rel.childTableId); });
        after.set(rid, rel && remaining.length > 0 && remaining.length < rel.pairs.length ? remaining : []);
      }
      for (const [cid, ctid] of fkCandidates) {
        // Doc 89: la hija puede no estar en el diagrama (inspector sin canvas u
        // otra tabla fuera de este canvas) → se resuelve por API, como deleteTable.
        const [c, near] = await Promise.all([
          liveDiagram()?.columns.find((x) => x.id === cid) ?? gov.listColumns(ctid).then((cs) => cs.find((x) => x.id === cid)),
          gov.listRelationships(ctid),
        ]);
        if (!c?.isForeignKey) continue;
        const still = near.some((r) => (after.get(r.id) ?? r.pairs).some((p) => p.childColumnId === cid));
        if (!still) fkClearedPre.push({ ...c });
      }
    } catch (e) {
      throw await readFailure(e, askedCs, pin, () => dependentsUnreadable(noun));
    }
    pin.check();
    get().markDirty();
    // Pre-imágenes para el Undo (doc 50): columna y relaciones afectadas (por valor).
    const colPre = col ? { ...col, ...(col.udpValues ? { udpValues: { ...col.udpValues } } : {}) } : null;
    const relsPre = pool.filter((r) => relIds.includes(r.id))
      .map((r) => ({ ...r, pairs: r.pairs.map((p) => ({ ...p })) }));
    for (const rid of relIds) {
      const rel = pool.find((r) => r.id === rid);
      const remaining = after.get(rid) ?? [];
      pin.check();
      if (rel && remaining.length) {
        await gov.updateRelationship({ ...rel, pairs: remaining });
      } else {
        await gov.deleteRelationship(rid);
      }
    }
    for (const c of fkClearedPre) {
      pin.check();
      await gov.updateColumn({ ...c, isForeignKey: false });
    }
    pin.check();
    await gov.deleteColumn(colId);
    // Undo (doc 50): UN lote restaura columna + FKs limpiadas + relaciones
    // (la columna va PRIMERO — el guard N=N del backend resuelve la llave del
    // padre con las columnas del MISMO lote); las vistas capturadas vuelven a
    // su doc previo (best-effort).
    if (colPre) {
      pushUndo(`Delete column ${colPre.physicalName}`, async (undo) => {
        await gov.recordChangesBulk([
          gov.bulk.createColumn(colPre),
          ...fkClearedPre.map((c) => gov.bulk.createColumn(c)),
          ...relsPre.map((r) => gov.bulk.upsertRelationship(r)),
        ]);
        for (const v of viewsPre) {
          undo.check();   // doc 105 (H1)
          try { await viewsSvc.updateView(v.id, v); } catch { /* best-effort */ }
        }
        await get().reload();
        get().syncExplorer(!!get().diagram?.tables.some((t) => t.id === colPre.tableId));
      }, pin);
    }
    // Si la columna borrada tenía su Properties abierto (doc 49), se cierra —
    // el sidebar vuelve al Properties de la tabla.
    if (get().selectedColumnId === colId) set({ selectedColumnId: null, selectedViewId: null });
    // La columna eliminada sale de los sources de TODA vista que la
    // referenciaba (espejo o curada) — best-effort, no bloquea el borrado.
    if (col) {
      try {
        const n = await syncRemovedColumnFromViews(pinnedViewDeps(pin), col.tableId, col.physicalName);
        if (n && pin.holds()) toast.success(`Column also removed from ${n} view(s)`);
      } catch { /* la vista se corrige a mano o con "Ordenar como la tabla" */ }
    }
    // Doc 105 (ronda 3): si la sesión cambió mientras sincronizaba, lo que sigue ya no es de ésta.
    if (!pin.holds()) return;
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
    const { isCurrent, pin } = explorerRequest();   // doc 105 (H4b): ídem createCanvas
    const sa = await struct.createSubjectArea(pid, name);
    await get()._refreshProject(pid, isCurrent);
    if (!pin.holds()) return;
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

// ── Doc 105 (ronda 3, R7-A): el diagrama, sellado con su sesión ────────────
// Cada carga sella el diagrama con el pin de la sesión en que se pidió (las
// copias `{ ...diagram }` lo conservan). Al cambiar de sesión el store lo
// limpia en el acto; como DEFENSA, las acciones que escriben leen el diagrama
// por `liveDiagram()`: uno de otra sesión (reinstalado por error, p. ej. un set
// optimista tardío) no sirve para armar escrituras.
const DIAGRAM_PIN: unique symbol = Symbol('diagramSession');
type SealedDiagram = Diagram & { [DIAGRAM_PIN]?: SessionPin };

function sealDiagram(d: Diagram, pin: SessionPin): Diagram {
  (d as SealedDiagram)[DIAGRAM_PIN] = pin;
  return d;
}

/** El diagrama abierto si es de la sesión de AHORA (sin sello — armado a mano,
 *  p. ej. en tests — cuenta como vigente); si no, null. */
function liveDiagram(): Diagram | null {
  const d = useModelerStore.getState().diagram;
  const pin = d ? (d as SealedDiagram)[DIAGRAM_PIN] : undefined;
  return d && (!pin || pin.holds()) ? d : null;
}

/** Doc 105 (ronda 5, R15-H1): los ids con posición en el layout de un canvas
 *  — tablas, vistas y símbolos de subcategoría (doc 53: los de sus relaciones
 *  `subcategory`, como `isSubcategory`). */
function canvasNodeIds(d: Diagram): Set<string> {
  return new Set([
    ...d.tables.map((t) => t.id), ...d.views.map((v) => v.id),
    ...(d.subjectArea.tableIds ?? []), ...(d.subjectArea.viewIds ?? []),
    ...d.relationships.filter((r) => r.subcategory && r.subtypeSymbolId).map((r) => r.subtypeSymbolId as string),
  ]);
}

/** Doc 105 (ronda 7, R18a-2): las lecturas de columnas de UNA acción, por
 *  tabla. Cada entrada vive mientras su lectura está en vuelo: las columnas de
 *  una tanda (que la piden juntas) comparten UNA lectura, y la tanda siguiente
 *  relee — lo que cambió entre tandas (p. ej. una columna borrada) se ve. */
type ColumnReads = Map<string, Promise<CanonicalColumn[]>>;

/** Doc 105 (ronda 5, R15-H1): el documento VIGENTE de una columna para
 *  re-grabarlo (el upsert es del documento COMPLETO): el del diagrama en
 *  pantalla — otra edición pudo recargarlo mientras se esperaba —; si no está
 *  (otro canvas), el que se tenía. */
async function currentColumn(c: CanonicalColumn, reads: ColumnReads): Promise<CanonicalColumn | null> {
  // Ronda 6 (R17a-2): «la que se tenía» revivía una columna BORRADA mientras
  // se esperaba (el upsert la re-creaba). Con su tabla en el canvas en pantalla,
  // lo que hay ahí — y si ya no está, se borró: null (no se escribe). Con la
  // tabla fuera, se relee del servidor: ronda 7 (R18a-2), una vez por tabla y
  // tanda — antes, la tabla COMPLETA por cada columna (N lecturas de N docs).
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

/** Doc 105 (ronda 4, R10-B): la recarga pedida mientras se abría el mismo
 *  canvas. `reload()` avisa al Explorer si el cambio es estructural respecto de
 *  lo que abrió la apertura; si la apertura ya trajo lo nuevo, se compara con lo
 *  que había cuando se pidió (`prev`) — un solo aviso. */
async function reloadAfterOpening(prev: Diagram | null, quiet = false): Promise<void> {
  const st = useModelerStore.getState;
  const opened = st().diagram;
  _quietReloadFailure = quiet;   // ronda 7 (R18a-6): la consume esta `reload()` al empezar
  await st().reload();
  const now = st().diagram;
  if (prev && opened && now && prev.subjectArea.id === now.subjectArea.id
      && diagramSignature(opened) === diagramSignature(now) && diagramSignature(prev) !== diagramSignature(now)) {
    st().bumpExplorer();
  }
}

/** Doc 105 (ronda 4, R10-D): el diagrama en pantalla es de una sesión que ya
 *  no está abierta (no debería pasar: lo reinstaló un set tardío). */
class StaleCanvasError extends Error {
  constructor() {
    super('This canvas is from a version that is no longer open — open it again from the explorer.');
    this.name = 'StaleCanvasError';
  }
}

/** El diagrama en pantalla para EDITARLO: `null` si no hay (nada que editar:
 *  se calla); si es de otra sesión, `StaleCanvasError` — se avisa en vez de
 *  callar, y Save no pasa por un guardado exitoso. */
function editableDiagram(): Diagram | null {
  const d = useModelerStore.getState().diagram;
  if (d && !liveDiagram()) throw new StaleCanvasError();
  return d;
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
  return { ...diagram, subjectArea: { ...sa, layout: { ...(sa.layout ?? {}), ...fresh.layout }, routes: fresh.routes,
                                      colors: fresh.colors } };
}

/** Doc 109: cambia los colores EN PANTALLA del canvas `saId` (no hace nada si
 *  hay otro abierto, u otra versión) y deja el canvas del diagrama al día EN
 *  SITIO, como `showRoutes`. `patch`: null quita la excepción. */
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

/** Doc 109: guardado EN VUELO del color de una caja (como `RouteTicket`):
 *  `ref` = lo pedido (null = sin excepción); `base` = lo último GRABADO, a lo
 *  que vuelve la pantalla si falla (`undefined` = no se sabe: su canvas no
 *  estaba abierto al pedirlo). */
interface ColorTicket { ref: string | null; base: string | null | undefined }

/** Colores en vuelo, por versión + canvas y por caja: un diagrama que llega
 *  mientras tanto puede traer todavía el color viejo — manda el pendiente (sólo
 *  en SU versión: otra que abre el mismo canvas no lo hereda). Cada entrada es
 *  la ficha del ÚLTIMO guardado pedido para esa caja. */
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

/** Doc 109: pinta y graba colores del canvas. Si el guardado falla, las cajas
 *  vuelven a lo último grabado (un pedido más nuevo de la misma caja gana) y
 *  se re-lanza. Con otro canvas abierto graba igual, sin tocar la pantalla. */
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

/** Doc 109 (revisión): escrituras del documento de UNA tabla o vista, en fila.
 *  Cada una arma su payload al ejecutarse desde el documento VIGENTE de la
 *  working copy (`gov.currentTable`/`viewsSvc.currentView`), no del diagrama:
 *  el guardado de la definición al salir del campo y el color elegido enseguida
 *  ya no se pisan, aunque una recarga falle o quede reemplazada. */
const _objectWrites = new Map<string, Promise<unknown>>();
/** Doc 109 (revisión): inversa de una escritura de UNA tabla o vista que
 *  restaura SÓLO los campos que esa escritura cambió (`fields` = sus valores
 *  de antes), sobre el documento VIGENTE y en la fila del objeto. Con la foto
 *  completa, deshacer revertía también lo que otra escritura (el color, la
 *  definición) grabó después. */
export function undoFields(kind: 'table' | 'view', id: string, fields: Record<string, unknown>,
  pin: SessionPin, reload: () => Promise<void>): () => Promise<void> {
  return async () => {
    await inObjectOrder(id, async () => {
      const cur = kind === 'table' ? await gov.currentTable(id) : await viewsSvc.currentView(id);
      pin.check();
      if (!cur) throw new Error(`This ${kind} is no longer in the working copy.`);
      if (kind === 'table') await gov.createTable({ ...(cur as CanonicalTable), ...fields });
      else await viewsSvc.updateView(id, { ...(cur as View), ...fields } as ViewInput);
    });
    await reload();
  };
}

export function inObjectOrder<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const run = (_objectWrites.get(id) ?? Promise.resolve()).then(fn, fn);
  const tail = run.then(() => undefined, () => undefined);
  _objectWrites.set(id, tail);
  void tail.then(() => { if (_objectWrites.get(id) === tail) _objectWrites.delete(id); });
  return run;
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

// Doc 112: la ficha de un canvas (Model properties) se cierra si se abre otro
// canvas (o ninguno) — por el buscador, el Explorer o al borrarlo.
useModelerStore.subscribe((s, prev) => {
  if (s.modelProps && s.activeSaId !== prev.activeSaId) useModelerStore.setState({ modelProps: null });
});

// Doc 109: los colores del canvas se siembran igual — cada vez que cambia el
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

// Doc 48: el clipboard de columnas pertenece al changeset donde se copió —
// cambiar de changeset (o soltarlo) lo invalida, junto con la selección y el
// popup. Doc 50: ídem el clipboard de TABLA. Suscripción a nivel de módulo
// (useSessionStore no importa este store, así que no hay ciclo). Doc 75 D14: la
// sesión es la ÚNICA fuente del changeset activo.
useSessionStore.subscribe((s, prev) => {
  // Doc 105 (F3): la pila de Undo es de la SESIÓN — proyecto, modo y versión,
  // como `canvasSessionKey` —, no sólo de la versión: editar → solo lectura →
  // editar la MISMA versión (p. ej. transferida de ida y vuelta) no debe dejar
  // inversas de antes.
  const sessionChanged = s.openMode !== prev.openMode || s.activeProjectId !== prev.activeProjectId
    || s.activeChangesetId !== prev.activeChangesetId;
  if (sessionChanged) {
    useUndoStore.getState().clear();
    // Doc 105 (ronda 3, R7-A): el canvas de la sesión anterior se va EN EL ACTO
    // — antes seguía vivo y editable hasta que el refresco lo reabría (varias
    // idas y vueltas) y sus escrituras llevaban el doc de A a la versión B. Se
    // conserva `activeSaId`: el refresco lo reabre si existe en la nueva. Las
    // cargas en vuelo de la anterior se descartan al llegar (`_loadSeq`).
    _loadSeq += 1;
    _reloadAfterOpening = null;   // ronda 4: una recarga pendiente era de la anterior
    useModelerStore.setState({
      diagram: null, drawings: [], openingSaId: null,
      selectedTableId: null, selectedEdgeId: null, selectedColumnId: null, selectedViewId: null,
      columnTarget: null, relPreset: null, subcatArmed: false, hoverEdgeId: null, hoverNodeId: null,
      colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null,
      inspect: null, searchOpen: false, navigating: null, pendingFocusTableId: null, pendingFocusColId: null,
      modelProps: null, colorPreview: null,
    });
  }
  if (s.activeChangesetId === prev.activeChangesetId) return;
  useModelerStore.setState({ colClipboard: null, tblClipboard: null, colSel: null, colMenu: null, pasteTarget: null, panelFocusColId: null, selectedColumnId: null, selectedViewId: null });
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

