/**
 * Doc 102 (D1): versión del Reporting — producción o una versión PROPIA sin
 * publicar (borrador o en revisión) del proyecto. Funciones puras del combo
 * Version y del nombre del Excel por niveles.
 */
import { ApiError } from '@/services/http';
import type { VersionRow } from '@/types/versioning';

/** Mis versiones sin publicar del proyecto, la más reciente primero. */
export function ownOpenVersions(versions: VersionRow[], projectId: string, me: string | null | undefined): VersionRow[] {
  if (!me) return [];
  const at = (r: VersionRow) => r.updatedAt ?? r.createdAt ?? '';
  return versions
    .filter((r) => r.projectId === projectId && r.owner === me && (r.status === 'draft' || r.status === 'submitted'))
    .sort((a, b) => at(b).localeCompare(at(a)));
}

/** «v14 · Carga Excel — draft» / «v14 — in review». */
export function versionOptionLabel(r: VersionRow): string {
  const label = r.versionLabel ?? 'Working copy';
  const title = r.title && r.title !== r.versionLabel ? ` · ${r.title}` : '';
  return `${label}${title} — ${r.status === 'submitted' ? 'in review' : 'draft'}`;
}

/** «Production · v12» (sin versión publicada, «Production»). */
export function productionLabel(prod: VersionRow | null): string {
  return prod?.versionLabel ? `Production · ${prod.versionLabel}` : 'Production';
}

/** Excel por niveles: `data-model-hub-report-<proyecto>[-<versión propia>]-<fecha>.xlsx`.
 *  Fecha LOCAL de quien exporta (la misma del nombre de la plantilla). */
export function levelsFileName(projectName: string, versionLabel: string | null, date: Date): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  const slug = safe(projectName) || 'project';
  const ver = versionLabel ? `-${safe(versionLabel) || 'draft'}` : '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `data-model-hub-report-${slug}${ver}-${day}.xlsx`;
}

/** Doc 105 (R2-B3): id de toast COMPARTIDO por los errores de lectura del modo
 *  versión y el aviso «showing Production» — sonner reemplaza en vez de apilar
 *  (antes salían dos: el error del backend y el aviso). */
export const VERSION_TOAST = 'dmh-rep-version';

/** Aviso del wrapper cuando la versión elegida dejó de estar abierta. */
export const VERSION_CLOSED_TEXT = 'That version is no longer open — showing Production.';
const VERSION_DELETED_TEXT = 'This version was deleted — showing Production.';
const VERSION_UNAVAILABLE_TEXT = 'This version is no longer available to you — showing Production.';

/** ¿El error lo respondió el BACKEND? FastAPI siempre manda `detail`; el proxy
 *  de Databricks o una página HTML no (http.ts: «Invalid JSON response», detail
 *  null). El 404 con detail «Not Found» es el genérico de una ruta que el
 *  backend no tiene (p. ej. front desplegado antes que el back), no la versión. */
const fromBackend = (err: ApiError): boolean => err.detail != null && !(err.status === 404 && err.detail === 'Not Found');

/** Doc 105 (A5-o4): 403/404 del backend al leer la versión elegida = se
 *  transfirió a otra persona o se eliminó (en otra pestaña o por un admin). El
 *  `detail` del backend es el del canvas; acá se dice qué pasó. null = otro
 *  error — también un 403/404 de infraestructura, que no es de la versión. */
export function versionGoneText(err: unknown): string | null {
  if (!(err instanceof ApiError) || !fromBackend(err)) return null;
  if (err.status === 404) return VERSION_DELETED_TEXT;
  if (err.status === 403) return VERSION_UNAVAILABLE_TEXT;
  return null;
}

/** Doc 105 (A5-o4 por foco): la versión elegida ya no está entre MIS versiones
 *  abiertas al re-listar — por qué, según su cabecera (`GET /changesets/{id}`) o
 *  el error al leerla: eliminada (404), ya no tuya (403 u otro dueño: se
 *  transfirió) o publicada/cerrada; si la cabecera no se pudo leer, el de siempre. */
export function vanishedVersionText(
  read: { header: { owner?: string | null; status?: string } } | { error: unknown }, me: string | null | undefined,
): string {
  if ('error' in read) return versionGoneText(read.error) ?? VERSION_CLOSED_TEXT;
  return read.header.owner && read.header.owner !== me ? VERSION_UNAVAILABLE_TEXT : VERSION_CLOSED_TEXT;
}

/** Texto del toast de una lectura fallida: en modo versión, el mapeo de
 *  `versionGoneText`; si no, el mensaje del backend o `fallback`. */
export function readErrorText(err: unknown, fallback: string, versionMode: boolean): string {
  return (versionMode ? versionGoneText(err) : null) ?? (err instanceof Error && err.message ? err.message : fallback);
}
