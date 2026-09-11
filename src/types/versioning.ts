/**
 * Versioning + dashboard types (Home p0 / Open model pg / Review p5).
 *
 * Espejan los shapers del backend R1:
 *   - `version_row(cs)` → {@link VersionRow}  (changesets/service.py)
 *   - `summary(projectId?)` → {@link DashboardSummary}  (summary/service.py)
 *   - `list_users()` → {@link SimUserDto}  (identity/users.py)
 *
 * Sólo se tipa lo que el frontend consume; campos extra del backend se ignoran
 * (el envelope ya viene desempaquetado por `apiFetch`).
 */

/** Estado de un changeset/versión. Coincide 1:1 con el backend. */
export type VersionStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

/** Referencia a la versión restaurada (doc 65) — la estampa el rollback. */
export interface RestoredFrom {
  csId: string;
  versionLabel?: string | null;
  appliedAt?: string | null;
}

/** Conteos de activos de un proyecto (`GET /api/projects/{pid}/counts`, doc 75 D5). */
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
 * un changeset SIN el `changes` crudo. `versionLabel`/`title`/`owner` pueden
 * venir `null` para drafts recién creados. Doc 75: toda versión es de UN
 * proyecto; `deletesProject` marca la que borra su proyecto (pill crítica).
 */
export interface VersionRow {
  id: string;
  /** Doc 88 §6: historial de solicitudes (un registro por ciclo de envío) y el
   *  último ciclo — Review lista y etiqueta por él. */
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
  /** Timestamp del apply COMPLETO a producción. `approved` sin appliedAt =
   *  publish interrumpido (el backend lo excluye de la fila de producción). */
  appliedAt?: string | null;
  /** Doc 65: presente cuando esta versión nació de una restauración. */
  restoredFrom?: RestoredFrom | null;
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
}

/** Body de `POST /api/changesets/snapshot`: la working copy es DEL proyecto (doc 75 D2). */
export interface SnapshotBody {
  projectId: string;
  title?: string;
  description?: string;
  versionLabel?: string;
}

/**
 * Body de `POST /api/changesets/{id}/submit` (publish request, Screen 04b).
 * `reviewers` son ids de usuario (1+). `title`/`description` describen el cambio.
 */
export interface SubmitBody {
  title?: string;
  description?: string;
  reviewers?: string[];
}

// ─── Review detail (Review p5) ───────────────────────────────────────────────

/** Doc 88 §6: resultado de un ciclo de envío. `rejected` y `withdrawn` dejan la
 *  versión en draft (el owner sigue editando); `approved` la publica. */
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
  /** Motivo del rechazo (obligatorio al rechazar, doc 88 §5). */
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
 * Changeset completo de `GET /api/changesets/{id}`. Sólo se tipa lo que el panel
 * de Review consume; campos extra (p.ej. el `diff` resumen compat o `changes`)
 * se ignoran. `approvals` es un mapa `userId → Approval`.
 */
export interface ChangesetDetail {
  id: string;
  title: string | null;
  description?: string | null;
  owner: string | null;
  status: VersionStatus;
  versionLabel?: string | null;
  /** Doc 75: proyecto de la versión. */
  projectId: string;
  reviewers: string[];
  approvals: Record<string, Approval>;
  comments: ChangesetComment[];
  /** Doc 88 §6: historial de solicitudes de esta versión. */
  requests?: RequestCycle[];
  submittedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** Decisor final + publicación (el backend siempre los sirve; doc 65 los tipa
   *  para la pestaña Details del popup de herramientas de versiones). */
  reviewedBy?: string | null;
  /** Doc 88 §5: motivo del último rechazo (también en `requests[]`). */
  reviewNote?: string | null;
  reviewedAt?: string | null;
  appliedAt?: string | null;
  /** Doc 65: presente cuando esta versión nació de una restauración. */
  restoredFrom?: RestoredFrom | null;
}

/** Una entidad tocada por el diff (tabla/columna). `collection` la agrupa. */
export interface DiffEntity {
  id: string;
  name: string;
  collection?: string | null;
  /** true: la entidad cambió en PRODUCCIÓN después de que esta versión la editó
   *  (al publicar, este delta la pisaría). */
  conflict?: boolean;
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
  /** Doc 75 D5: presente cuando la versión BORRA su proyecto — el revisor ve un
   *  aviso crítico con los conteos de lo que desaparece. */
  deletesProject?: { id: string; name: string; counts: ScopeCounts } | null;
}

/** Nodo de la jerarquía del diff (Proyecto→Folder→Canvas→Esquema→Tabla→Columna).
 *  `change` sólo en hojas que cambiaron (una tabla contenedora puede no tenerlo). */
export interface DiffTreeNode {
  type: 'project' | 'folder' | 'canvas' | 'schema' | 'table' | 'view' | 'column';
  id: string;
  name: string;
  change?: 'added' | 'edited' | 'deleted' | null;
  children?: DiffTreeNode[];
  /** Doc 84 B2: id de la entidad versionada cuando el nodo de ESTRUCTURA cambió
   *  (carpeta/canvas/proyecto = su id; esquema = el uuid, el nodo lleva el nombre). */
  entityId?: string;
  /** Doc 84 B4: tipo de dato de una columna (se escanea sin abrir cada fila). */
  dataType?: string | null;
}

/** Cambio de una entidad de ESTRUCTURA (proyecto/folder/canvas/esquema). */
export interface DiffStructureEntry {
  type: string;
  id: string;
  name: string;
  kind: string;
  change: 'added' | 'edited' | 'deleted';
  /** Doc 84 B2: ya está representada (con su pill) en el árbol. */
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
  /** Doc 84 A3: último cambio grabado en el request (el autor es el owner). */
  lastChangeAt?: string | null;
}

/** Body de `POST /api/changesets/{id}/review`. */
export interface ReviewBody {
  decision: 'approve' | 'reject';
  note?: string;
}

// ─── Change details (doc 31 — popup de la revisión) ──────────────────────────

/** Una fila de campo del diff antes→después de una entidad.
 *  `kind: 'delta'` = resumen de un cambio de conjunto (p.ej. "+2 added · −1
 *  removed") que se pinta como un solo valor ámbar, sin columna before. */
export interface DiffFieldRow {
  key: string;
  label: string;
  before?: unknown;
  after?: unknown;
  kind?: 'delta' | null;
}

/** Diff de UNA entidad de `POST /api/changesets/{id}/diff/details`.
 *  `fields` trae SOLO los campos con cambio real (vacío = solo metadata
 *  interna); las referencias vienen resueltas a NOMBRE por el backend. */
export interface DiffEntityDetail {
  collection: string;
  entityId: string;
  action: 'created' | 'modified' | 'deleted';
  name: string | null;
  fields: DiffFieldRow[];
  /** Doc 84 B3: cuándo se grabó el cambio en el request (null en el compare). */
  at?: string | null;
}

// ─── Version compare (doc 65 — popup "Version tools" del Home) ───────────────

/** Extremo del compare: cabecera mínima de una versión publicada. */
export interface CompareVersionRef {
  id: string;
  versionLabel?: string | null;
  title?: string | null;
  appliedAt?: string | null;
}

/** Doc 84 C2: la ÚLTIMA versión del rango comparado que tocó una entidad. */
export interface CompareLastVersion {
  id: string | null;
  versionLabel?: string | null;
  owner?: string | null;
  appliedAt?: string | null;
}

/** Una entidad con cambio NETO entre las dos versiones comparadas. */
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

/** Respuesta de `GET /api/versions/compare` (doc 65). El backend normaliza
 *  `from`/`to` al orden cronológico; `unreconstructed` lista entidades sin
 *  imagen previa (publicadas antes de la captura) EXCLUIDAS del diff. */
export interface VersionCompare {
  from: CompareVersionRef;
  to: CompareVersionRef;
  versionsSpanned: number;
  collections: Record<string, CompareBucket>;
  counts: { added: number; edited: number; deleted: number; total: number };
  unreconstructed: { collection: string; id: string; name: string | null }[];
  /** Doc 84 C1: la misma jerarquía del popup de revisión. */
  tree?: DiffTreeNode[];
  orphans?: DiffTreeNode[];
  structure?: DiffStructureEntry[];
}

// ─── Publish blocked (doc 84 D1/A1) ──────────────────────────────────────────

/** Un choque reportado por el publish. `kind`: table | column | schema | change. */
export interface PublishBlockedItem {
  collection?: string;
  kind: string;
  entityId?: string;
  name?: string;
  schema?: string | null;
  tableId?: string | null;
  tableName?: string | null;
  /** `production`: ya existe publicado · `request`: se repite dentro del request. */
  where?: 'production' | 'request';
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

/** `detail` estructurado de un 409/422 del approve: el bloqueo no cambió, ahora
 *  se explica entero (lista completa + qué hacer). */
export interface PublishBlockedDetail {
  code: string;
  message: string;
  items: PublishBlockedItem[];
  next?: string | null;
}
