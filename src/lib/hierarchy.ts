// Hierarchy + scope helpers — ported from the redesign prototype
// (`newStyleWeb/Redesign/app/data.js` + `editor.jsx`). Pure functions over
// the project's `layers` (ModelLevels) and `domains`.

import type { ModelLevel, Domain, Table, Relationship, Project } from '@/types/model';

// ─── Layer (model level) lookups ─────────────────────────────────────────────

export function layerOrderMap(layers: ModelLevel[]): Record<string, number> {
  const m: Record<string, number> = {};
  layers.forEach((l, i) => { m[l.id] = l.order != null ? l.order : i; });
  return m;
}

export function findLayer(layers: ModelLevel[], id?: string | null): ModelLevel | undefined {
  return id ? layers.find((l) => l.id === id) : undefined;
}

export function layerName(layers: ModelLevel[], id?: string | null): string {
  return findLayer(layers, id)?.name ?? id ?? '—';
}

export function layerColor(layers: ModelLevel[], id?: string | null): string {
  return findLayer(layers, id)?.color ?? 'var(--muted)';
}

/**
 * Layer distance for cross-layer detection: 0 same/unknown, 1 adjacent
 * (cross-layer), ≥2 skip (non-adjacent → warning). Mirrors `data.js::layerGap`.
 */
export function layerGap(layers: ModelLevel[], a?: string | null, b?: string | null): number {
  if (!a || !b) return 0;
  const m = layerOrderMap(layers);
  const x = m[a];
  const y = m[b];
  if (x == null || y == null) return 0;
  return Math.abs(x - y);
}

// ─── Domain lookups ──────────────────────────────────────────────────────────

export function findDomain(domains: Domain[], id?: string | null): Domain | undefined {
  return id ? domains.find((d) => d.id === id) : undefined;
}

export function domainName(domains: Domain[], id?: string | null): string {
  return findDomain(domains, id)?.name ?? id ?? '—';
}

export function domainColor(domains: Domain[], id?: string | null): string {
  return findDomain(domains, id)?.color ?? '#4f46e5';
}

// ─── Relationship derived flags ──────────────────────────────────────────────

export function tablesById(tables: Table[]): Record<string, Table> {
  const m: Record<string, Table> = {};
  for (const t of tables) m[t.id] = t;
  return m;
}

/** Derive `crossLayer` / `skip` for a relationship from the layer order. */
export function deriveRelFlags(
  rel: Relationship,
  byId: Record<string, Table>,
  layers: ModelLevel[],
): { crossLayer: boolean; skip: boolean } {
  const s = byId[rel.source.table];
  const t = byId[rel.target.table];
  const gap = layerGap(layers, s?.layer, t?.layer);
  return { crossLayer: gap > 0, skip: gap > 1 };
}

// ─── Scope (editing safety boundary) ─────────────────────────────────────────

export interface Scope {
  layers: string[];
  domains: string[];
}

export function fullScope(project: Pick<Project, 'layers' | 'domains'>): Scope {
  return {
    layers: project.layers.map((l) => l.id),
    domains: project.domains.map((d) => d.id),
  };
}

/**
 * Whether a table is inside the current scope. Tables with no layer/domain are
 * only visible when the corresponding axis is fully selected. Mirrors
 * `editor.jsx::inScope`.
 */
export function isTableInScope(
  t: Table,
  scope: Scope,
  allLayerCount: number,
  allDomainCount: number,
): boolean {
  const layerOk =
    scope.layers.includes(t.layer ?? '') ||
    (!t.layer && scope.layers.length === allLayerCount);
  const domainOk =
    scope.domains.includes(t.domain ?? '') ||
    (!t.domain && scope.domains.length === allDomainCount);
  return layerOk && domainOk;
}

/** Human label for the current scope, e.g. "Todo el modelo" / "RDV" / "Finanzas (vertical)". */
export function scopeLabel(project: Pick<Project, 'layers' | 'domains'>, scope: Scope): string {
  const fullL = scope.layers.length === project.layers.length;
  const fullD = scope.domains.length === project.domains.length;
  if (fullL && fullD) return 'Todo el modelo';
  if (fullD && scope.layers.length === 1) return layerName(project.layers, scope.layers[0]);
  if (fullL && scope.domains.length === 1) return `${domainName(project.domains, scope.domains[0])} (vertical)`;
  const lPart = fullL ? 'Todos los modelos' : `${scope.layers.length} modelos`;
  const dPart = fullD ? 'todos los dominios' : `${scope.domains.length} dom.`;
  return `${lPart} · ${dPart}`;
}
