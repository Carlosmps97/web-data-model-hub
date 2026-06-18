// Pure catalog model for the Model Center: the cross-project, flattened view of
// every table/view/column, plus the helpers that build it. No React here.

import { normalizeTags } from '@/lib/tags';
import type { Project, Table, DatabaseEngine, Tag } from '@/types/model';

// ── One row per table, flattened across all projects ────────────────────────
export interface ColRow { name: string; dataType: string; key: '' | 'PK' | 'FK' | 'SK' | 'PT'; def: string; tags: Tag[] }
export interface ViewRow { name: string; type: string; role: string }
export interface CatalogRow {
  projectId: string; project: string;
  layerId: string; model: string; layerColor: string;
  engine?: DatabaseEngine;
  schema: string; table: string;
  domainId: string; domainName: string; domainColor: string;
  owner: string;
  columns: ColRow[]; views: ViewRow[]; fkCount: number; tags: Tag[];
}

export type Tab = 'overview' | 'tables' | 'views' | 'columns' | 'metadata';
export type Selection =
  | { kind: 'table'; row: CatalogRow }
  | { kind: 'view'; row: CatalogRow; view: ViewRow }
  | null;

export const PII = /email|phone|ssn|dni|passport|card|tax|address|documento|tel[eé]fono|correo|nombre/i;

// Governance severity → number color (badge styling lives in CSS `.sev-*`).
export const GOV_SEV_COLOR: Record<'medium' | 'info' | 'critical', string> = {
  medium: 'var(--warning)', info: 'var(--ink-2)', critical: 'var(--error)',
};

export function keyOf(c: { isPrimaryKey?: boolean; isForeignKey?: boolean; isSurrogateKey?: boolean; isPartitionKey?: boolean }): ColRow['key'] {
  if (c.isPrimaryKey) return 'PK';
  if (c.isForeignKey) return 'FK';
  if (c.isSurrogateKey) return 'SK';
  if (c.isPartitionKey) return 'PT';
  return '';
}

export function buildCatalog(project: Project, tables: Table[]): CatalogRow[] {
  const layerById = new Map(project.layers.map((l) => [l.id, l]));
  const domainById = new Map(project.domains.map((d) => [d.id, d]));
  return tables.map((t) => {
    const layer = t.layer ? layerById.get(t.layer) : undefined;
    const domain = t.domain ? domainById.get(t.domain) : undefined;
    return {
      projectId: project.id, project: project.name,
      layerId: t.layer ?? '', model: layer?.name ?? '—', layerColor: layer?.color ?? '#99a1ae',
      engine: (layer?.engine ?? project.engines[0]) as DatabaseEngine | undefined,
      schema: t.schema ?? '', table: t.name,
      domainId: t.domain ?? '', domainName: domain?.name ?? '', domainColor: domain?.color ?? '#99a1ae',
      owner: domain?.owner ?? '',
      columns: (t.columns ?? []).map((c) => ({ name: c.name, dataType: c.dataType, key: keyOf(c), def: c.functionalDefinition ?? '', tags: normalizeTags(c.tags) ?? [] })),
      views: (t.views ?? []).map((v) => ({ name: v.name, type: v.type, role: v.role ?? '—' })),
      fkCount: (t.columns ?? []).filter((c) => c.isForeignKey).length,
      tags: normalizeTags(t.tags) ?? [],
    };
  });
}
