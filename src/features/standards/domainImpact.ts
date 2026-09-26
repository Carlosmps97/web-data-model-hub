/**
 * domainImpact — lógica pura del popup de cascada y del panel de un Parent
 * Domain (docs F2 #2 · 95 D7). Separada de DomainsPage para testearla sin JSX.
 */
import type { DomainColumnImpact, DomainColumnImpactRow, DomainColumnStatus } from '@/services/naming.service';

const fmt = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

export interface TypeTargets { physicalTo?: string; logicalTo?: string }

/** Tipos que el borrador CAMBIA — física y/o lógica (antes solo se miraba la física). */
export function typeTargets(
  before: { defaultDataType: string; logicalDataType?: string | null } | null,
  form: { defaultDataType: string; logicalDataType?: string | null },
): TypeTargets {
  if (!before) return {};
  const out: TypeTargets = {};
  const p = form.defaultDataType.trim();
  if (p && p !== before.defaultDataType) out.physicalTo = p;
  const l = (form.logicalDataType ?? '').trim();
  if (l && l !== (before.logicalDataType ?? '')) out.logicalTo = l;
  return out;
}

/** Banner exacto del popup: cuántas se re-tipan y cuántas se saltan (y por qué). */
export function impactBanner(i: DomainColumnImpact): string {
  const t = i.totals;
  return `${plural(t.change, 'column', 'columns')} in ${plural(t.changeTables, 'table', 'tables')} across `
    + `${plural(t.models, 'data model', 'data models')} will be re-typed · ${fmt(t.override)} skipped (override) · `
    + `${fmt(t.differs)} skipped (type already differs)`;
}

/** Panel del dominio (sin cambio pendiente): quién lo sigue hoy. */
export function usageLines(i: DomainColumnImpact): { headline: string; follow: string; override: string; differs: string } {
  const t = i.totals;
  return {
    headline: `Used by ${plural(t.columns, 'column', 'columns')} in ${plural(t.tables, 'table', 'tables')} `
      + `across ${plural(t.models, 'data model', 'data models')}.`,
    follow: `${fmt(t.change)} follow the domain`,
    override: `${fmt(t.override)} overridden (skipped)`,
    differs: `${fmt(t.differs)} with another type (skipped)`,
  };
}

export const STATUS_LABEL: Record<DomainColumnStatus, string> = {
  change: 'Will change', override: 'Skipped · override', differs: 'Skipped · type differs',
};

/** Líneas «antes → después» por faceta que cambia (tipos ya homologados por el backend). */
export function typeChanges(i: Pick<DomainColumnImpact, 'domain' | 'targets'>): string[] {
  const out: string[] = [];
  if (i.targets.physical) out.push(`Physical: ${i.domain.physical ?? '—'} → ${i.targets.physical}`);
  if (i.targets.logical) out.push(`Logical: ${i.domain.logical ?? '—'} → ${i.targets.logical}`);
  return out;
}

/** Celda de tipo: «actual → nuevo» si esa faceta cambia en la fila; si no, el actual. */
export function typeCell(row: DomainColumnImpactRow, facet: 'physical' | 'logical',
                         targets: DomainColumnImpact['targets']): string {
  const current = (facet === 'physical' ? row.physicalType : row.logicalType) ?? '—';
  const next = targets[facet];
  return row[facet] === 'change' && next ? `${current} → ${next}` : current;
}

/** Etiqueta esquema.tabla (sin esquema → solo la tabla). */
export const tableLabel = (r: { schema: string | null; table: string }): string =>
  (r.schema ? `${r.schema}.${r.table}` : r.table);
