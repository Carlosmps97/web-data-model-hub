// Reporting service (R6c). Read-only tabular metadata for Screen 11 (Reporting):
// table-level rows + column-level rows for the on-screen grid and the Excel
// export. The backend returns the `{ success, data }` envelope, which
// `apiGet` already unwraps; these helpers only give types and build the URLs.
//
// Endpoints (per R1c contract):
//   GET /api/reporting/tables?schema=&projectId=  → ReportTableRow[]
//   GET /api/reporting/columns?tableId=           → ReportColumnRow[] (no id = all)

import { apiGet } from './http';

import { API_BASE } from '@/services/apiBase';

/** One table row in the reporting grid (table-level metadata). */
export interface ReportTableRow {
  id: string;
  physicalName: string;
  logicalName: string;
  schema: string;
  /** Subject area names this table belongs to (rendered as chips). */
  subjectAreas: string[];
  columnCount: number;
  relationshipCount: number;
  /** Project names this table is referenced by (rendered as chips). */
  projects: string[];
  /** UDPs de la tabla ya traducidos a {NOMBRE de la def: valor} (export). */
  udpValues?: Record<string, string>;
  description: string;
}

/** One column row (field-level metadata), used for the "Columns detail" sheet. */
export interface ReportColumnRow {
  tableId: string;
  physicalName: string;
  logicalName: string;
  dataType: string;
  parentDomain?: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isNullable: boolean;
  isPartition: boolean;
  /** UDPs de la columna ya traducidos a {NOMBRE de la def: valor} (export). */
  udpValues?: Record<string, string>;
  description: string;
  ordinal: number;
}

/** One view row for the "Views detail" sheets: resolved sources + per-column
 *  detail from the view editor (alias, origin, cast, expression). */
export interface ReportViewRow {
  id: string;
  schema?: string | null;
  name: string;
  sourceTableIds: string[];
  /** Fuentes resueltas a `schema.tabla` legible. */
  sourceTables: string[];
  /** WHERE de la vista (si tiene). */
  filter?: string | null;
  /** Condición de JOIN manual (multi-fuente). */
  joinOverride?: string | null;
  showOnCanvas: boolean;
  description?: string | null;
  sql?: string | null;
  columns: Array<{
    outputAlias?: string | null;
    sourceTable?: string | null;
    sourceColumn?: string | null;
    castType?: string | null;
    expression?: string | null;
  }>;
}

/** Optional server-side filters for the table list. Empty values are omitted. */
export interface ReportTableFilters {
  schema?: string;
  projectId?: string;
  /** Cap the number of rows (lighter initial load). */
  limit?: number;
}

/** Lists table-level reporting rows, optionally narrowed by schema / project. */
export function listReportTables(filters: ReportTableFilters = {}): Promise<ReportTableRow[]> {
  const qs = new URLSearchParams();
  if (filters.schema) qs.set('schema', filters.schema);
  if (filters.projectId) qs.set('projectId', filters.projectId);
  if (filters.limit != null) qs.set('limit', String(filters.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet<ReportTableRow[]>(`${API_BASE}/api/reporting/tables${suffix}`);
}

/** Lists column-level reporting rows. Pass `tableIds` to scope the export to a
 *  batch of tables (server-side `$in`); omit both to get every column. */
export function listReportColumns(tableId?: string, tableIds?: string[]): Promise<ReportColumnRow[]> {
  const qs = new URLSearchParams();
  if (tableIds?.length) qs.set('tableIds', tableIds.join(','));
  else if (tableId) qs.set('tableId', tableId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet<ReportColumnRow[]>(`${API_BASE}/api/reporting/columns${suffix}`);
}

/** Lists view rows for the export. Pass `tableIds` to scope to the views
 *  derived from those tables (server-side `$in` over sourceTableIds), or
 *  `schema` to scope to one schema (Database Explorer, doc 18). */
export function listReportViews(tableIds?: string[], schema?: string): Promise<ReportViewRow[]> {
  const qs = new URLSearchParams();
  if (tableIds?.length) qs.set('tableIds', tableIds.join(','));
  if (schema) qs.set('schema', schema);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet<ReportViewRow[]>(`${API_BASE}/api/reporting/views${suffix}`);
}
