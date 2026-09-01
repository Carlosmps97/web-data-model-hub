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

/**
 * Fila de versión cross-project (tabla de Review + lista del Home + requests).
 * Proyección de un changeset SIN el `changes` crudo. `versionLabel`/`title`/
 * `owner` pueden venir `null` para drafts recién creados.
 */
export interface VersionRow {
  id: string;
  versionLabel: string | null;
  title: string | null;
  owner: string | null;
  status: VersionStatus;
  projectIds: string[];
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

/** Body de `POST /api/changesets/snapshot` (todos los campos opcionales). */
export interface SnapshotBody {
  title?: string;
  description?: string;
  versionLabel?: string;
  projectIds?: string[];
}

/**
 * Body de `POST /api/changesets/{id}/submit` (publish request, Screen 04b).
 * `reviewers` son ids de usuario (1+). `title`/`description` describen el cambio.
 */
export interface SubmitBody {
  title?: string;
  description?: string;
  reviewers?: string[];
  projectIds?: string[];
}

// ─── Review detail (Review p5) ───────────────────────────────────────────────

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
  projectIds: string[];
  reviewers: string[];
  approvals: Record<string, Approval>;
  comments: ChangesetComment[];
  submittedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** Decisor final + publicación (el backend siempre los sirve; doc 65 los tipa
   *  para la pestaña Details del popup de herramientas de versiones). */
  reviewedBy?: string | null;
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
  /** Proyectos distintos afectados (membership de canvas), computado del diff. */
  projectsAffected?: number;
}

/** Nodo de la jerarquía del diff (Proyecto→Folder→Canvas→Esquema→Tabla→Columna).
 *  `change` sólo en hojas que cambiaron (una tabla contenedora puede no tenerlo). */
export interface DiffTreeNode {
  type: 'project' | 'folder' | 'canvas' | 'schema' | 'table' | 'view' | 'column';
  id: string;
  name: string;
  change?: 'added' | 'edited' | 'deleted' | null;
  children?: DiffTreeNode[];
}

/** Cambio de una entidad de ESTRUCTURA (proyecto/folder/canvas/esquema). */
export interface DiffStructureEntry {
  type: string;
  id: string;
  name: string;
  kind: string;
  change: 'added' | 'edited' | 'deleted';
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
}

// ─── Version compare (doc 65 — popup "Version tools" del Home) ───────────────

/** Extremo del compare: cabecera mínima de una versión publicada. */
export interface CompareVersionRef {
  id: string;
  versionLabel?: string | null;
  title?: string | null;
  appliedAt?: string | null;
}

/** Una entidad con cambio NETO entre las dos versiones comparadas. */
export interface CompareEntity {
  id: string;
  name: string | null;
  collection: string;
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
}
