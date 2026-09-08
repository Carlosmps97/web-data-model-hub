import type { Project } from '@/types/model';
import type { VersionRow } from '@/types/versioning';

/** Producción actual y drafts propios de un proyecto (doc 75 D8). */
export interface ProjectMeta {
  /** Etiqueta de la producción vigente (approved + applied más reciente) o null. */
  production: string | null;
  /** Fila de esa producción (para abrir en solo lectura). */
  productionRow: VersionRow | null;
  /** Working copies del actor en ese proyecto. */
  drafts: number;
}

const collator = new Intl.Collator('en', { sensitivity: 'base' });

/** A–Z sin distinguir mayúsculas ni tildes. Puro; no muta la entrada. */
export function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => collator.compare(a.name, b.name));
}

/** Producción + drafts por `projectId` a partir de la lista de versiones. Puro. */
export function projectMeta(versions: VersionRow[], me: string | null): Record<string, ProjectMeta> {
  const out: Record<string, ProjectMeta> = {};
  for (const v of versions) {
    const m = (out[v.projectId] ??= { production: null, productionRow: null, drafts: 0 });
    if (v.status === 'approved' && v.appliedAt) {
      if (!m.productionRow || (v.appliedAt > (m.productionRow.appliedAt ?? ''))) {
        m.productionRow = v;
        m.production = v.versionLabel;
      }
    } else if (v.status === 'draft' && me && v.owner === me) {
      m.drafts += 1;
    }
  }
  return out;
}
