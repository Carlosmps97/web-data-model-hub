/**
 * versioning.service — versiones, publish requests y snapshot (Home p0 / Review p5).
 *
 * Backend: routers hermanos de changesets (app/features/changesets/router.py) +
 * identity (`/api/users`). Todas las llamadas pasan por `apiGet`/`apiPost`, que
 * desempaquetan el envelope `{success,data}` y propagan `ApiError`.
 *
 *   listVersions()              → GET  /api/versions
 *   getPublished()              → GET  /api/versions/published   (fila verde o null)
 *   listRequests({reviewer,owner}) → GET /api/requests?…         (submitted)
 *   snapshot(body)              → POST /api/changesets/snapshot   (crea draft)
 *   listUsers()                 → GET  /api/users
 *   getChangeset(id)            → GET  /api/changesets/{id}        (detalle p5)
 *   getDiff(id)                 → GET  /api/changesets/{id}/diff
 *   review(id, body)            → POST /api/changesets/{id}/review (403 si no es reviewer)
 *   addComment(id, {text})      → POST /api/changesets/{id}/comments
 */

import type {
  ChangesetDetail,
  ChangesetDiff,
  DiffEntityDetail,
  ReviewBody,
  SimUserDto,
  SnapshotBody,
  SubmitBody,
  VersionRow,
} from '@/types/versioning';
import { ApiError, apiGet, apiPost } from './http';

import { API_BASE } from '@/services/apiBase';

/** Lista cross-project de versiones (filas para la tabla de Review y el Home). */
export function listVersions(): Promise<VersionRow[]> {
  return apiGet<VersionRow[]>(`${API_BASE}/api/versions`);
}

/** Versión de producción actual (última approved) o `null` si aún no hay ninguna. */
export function getPublished(): Promise<VersionRow | null> {
  return apiGet<VersionRow | null>(`${API_BASE}/api/versions/published`);
}

/**
 * Publish requests en revisión (`submitted`). Filtrá por `reviewer` (asignado,
 * p.ej. el actor → "los que me llegan para aprobar") y/o `owner` (solicitante).
 */
export function listRequests(
  filters: { reviewer?: string; owner?: string } = {},
): Promise<VersionRow[]> {
  const params = new URLSearchParams();
  if (filters.reviewer) params.set('reviewer', filters.reviewer);
  if (filters.owner) params.set('owner', filters.owner);
  const qs = params.toString();
  return apiGet<VersionRow[]>(`${API_BASE}/api/requests${qs ? `?${qs}` : ''}`);
}

/**
 * Crea un draft (working copy) a partir del estado publicado — el "Snapshot
 * desde producción" del Open model. Devuelve el changeset creado (con `id` y
 * `versionLabel` autogenerado si no se pasó).
 */
export function snapshot(body: SnapshotBody = {}): Promise<VersionRow> {
  return apiPost<VersionRow>(`${API_BASE}/api/changesets/snapshot`, body);
}

/** Usuarios (id/name/initials). Con `can` (p.ej. 'review.decide'), sólo los
 *  usuarios cuyo ROL otorga ese permiso — el selector de revisores lo usa
 *  para no ofrecer gente que nunca podría aprobar (request trabado). */
export function listUsers(can?: string): Promise<SimUserDto[]> {
  return apiGet<SimUserDto[]>(`${API_BASE}/api/users${can ? `?can=${encodeURIComponent(can)}` : ''}`);
}

/**
 * Publish request (Canvas → "Send for Approval", Screen 04b). Asigna
 * revisores/título/descripción al changeset y lo pasa a `submitted`. Espeja
 * `POST /api/changesets/{id}/submit` (SubmitBody). Devuelve la fila actualizada.
 */
export function submit(id: string, body: SubmitBody): Promise<VersionRow> {
  return apiPost<VersionRow>(`${API_BASE}/api/changesets/${id}/submit`, body);
}

// ─── Review detail (p5) ──────────────────────────────────────────────────────

/** Changeset completo (cabecera, reviewers, approvals, comments) para el panel. */
export function getChangeset(id: string): Promise<ChangesetDetail> {
  return apiGet<ChangesetDetail>(`${API_BASE}/api/changesets/${id}`);
}

/** Diff estructurado (added/edited/deleted por colección + resumen de impacto). */
export function getDiff(id: string): Promise<ChangesetDiff> {
  return apiGet<ChangesetDiff>(`${API_BASE}/api/changesets/${id}/diff`);
}

// ─── Change details (doc 31 — resumen + popup) ───────────────────────────────

/** Diff de campos antes→después de entidades PUNTUALES del changeset (popup
 *  "Change details"). Bajo demanda por selección; máx. 200 items por llamada
 *  (el modal trocea). Entidades fuera del changeset se omiten en la respuesta. */
export function getDiffDetails(
  id: string,
  items: { collection: string; entityId: string }[],
): Promise<{ items: DiffEntityDetail[] }> {
  return apiPost<{ items: DiffEntityDetail[] }>(
    `${API_BASE}/api/changesets/${id}/diff/details`,
    { items },
  );
}

/** Fila de la matriz del resumen (una por tipo de entidad con cambios). */
export interface DiffSummaryRow {
  collection: string;
  label: string;
  added: number;
  edited: number;
  deleted: number;
}

/** Resumen agregado del diff para la card "Changes summary" (doc 31). */
export interface DiffSummary {
  rows: DiffSummaryRow[];
  added: number;
  edited: number;
  deleted: number;
  total: number;
  /** Nombres de proyectos afectados (nodos raíz del árbol del diff). */
  projects: string[];
  /** Modelos (canvases) afectados como "Folder › Canvas" (sin el folder raíz). */
  models: string[];
}

/** Orden y labels EN INGLÉS de la matriz del resumen (regla UI). */
const SUMMARY_ROWS: [string, string][] = [
  ['canonical_tables', 'Tables'],
  ['canonical_columns', 'Columns'],
  ['views', 'Views'],
  ['relationships', 'Relationships'],
  ['schemas', 'Schemas'],
  ['subject_areas', 'Canvases'],
  ['folders', 'Folders'],
  ['projects', 'Projects'],
];

/**
 * Agrega el `GET /diff` ya cargado a la card de resumen — PURO, cero backend:
 * conteos por colección de `collections`, proyectos/modelos con nombre real
 * desde los nodos del `tree`. Filas con 0 cambios se omiten.
 */
export function summarizeDiff(diff: ChangesetDiff): DiffSummary {
  const rows: DiffSummaryRow[] = [];
  let added = 0;
  let edited = 0;
  let deleted = 0;
  const push = (collection: string, label: string) => {
    const b = diff.collections[collection];
    if (!b) return;
    const row = {
      collection,
      label,
      added: b.added.length,
      edited: b.edited.length,
      deleted: b.deleted.length,
    };
    if (row.added + row.edited + row.deleted === 0) return;
    rows.push(row);
    added += row.added;
    edited += row.edited;
    deleted += row.deleted;
  };
  for (const [collection, label] of SUMMARY_ROWS) push(collection, label);
  // Colecciones fuera del orden conocido (defensivo: una futura colección
  // versionada nunca debe quedar invisible en el resumen).
  for (const collection of Object.keys(diff.collections)) {
    if (!SUMMARY_ROWS.some(([c]) => c === collection)) push(collection, collection);
  }

  const projects = (diff.tree ?? []).map((p) => p.name);
  const models: string[] = [];
  for (const p of diff.tree ?? []) {
    for (const f of p.children ?? []) {
      const prefix = f.name && !f.name.startsWith('—') ? `${f.name} › ` : '';
      for (const c of f.children ?? []) models.push(`${prefix}${c.name}`);
    }
  }
  return { rows, added, edited, deleted, total: added + edited + deleted, projects, models };
}

/**
 * Veredicto del actor sobre el changeset. El backend distingue los dos 403
 * (sin permiso `review.decide` vs no asignado como revisor) con `detail`
 * propio: se PROPAGA ese mensaje al toast. El rewrite fijo anterior mostraba
 * "not assigned" aunque el problema real fuera de permisos del rol.
 */
export async function review(id: string, body: ReviewBody): Promise<ChangesetDetail> {
  try {
    return await apiPost<ChangesetDetail>(`${API_BASE}/api/changesets/${id}/review`, body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      throw new ApiError(err.message || 'You are not assigned as a reviewer of this change.', 403);
    }
    throw err;
  }
}

/** Rollback de la ÚLTIMA versión publicada: el backend crea un DRAFT con los
 *  cambios INVERSOS (restaura las imágenes previas capturadas en el publish).
 *  Producción no cambia hasta que ese draft pase submit → review → approve. */
export function rollbackVersion(id: string): Promise<VersionRow> {
  return apiPost<VersionRow>(`${API_BASE}/api/changesets/${id}/rollback`, {});
}

/** Agrega un comentario al hilo del changeset; devuelve el changeset refrescado. */
export function addComment(id: string, body: { text: string }): Promise<ChangesetDetail> {
  return apiPost<ChangesetDetail>(`${API_BASE}/api/changesets/${id}/comments`, body);
}

/**
 * Retira un request en revisión (`submitted → draft`) para seguir editándolo y
 * re-enviarlo después. Sólo el owner (403 si no); invalida las decisiones ya
 * registradas. 409 si el request ya fue decidido.
 */
export function withdraw(id: string): Promise<ChangesetDetail> {
  return apiPost<ChangesetDetail>(`${API_BASE}/api/changesets/${id}/withdraw`);
}

/**
 * Reabre un request RECHAZADO (`rejected → draft`) para corregir la versión y
 * re-enviarla. El reject nunca elimina la versión: esta es la vuelta a edición
 * del owner (403 si no lo es). 409 si ya no está en rejected.
 */
export function reopen(id: string): Promise<ChangesetDetail> {
  return apiPost<ChangesetDetail>(`${API_BASE}/api/changesets/${id}/reopen`);
}
