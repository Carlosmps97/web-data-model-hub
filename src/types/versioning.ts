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
}

/** Diff completo de `GET /api/changesets/{id}/diff`. */
export interface ChangesetDiff {
  collections: Record<string, DiffBucket>;
  impact: DiffImpact;
}

/** Body de `POST /api/changesets/{id}/review`. */
export interface ReviewBody {
  decision: 'approve' | 'reject';
  note?: string;
}
