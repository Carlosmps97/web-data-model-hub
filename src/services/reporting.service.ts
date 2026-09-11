// Reporting service (R6c). Read-only tabular metadata for Screen 11 (Reporting):
// table-level rows + column-level rows for the on-screen grid and the Excel
// export. The backend returns the `{ success, data }` envelope, which
// `apiGet` already unwraps; these helpers only give types and build the URLs.
//
// Doc 75: todo reporte es de UN proyecto (`projectId` obligatorio en cada
// lectura).
//   GET /api/reporting/tables?projectId=&schema=   → ReportTableRow[]
//   GET /api/reporting/columns?projectId=&tableId= → ReportColumnRow[] (no id = all)

import { apiGet } from './http';

import { API_BASE } from '@/services/apiBase';

/** One table row in the reporting grid (table-level metadata). */
export interface ReportTableRow {
  id: string;
  physicalName: string;
  logicalName: string;
  schema: string;
  /** Doc 88 §7: subject areas = FOLDERS that contain the canvases of this
   *  table (DDV: the children of CPYBCA/Otros), rendered as chips. */
  subjectAreas: string[];
  /** Doc 88 §7: names of the canvases (diagrams) that contain the table. */
  diagrams?: string[];
  columnCount: number;
  relationshipCount: number;
  /** Nombre del proyecto del reporte (columna de la hoja exportada). */
  projects: string[];
  /** UDPs de la tabla ya traducidos a {NOMBRE de la def: valor} (export). */
  udpValues?: Record<string, string>;
  description: string;
  /** Doc 70 §4.2 — metadata completa (docs 68/69). */
  physicalNameOverridden?: boolean;
  logicalOnly?: boolean;
  physicalOnly?: boolean;
}

/** One column row (field-level metadata), used for the "Columns detail" sheet. */
export interface ReportColumnRow {
  /** Doc 70: id de la columna (join con el catálogo). */
  id?: string;
  tableId: string;
  physicalName: string;
  logicalName: string;
  dataType: string;
  /** Doc 69: faceta lógica del tipo (null = no informado). */
  logicalDataType?: string | null;
  /** Doc 85: comment físico (Erwin Comment). */
  physicalDescription?: string | null;
  parentDomain?: string;
  parentDomainId?: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isNullable: boolean;
  isPartition: boolean;
  /** UDPs de la columna ya traducidos a {NOMBRE de la def: valor} (export). */
  udpValues?: Record<string, string>;
  description: string;
  ordinal: number;
  /** Doc 70 §4.2 — metadata completa (docs 19/68/69). */
  pkPosition?: number | null;
  typeOverridden?: boolean;
  logicalTypeOverridden?: boolean;
  physicalNameOverridden?: boolean;
  logicalOnly?: boolean;
  physicalOnly?: boolean;
}

/** Universo COMPLETO de los filtros del reporte tabular (doc 70 §4.1) — no
 *  depende de las filas cargadas en la grilla. */
export interface ReportFilterOptions {
  schemas: string[];
  subjectAreas: string[];
}

const withProject = (projectId: string, qs: URLSearchParams): string => {
  qs.set('projectId', projectId);
  return `?${qs.toString()}`;
};

/** `GET /api/reporting/filters` — esquemas de tablas activas y canvases del
 *  proyecto, sin tope. */
export function listReportFilters(projectId: string): Promise<ReportFilterOptions> {
  return apiGet<ReportFilterOptions>(`${API_BASE}/api/reporting/filters${withProject(projectId, new URLSearchParams())}`);
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
  /** Doc 70: canvases donde la vista es miembro (nombres). */
  canvases?: string[];
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
  /** Cap the number of rows (lighter initial load). */
  limit?: number;
}

/** Lists the project's table-level reporting rows, optionally narrowed by schema. */
export function listReportTables(projectId: string, filters: ReportTableFilters = {}): Promise<ReportTableRow[]> {
  const qs = new URLSearchParams();
  if (filters.schema) qs.set('schema', filters.schema);
  if (filters.limit != null) qs.set('limit', String(filters.limit));
  return apiGet<ReportTableRow[]>(`${API_BASE}/api/reporting/tables${withProject(projectId, qs)}`);
}

/** Lists the project's column-level reporting rows. Pass `tableIds` to scope
 *  the export to a batch of tables (server-side `$in`); omit both to get every
 *  column (server-side cap). */
export function listReportColumns(projectId: string, tableId?: string, tableIds?: string[]): Promise<ReportColumnRow[]> {
  const qs = new URLSearchParams();
  if (tableIds?.length) qs.set('tableIds', tableIds.join(','));
  else if (tableId) qs.set('tableId', tableId);
  return apiGet<ReportColumnRow[]>(`${API_BASE}/api/reporting/columns${withProject(projectId, qs)}`);
}

/** Lists the project's view rows for the export. Pass `tableIds` to scope to
 *  the views derived from those tables (server-side `$in` over
 *  sourceTableIds), or `schema` to scope to one schema (Database Explorer). */
export function listReportViews(projectId: string, tableIds?: string[], schema?: string): Promise<ReportViewRow[]> {
  const qs = new URLSearchParams();
  if (tableIds?.length) qs.set('tableIds', tableIds.join(','));
  if (schema) qs.set('schema', schema);
  return apiGet<ReportViewRow[]>(`${API_BASE}/api/reporting/views${withProject(projectId, qs)}`);
}
