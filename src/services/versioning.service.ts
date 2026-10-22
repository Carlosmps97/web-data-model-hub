/**
 * versioning.service: versiones, publish requests y snapshot (Home y Review).
 *
 * Backend: routers hermanos de changesets (app/features/changesets/router.py) +
 * identity (`/api/users`). Todas las llamadas pasan por `apiGet`/`apiPost`, que
 * desempaquetan el envelope `{success,data}` y propagan `ApiError`.
 *
 *   listVersions(projectId?)    → GET  /api/versions[?projectId=]   (todas o las del proyecto)
 *   getPublished(projectId)     → GET  /api/projects/{pid}/versions/published (fila verde o null)
 *   listRequests({reviewer,owner}) → GET /api/requests?…         (submitted)
 *   snapshot(body)              → POST /api/changesets/snapshot   (crea draft)
 *   listUsers()                 → GET  /api/users
 *   getChangeset(id)            → GET  /api/changesets/{id}        (detalle de Review)
 *   getDiff(id)                 → GET  /api/changesets/{id}/diff
 *   review(id, body)            → POST /api/changesets/{id}/review (403 si no es revisor)
 *   addComment(id, {text})      → POST /api/changesets/{id}/comments
 */

import type {
  ChangesetDetail,
  ChangesetDiff,
  DiffEntityDetail,
  PublishBlockedDetail,
  PublishBlockedItem,
  ReviewBody,
  SimUserDto,
  SnapshotBody,
  SubmitBody,
  VersionCompare,
  VersionRow,
  VersionStatus,
} from '@/types/versioning';
import { ApiError, apiDelete, apiGet, apiPost, LONG_TIMEOUT_MS } from './http';

import { API_BASE } from '@/services/apiBase';

/** Versiones (filas para la tabla de Review y el Home): todas las visibles
 *  para el actor o, con `projectId`, solo las de ese proyecto. */
export function listVersions(projectId?: string): Promise<VersionRow[]> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return apiGet<VersionRow[]>(`${API_BASE}/api/versions${qs}`);
}

/** Producción actual del proyecto (última approved aplicada) o `null` si no hay ninguna. */
export function getPublished(projectId: string): Promise<VersionRow | null> {
  return apiGet<VersionRow | null>(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/versions/published`);
}

/**
 * Publish requests en revisión (`submitted`). Se filtra por `reviewer` (asignado;
 * p. ej. el actor → las solicitudes que le llegan para aprobar) y/o `owner`
 * (solicitante).
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
 * Crea un draft (working copy) del proyecto a partir de su estado publicado:
 * el "Snapshot from production" del Open model. Devuelve el changeset creado
 * (con `id` y `versionLabel` autogenerado por proyecto si no se pasó).
 */
export function snapshot(body: SnapshotBody): Promise<VersionRow> {
  return apiPost<VersionRow>(`${API_BASE}/api/changesets/snapshot`, body, { timeoutMs: LONG_TIMEOUT_MS });
}

/** Usuarios (id/name/initials). Con `can` (p. ej. 'review.decide'), solo los
 *  usuarios cuyo rol otorga ese permiso: el selector de revisores lo usa
 *  para no ofrecer gente que nunca podría aprobar (request trabado). Con
 *  `projectId`, solo quienes acceden a ese proyecto (un revisor o destino sin
 *  acceso no podría abrir la versión). */
export function listUsers(can?: string, projectId?: string | null): Promise<SimUserDto[]> {
  const qs = new URLSearchParams();
  if (can) qs.set('can', can);
  if (projectId) qs.set('projectId', projectId);
  const q = qs.toString();
  return apiGet<SimUserDto[]>(`${API_BASE}/api/users${q ? `?${q}` : ''}`);
}

/** Directorio para resolver nombres: incluye a los deshabilitados
 *  (`disabled: true`): quien dejó la empresa sigue siendo dueño o autor de su
 *  versión y debe verse con su nombre, no con su correo. Para ofrecer personas
 *  (revisores, destinos de transferencia) se usa `listUsers`. */
export function listUserNames(): Promise<SimUserDto[]> {
  return apiGet<SimUserDto[]>(`${API_BASE}/api/users?includeDisabled=true`);
}

/**
 * Publish request (Canvas → "Send for Approval"). Asigna
 * revisores/título/descripción al changeset y lo pasa a `submitted`. Espeja
 * `POST /api/changesets/{id}/submit` (SubmitBody). Devuelve la fila actualizada.
 */
export function submit(id: string, body: SubmitBody): Promise<VersionRow> {
  return apiPost<VersionRow>(`${API_BASE}/api/changesets/${id}/submit`, body, { timeoutMs: LONG_TIMEOUT_MS });
}

/**
 * Quita del draft los cambios sobre objetos que otra versión borró y publicó
 * después de que este se abrió (los que bloquean el envío), también los que no
 * se ven en el canvas. Solo el dueño y solo en draft. Espeja
 * `POST /api/changesets/{id}/discard-deleted`.
 */
export function discardDeleted(id: string): Promise<{ discarded: PublishBlockedItem[] }> {
  return apiPost<{ discarded: PublishBlockedItem[] }>(`${API_BASE}/api/changesets/${id}/discard-deleted`, {},
    { timeoutMs: LONG_TIMEOUT_MS });
}

// ─── Detalle de Review ───────────────────────────────────────────────────────

/** Changeset completo (cabecera, reviewers, approvals, comments) para el panel. */
export function getChangeset(id: string): Promise<ChangesetDetail> {
  return apiGet<ChangesetDetail>(`${API_BASE}/api/changesets/${id}`);
}

/** `detail` estructurado de un publish bloqueado (409/422 del approve):
 *  {code, message, items, next}; null si el error no es de ese tipo (entonces
 *  vale el `message` habitual). */
export function publishBlockedDetail(e: unknown): PublishBlockedDetail | null {
  if (!(e instanceof ApiError) || !e.detail || typeof e.detail !== 'object') return null;
  const d = e.detail as Partial<PublishBlockedDetail>;
  if (typeof d.code !== 'string' || typeof d.message !== 'string' || !Array.isArray(d.items)) return null;
  return { code: d.code, message: d.message, items: d.items as PublishBlockedItem[], next: d.next ?? null };
}

/** Diff estructurado (added/edited/deleted por colección + resumen de impacto). */
export function getDiff(id: string): Promise<ChangesetDiff> {
  return apiGet<ChangesetDiff>(`${API_BASE}/api/changesets/${id}/diff`);
}

// ─── Change details (resumen + popup) ────────────────────────────────────────

/** Diff de campos antes→después de entidades puntuales del changeset (popup
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

/** Resumen agregado del diff para la card "Changes summary". */
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

/** Orden y labels en inglés de la matriz del resumen (regla de UI). Exportado:
 *  el popup de compare reusa el mismo orden/labels. */
export const SUMMARY_ROWS: [string, string][] = [
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
 * Agrega el `GET /diff` ya cargado a la card de resumen (función pura, sin backend):
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
 * propio: se propaga ese mensaje al toast, para no mostrar "not assigned"
 * cuando el problema real es de permisos del rol.
 */
export async function review(id: string, body: ReviewBody): Promise<ChangesetDetail> {
  try {
    // Aprobar publica (apply + cascada si borra el proyecto): acción larga.
    return await apiPost<ChangesetDetail>(`${API_BASE}/api/changesets/${id}/review`, body, { timeoutMs: LONG_TIMEOUT_MS });
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      throw new ApiError(err.message || 'You are not assigned as a reviewer of this change.', 403);
    }
    throw err;
  }
}

/** Rollback a una versión publicada: el backend crea un draft que restaura el
 *  modelo al estado de esa versión (cambios inversos de las versiones
 *  posteriores, a partir de las imágenes previas capturadas en cada publish).
 *  Producción no cambia hasta que ese draft pase submit → review → approve. */
export function rollbackVersion(id: string): Promise<VersionRow> {
  return apiPost<VersionRow>(`${API_BASE}/api/changesets/${id}/rollback`, {}, { timeoutMs: LONG_TIMEOUT_MS });
}

/** Agrega un comentario al hilo del changeset; devuelve el changeset refrescado. */
export function addComment(id: string, body: { text: string }): Promise<ChangesetDetail> {
  return apiPost<ChangesetDetail>(`${API_BASE}/api/changesets/${id}/comments`, body);
}

// ─── Snapshot de una versión publicada ───────────────────────────────────────

/** Prefijo del changeset virtual que el backend resuelve como el inverso de
 *  las versiones publicadas después de la objetivo: abrir el canvas en
 *  readonly con `changesetId = asof:<versionId>` muestra el modelo exacto de
 *  esa versión (canvas, explorer, DBX, links) sin tocar producción. */
export const AS_OF_PREFIX = 'asof:';
export const asOfChangesetId = (versionId: string): string => `${AS_OF_PREFIX}${versionId}`;
export const isAsOfChangesetId = (id: string | null | undefined): boolean =>
  typeof id === 'string' && id.startsWith(AS_OF_PREFIX) && id.length > AS_OF_PREFIX.length;

/** ¿El actor puede abrir esta versión en el canvas? Publicadas (pasadas y
 *  actual) → todos; propias (draft / en revisión / rechazada) → su dueño;
 *  requests → sus revisores asignados; el resto solo con
 *  `versions.view_all` (o `admin.manage`). Espejo de la regla del backend
 *  (`changesets/access.py`) para deshabilitar el botón con el motivo. */
export function canOpenVersion(
  v: { status: VersionStatus; appliedAt?: string | null; owner?: string | null; reviewers?: string[] },
  me: string | null | undefined,
  has: (perm: 'versions.view_all' | 'admin.manage') => boolean,
): boolean {
  if (v.status === 'approved' && !!v.appliedAt) return true;
  if (me && (v.owner === me || (v.reviewers ?? []).includes(me))) return true;
  return has('versions.view_all') || has('admin.manage');
}
export const OPEN_VERSION_DENIED = 'Only published versions and your own drafts can be opened in the canvas. Administrators can open any version.';

// ─── Version compare (popup "Version tools" del Home) ────────────────────────

/** Label en inglés de una colección versionada (misma tabla del resumen). */
export function collectionLabel(collection: string): string {
  return SUMMARY_ROWS.find(([c]) => c === collection)?.[1] ?? collection;
}

/**
 * Diferencias netas entre dos versiones publicadas (cualquier orden de ids: el
 * backend normaliza a cronológico). De solo lectura: deriva del mismo ledger del
 * historial/rollback, no toca el flujo de aprobación.
 */
export function compareVersions(fromId: string, toId: string): Promise<VersionCompare> {
  const qs = new URLSearchParams({ fromId, toId });
  return apiGet<VersionCompare>(`${API_BASE}/api/versions/compare?${qs.toString()}`);
}

/** Diff de campos antes→después de entidades puntuales del rango comparado
 *  (misma forma que el popup "Change details", mismo renderer). Máx. 200 items por llamada. */
export function compareVersionDetails(
  fromId: string,
  toId: string,
  items: { collection: string; entityId: string }[],
): Promise<{ items: DiffEntityDetail[] }> {
  return apiPost<{ items: DiffEntityDetail[] }>(
    `${API_BASE}/api/versions/compare/details`,
    { fromId, toId, items },
  );
}

/**
 * Retira un request en revisión (`submitted → draft`) para seguir editándolo y
 * re-enviarlo después. Solo el dueño (403 si no); invalida las decisiones ya
 * registradas. 409 si el request ya fue decidido.
 */
export function withdraw(id: string): Promise<ChangesetDetail> {
  return apiPost<ChangesetDetail>(`${API_BASE}/api/changesets/${id}/withdraw`);
}

/**
 * Reabre un request rechazado (`rejected → draft`) para corregir la versión y
 * re-enviarla. El reject nunca elimina la versión: esta es la vuelta a edición
 * del dueño (403 si no lo es). 409 si dejó de estar en rejected.
 */
export function reopen(id: string): Promise<ChangesetDetail> {
  return apiPost<ChangesetDetail>(`${API_BASE}/api/changesets/${id}/reopen`);
}

// ─── Administración de versiones ─────────────────────────────────────────────

/**
 * Transfiere un draft a otro usuario (su dueño o un administrador): desde ahí
 * ese usuario lo edita, lo envía y figura como autor al publicarse; la versión
 * registra quién la inició. `expectedOwner` = el dueño que mostraba la
 * pantalla: si otra sesión lo cambia en el medio, 409 (no se mueve el draft de
 * otra persona). 403 sin permiso · 409 si no está en draft / carga Excel en
 * curso / cambio de dueño en el medio · 400 destino inválido.
 */
export function transferVersion(
  id: string, body: { to: string; note?: string; expectedOwner?: string | null },
): Promise<ChangesetDetail> {
  return apiPost<ChangesetDetail>(`${API_BASE}/api/changesets/${encodeURIComponent(id)}/transfer`, body);
}

/** Resultado de eliminar un draft: cuántos cambios se borraron con él. */
export interface DeletedVersion {
  id: string;
  deleted: true;
  versionLabel: string | null;
  title: string | null;
  owner: string | null;
  projectId: string;
  changes: number;
}

/** Elimina un draft con todos sus cambios (producción no cambia). Mismos
 *  permisos que transferir; en revisión → retirar primero; publicada → nunca.
 *  `expectedOwner`: como en `transferVersion`. */
export function deleteVersion(id: string, expectedOwner?: string | null): Promise<DeletedVersion> {
  const qs = expectedOwner ? `?expectedOwner=${encodeURIComponent(expectedOwner)}` : '';
  return apiDelete<DeletedVersion>(`${API_BASE}/api/changesets/${encodeURIComponent(id)}${qs}`);
}
