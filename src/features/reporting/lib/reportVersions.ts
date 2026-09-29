/**
 * Doc 102 (D1): versión del Reporting — producción o una versión PROPIA sin
 * publicar (borrador o en revisión) del proyecto. Funciones puras del combo
 * Version y del nombre del Excel por niveles.
 */
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
