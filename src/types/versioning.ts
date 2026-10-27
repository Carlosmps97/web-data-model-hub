/**
 * Tipos de versionamiento y del dashboard (Home / Open model / Review).
 *
 * Espejan los shapers del backend:
 *   - `version_row(cs)` → {@link VersionRow}  (changesets/service.py)
 *   - `summary(projectId?)` → {@link DashboardSummary}  (summary/service.py)
 *   - `list_users()` → {@link SimUserDto}  (identity/users.py)
 *
 * Solo se tipa lo que el frontend consume; campos extra del backend se ignoran
 * (el envelope ya viene desempaquetado por `apiFetch`).
 */

/** Estado de un changeset/versión. Coincide 1:1 con el backend. */
export type VersionStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

/** Referencia a la versión restaurada; la estampa el rollback. */
export interface RestoredFrom {
  csId: string;
  versionLabel?: string | null;
  appliedAt?: string | null;
}

/** Un traspaso de ownership de un draft (`transfers[]` del changeset, espejo
 *  del dict del backend; invariante round-trip). `from` de la primera
 *  transferencia = quien inició la versión; `owner` es siempre el dueño actual. */
export interface OwnershipTransfer {
  from: string;
  to: string;
  /** Quien la transfirió: el dueño de entonces o un administrador. */
  by: string;
  at: string;
  note?: string | null;
}

/** Conteos de activos de un proyecto (`GET /api/projects/{pid}/counts`). */
export interface ScopeCounts {
  tables: number;
  columns: number;
  views: number;
  relationships: number;
  schemas: number;
  folders: number;
  canvases: number;
}

/**
 * Fila de versión (tabla de Review + lista del Home + requests). Proyección de
 * un changeset sin el `changes` crudo. `versionLabel`/`title`/`owner` pueden
 * venir `null` para drafts recién creados. Toda versión es de un solo
 * proyecto; `deletesProject` marca la que borra su proyecto (pill crítica).
 */
export interface VersionRow {
  id: string;
  /** Historial de solicitudes (un registro por ciclo de envío) y el último
   *  ciclo; Review lista y etiqueta por él. */
  requests?: RequestCycle[];
  lastRequest?: RequestCycle | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  versionLabel: string | null;
  title: string | null;
  owner: string | null;
  status: VersionStatus;
  projectId: string;
  deletesProject: boolean;
  reviewers: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
  submittedAt?: string | null;
  /** Timestamp del apply completo a producción. `approved` sin appliedAt =
   *  publish interrumpido (el backend lo excluye de la fila de producción). */
  appliedAt?: string | null;
  /** Presente cuando esta versión nació de una restauración. */
  restoredFrom?: RestoredFrom | null;
  /** Traspasos de ownership (vacío si la versión no tuvo traspasos). */
  transfers?: OwnershipTransfer[];
}

/** Los 5 contadores del Home (global o acotado a un proyecto). */
export interface DashboardSummary {
  tables: number;
  views: number;
  relationships: number;
  subjectAreas: number;
  projects: number;
}

/** Usuario simulado devuelto por `GET /api/users` (id/name/initials). */
export interface SimUserDto {
  id: string;
  name: string;
  initials: string;
  /** Usuario deshabilitado: solo viene en `listUserNames()` (para resolver
   *  nombres); nunca se ofrece como revisor ni destino. */
  disabled?: boolean;
}

/** Body de `POST /api/changesets/snapshot`: la working copy es del proyecto. */
export interface SnapshotBody {
  projectId: string;
  title?: string;
  description?: string;
  versionLabel?: string;
}

/**
 * Body de `POST /api/changesets/{id}/submit` (publish request).
 * `reviewers` son ids de usuario (1+). `title`/`description` describen el cambio.
 */
export interface SubmitBody {
  title?: string;
  description?: string;
  reviewers?: string[];
}

// ─── Detalle de la revisión (Review) ─────────────────────────────────────────

/** Resultado de un ciclo de envío. `rejected` y `withdrawn` dejan la versión en
 *  draft (el dueño sigue editando); `approved` la publica. */
export type RequestOutcome = 'pending' | 'approved' | 'rejected' | 'withdrawn';

/** Un ciclo de solicitud de publicación (`requests[]` del changeset). Espejo
 *  del dict del backend (`ChangesetDoc.requests`, invariante round-trip). */
export interface RequestCycle {
  id: string;
  cycle: number;
  submittedAt?: string | null;
  submittedBy?: string | null;
  title?: string | null;
  description?: string | null;
  reviewers: string[];
  outcome: RequestOutcome;
  decidedAt?: string | null;
  decidedBy?: string | null;
  /** Motivo del rechazo (obligatorio al rechazar). */
  note?: string | null;
  decisions?: Record<string, Approval>;
}

/** Veredicto de un reviewer sobre un changeset (`approvals[userId]`). */
export interface Approval {
  status: 'approved' | 'rejected';
  note?: string | null;
  at?: string | null;
}

/** Comentario del hilo de un changeset (`comments[]`). */
export interface ChangesetComment {
  author: string;
  text: string;
  at?: string | null;
}

/**
 * Changeset completo de `GET /api/changesets/{id}`. Solo se tipa lo que el panel
 * de Review consume; campos extra (p.ej. `changes`) se ignoran. `approvals` es
 * un mapa `userId → Approval`.
 */
export interface ChangesetDetail {
  id: string;
  title: string | null;
  description?: string | null;
  owner: string | null;
  status: VersionStatus;
  versionLabel?: string | null;
  /** Proyecto de la versión. */
  projectId: string;
  reviewers: string[];
  approvals: Record<string, Approval>;
  comments: ChangesetComment[];
  /** Historial de solicitudes de esta versión. */
  requests?: RequestCycle[];
  submittedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** Decisor final + publicación (el backend siempre los sirve; se tipan para
   *  la pestaña Details del popup de herramientas de versiones). */
  reviewedBy?: string | null;
  /** Motivo del último rechazo (también en `requests[]`). */
  reviewNote?: string | null;
  reviewedAt?: string | null;
  appliedAt?: string | null;
  /** Presente cuando esta versión nació de una restauración. */
  restoredFrom?: RestoredFrom | null;
  /** Traspasos de ownership (vacío si la versión no tuvo traspasos). */
  transfers?: OwnershipTransfer[];
  /** Resumen por colección: ids que el draft agrega / modifica / borra frente
   *  a producción. */
  diff?: Record<string, VersionDiffSummary>;
  /** Todos los cambios del draft (también lo creado y borrado dentro de él):
   *  lo que se borra al eliminarlo. */
  changeCount?: number;
  /** Un approve falló cuando ya escribía en producción;
   *  mientras exista, el backend no deja eliminar el draft (409). */
  partialApplyAt?: string | null;
  /** Una carga Excel escribiendo en el draft (lock visible para los dos
   *  procesos del backend; `heartbeat` en epoch). Transferir, eliminar y enviar a
   *  revisión responden 409 mientras esté vivo. Espejo de `ChangesetDoc.uploadLock`. */
  uploadLock?: { jobId: string; owner: string; at: number; heartbeat: number } | null;
  /** Draft de restauración a medias (el proceso murió armándolo): no se
   *  puede enviar (409); se elimina y se restaura de nuevo. Espejo de `ChangesetDoc`. */
  restoreIncomplete?: boolean | null;
}

/** Ids por verbo de una colección en el resumen por colección de `GET /api/changesets/{id}`. */
export interface VersionDiffSummary {
  added: string[];
  modified: string[];
  removed: string[];
}

/** Una entidad tocada por el diff (tabla/columna). `collection` la agrupa. */
export interface DiffEntity {
  id: string;
  name: string;
  collection?: string | null;
  /** true: la entidad tiene cambios en producción posteriores a la edición de
   *  esta versión (al publicar, este delta la pisaría). */
  conflict?: boolean;
  /** Producción la borró después de abrirse esta versión; al publicar vuelve a
   *  la vida. Siempre acompañado de `conflict`. */
  restores?: boolean;
  /** Objeto del modelo que otra versión borró y publicó después de abrirse
   *  esta: no se publica ni se revive (el envío y la aprobación se bloquean
   *  hasta que el dueño descarte el cambio). Siempre acompañado de `conflict`. */
  deletedInProduction?: boolean;
}

/** Buckets de cambios de una colección dentro del diff. */
export interface DiffBucket {
  added: DiffEntity[];
  edited: DiffEntity[];
  deleted: DiffEntity[];
}

/** Resumen de impacto del changeset (cuántas/ qué tablas se ven afectadas). */
export interface DiffImpact {
  tablesTouched: number;
  columnsTouched: number;
  affectedOtherTables: { id: string; name: string }[];
  /** Presente cuando la versión borra su proyecto: el revisor ve un aviso
   *  crítico con los conteos de lo que desaparece. */
  deletesProject?: { id: string; name: string; counts: ScopeCounts } | null;
}

/** Nodo de la jerarquía del diff (Proyecto→Folder→Canvas→Esquema→Tabla→Columna).
 *  `change` solo en hojas que cambiaron (una tabla contenedora puede no tenerlo). */
export interface DiffTreeNode {
  type: 'project' | 'folder' | 'canvas' | 'schema' | 'table' | 'view' | 'column';
  id: string;
  name: string;
  change?: 'added' | 'edited' | 'deleted' | null;
  children?: DiffTreeNode[];
  /** Id de la entidad versionada cuando el nodo de estructura tiene cambios
   *  (carpeta/canvas/proyecto = su id; esquema = el uuid, el nodo lleva el nombre). */
  entityId?: string;
  /** Tipo de dato de una columna (se escanea sin abrir cada fila). */
  dataType?: string | null;
}

/** Cambio de una entidad de estructura (proyecto/folder/canvas/esquema). */
export interface DiffStructureEntry {
  type: string;
  id: string;
  name: string;
  kind: string;
  change: 'added' | 'edited' | 'deleted';
  /** Ya está representada (con su pill) en el árbol. */
  inTree?: boolean;
}

/** Diff completo de `GET /api/changesets/{id}/diff`. */
export interface ChangesetDiff {
  collections: Record<string, DiffBucket>;
  impact: DiffImpact;
  /** Jerarquía de los cambios de datos (tablas/columnas/vistas). */
  tree?: DiffTreeNode[];
  /** Tablas/vistas cambiadas que no están en ningún canvas. */
  orphans?: DiffTreeNode[];
  /** Cambios de estructura (proyectos/folders/canvases/esquemas). */
  structure?: DiffStructureEntry[];
  /** Último cambio grabado en el request (el autor es el dueño). */
  lastChangeAt?: string | null;
}

/** Body de `POST /api/changesets/{id}/review`. */
export interface ReviewBody {
  decision: 'approve' | 'reject';
  note?: string;
}

// ─── Change details (popup de la revisión) ───────────────────────────────────

/** Una fila de campo del diff (before → after) de una entidad.
 *  `kind: 'delta'` = resumen de un cambio de conjunto (p.ej. "+2 added · −1
 *  removed") que se pinta como un solo valor ámbar, sin columna before. */
export interface DiffFieldRow {
  key: string;
  label: string;
  before?: unknown;
  after?: unknown;
  kind?: 'delta' | null;
}

/** Diff de una entidad de `POST /api/changesets/{id}/diff/details`.
 *  `fields` trae solo los campos con cambio real (vacío = solo metadata
 *  interna); las referencias vienen resueltas a nombre por el backend. */
export interface DiffEntityDetail {
  collection: string;
  entityId: string;
  action: 'created' | 'modified' | 'deleted';
  name: string | null;
  fields: DiffFieldRow[];
  /** Cuándo se grabó el cambio en el request (null en el compare). */
  at?: string | null;
}

// ─── Version compare (popup "Version tools" del Home) ────────────────────────

/** Extremo del compare: cabecera mínima de una versión publicada. */
export interface CompareVersionRef {
  id: string;
  versionLabel?: string | null;
  title?: string | null;
  appliedAt?: string | null;
}

/** La última versión del rango comparado que tocó una entidad. */
export interface CompareLastVersion {
  id: string | null;
  versionLabel?: string | null;
  owner?: string | null;
  appliedAt?: string | null;
}

/** Una entidad con cambio neto entre las dos versiones comparadas. */
export interface CompareEntity {
  id: string;
  name: string | null;
  collection: string;
  lastVersion?: CompareLastVersion | null;
}

/** Buckets por verbo de una colección dentro del compare. */
export interface CompareBucket {
  added: CompareEntity[];
  edited: CompareEntity[];
  deleted: CompareEntity[];
}

/** Respuesta de `GET /api/versions/compare`. El backend normaliza
 *  `from`/`to` al orden cronológico; `unreconstructed` lista entidades sin
 *  imagen previa (publicadas antes de la captura) excluidas del diff. */
export interface VersionCompare {
  from: CompareVersionRef;
  to: CompareVersionRef;
  versionsSpanned: number;
  collections: Record<string, CompareBucket>;
  counts: { added: number; edited: number; deleted: number; total: number };
  unreconstructed: { collection: string; id: string; name: string | null }[];
  /** La misma jerarquía del popup de revisión. */
  tree?: DiffTreeNode[];
  orphans?: DiffTreeNode[];
  structure?: DiffStructureEntry[];
}

// ─── Publish blocked ─────────────────────────────────────────────────────────

/** Un choque reportado por el publish. `kind`: table | view | column | relationship | schema | change. */
export interface PublishBlockedItem {
  collection?: string;
  kind: string;
  entityId?: string;
  name?: string;
  schema?: string | null;
  tableId?: string | null;
  tableName?: string | null;
  /** `production`: ya existe publicado · `request`: se repite dentro del request ·
   *  `deleted`: otra versión lo borró y publicó (o borró su tabla, su esquema o una columna de sus pares). */
  where?: 'production' | 'request' | 'deleted';
  /** Con `deleted`: lo que se borró cuando no es el objeto mismo (su tabla, su esquema o una columna de
   *  los pares de una relación). */
  deletedParent?: { kind: 'table' | 'schema' | 'column'; id?: string | null; name: string } | null;
  /** Con `deleted`: el borrado es posterior a la apertura de esta versión. */
  afterOpened?: boolean;
  message: string;
  existing?: {
    id?: string | null;
    name?: string | null;
    schema?: string | null;
    tableName?: string | null;
    version?: string | null;
    owner?: string | null;
    publishedAt?: string | null;
  } | null;
}

/** `detail` estructurado de un 409/422 del approve: explica el bloqueo entero
 *  (lista completa + qué hacer). */
export interface PublishBlockedDetail {
  code: string;
  message: string;
  items: PublishBlockedItem[];
  next?: string | null;
}
