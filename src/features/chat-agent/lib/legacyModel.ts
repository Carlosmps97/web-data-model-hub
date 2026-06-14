// ─────────────────────────────────────────────────────────────────────────
//  Tipos de modelo "legacy" CONGELADOS para el mapper del agente IA.
//
//  La app principal migró al esquema project-centric (`@/types/model`:
//  `Table`, `Relationship` anidado, etc.). El agente IA está **desacoplado**
//  y pendiente de reescritura para el nuevo esquema. Para que `mapping.ts`
//  siga compilando sin tocar su lógica, conserva aquí la forma antigua que
//  esperaba (`TableModel`, `Relationship` plano).
//
//  ⚠️ Al reescribir el agente para el nuevo esquema, elimina este archivo y
//  repunta `mapping.ts` a `@/types/model` + `@/lib/columnRef`.
// ─────────────────────────────────────────────────────────────────────────

import type { TableColumn } from '@/types/model';

export type { TableColumn } from '@/types/model';

/** Engine union extendido con los alias legacy que el switch del mapper aún cubre. */
export type DatabaseEngine =
  | 'postgresql' | 'databricks_sql' | 'sqlserver' | 'mysql' | 'cosmosdb'
  | 'databricks' | 'oracle';

export interface TableModel {
  id: string;
  schema?: string;
  name: string;
  logicalName?: string;
  columns: TableColumn[];
  functionalDefinition?: string;
  color?: string;
  domain?: string;
  subdomain?: string;
}

export interface Relationship {
  id: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

/** Versión local de `findColumnId` (la del repo migró a la firma `Table[]`). */
export function findColumnId(tables: TableModel[], tableRef: string, columnName: string): string | null {
  const t = tables.find((x) => x.id === tableRef) ?? tables.find((x) => x.name === tableRef);
  if (!t) return null;
  return t.columns.find((c) => c.name === columnName)?.id ?? null;
}
