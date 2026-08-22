/**
 * domainImpact — lógica pura del warning de impacto de Parent Domain (F2 #2).
 * Separada de DomainsPage para testearla con vitest sin montar JSX.
 */
import type { DomainImpact, DomainImpactTable } from '@/services/naming.service';

/** Warning explícito del dialog de confirmación (spec #2). Usa números
 *  GLOBALES: willUpdate (las columnas que realmente cambian), totalTables y
 *  modelsAffected del impact SIN filtro q. */
export function impactWarning(i: DomainImpact): string {
  return `This change will affect ${i.willUpdate} columns in ${i.totalTables} tables across ${i.modelsAffected} data models`;
}

/** Filas visibles según el toggle "ver columnas con override": ON = solo
 *  tablas que tienen columnas con override manual (que NO cambiarán). */
export function visibleImpactTables(
  tables: DomainImpactTable[],
  overriddenOnly: boolean,
): DomainImpactTable[] {
  return overriddenOnly ? tables.filter((t) => t.overridden > 0) : tables;
}

/** Etiqueta esquema.tabla de una fila (sin esquema → solo la tabla). */
export function tableLabel(t: DomainImpactTable): string {
  return t.schema ? `${t.schema}.${t.physicalName}` : t.physicalName;
}
