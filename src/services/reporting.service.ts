// Reporting service (R6c). Read-only tabular metadata for Screen 11 (Reporting):
// table-level rows + column-level rows for the on-screen grid and the Excel
// export. The backend returns the `{ success, data }` envelope, which
// `apiGet` already unwraps; these helpers only give types and build the URLs.
//
// Doc 75: todo reporte es de UN proyecto (`projectId` obligatorio en cada
// lectura).
//   GET /api/reporting/tables?projectId=&schema=   → ReportTableRow[]
//   GET /api/reporting/columns?projectId=&tableId= → ReportColumnRow[] (no id = all)
//   POST /api/reporting/columns/query · /views/query · /insights/relationships/query
//        → lotes de ids en el CUERPO (doc 102)
// Doc 102: `changesetId` = una versión PROPIA sin publicar (sin él, producción).

import { apiGet, apiPost } from './http';

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
  /** Doc 102: carpetas RAÍZ (sub-proyecto) de esos canvases — MODELO DDV:
   *  «CPYBCA» / «Otros». Campo «Space» de las plantillas. */
  spaces?: string[];
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

/** Doc 102: `projectId` siempre y `changesetId` solo con una versión PROPIA
 *  sin publicar (sin él, producción). */
const withScope = (projectId: string, qs: URLSearchParams, changesetId?: string | null): string => {
  qs.set('projectId', projectId);
  if (changesetId) qs.set('changesetId', changesetId);
  return `?${qs.toString()}`;
};

/** `GET /api/reporting/filters` — esquemas de tablas activas y canvases del
 *  proyecto (o de la versión propia), sin tope. */
export function listReportFilters(projectId: string, changesetId?: string | null): Promise<ReportFilterOptions> {
  return apiGet<ReportFilterOptions>(`${API_BASE}/api/reporting/filters${withScope(projectId, new URLSearchParams(), changesetId)}`);
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
  showOnCanvas: boolean;
  /** Doc 70: canvases donde la vista es miembro (nombres). */
  canvases?: string[];
  description?: string | null;
  sql?: string | null;
  /** Doc 96 D6: User-Defined SQL — texto informativo (el DDL sale de las columnas). */
  customSql?: string | null;
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
  /** Doc 92 D3: página del scroll infinito (sólo sin filtros, orden físico). */
  offset?: number;
}

/** Lists the project's table-level reporting rows, optionally narrowed by schema. */
export function listReportTables(projectId: string, filters: ReportTableFilters = {}, changesetId?: string | null): Promise<ReportTableRow[]> {
  const qs = new URLSearchParams();
  if (filters.schema) qs.set('schema', filters.schema);
  if (filters.limit != null) qs.set('limit', String(filters.limit));
  if (filters.offset) qs.set('offset', String(filters.offset));
  return apiGet<ReportTableRow[]>(`${API_BASE}/api/reporting/tables${withScope(projectId, qs, changesetId)}`);
}

/** Doc 92 D4: total de tablas activas del proyecto (conteo real de la barra y
 *  del Select all, aunque la grilla tenga cargada sólo una página). */
export function countReportTables(projectId: string, changesetId?: string | null): Promise<number> {
  return apiGet<{ total: number }>(`${API_BASE}/api/reporting/tables/count${withScope(projectId, new URLSearchParams(), changesetId)}`)
    .then((r) => r.total);
}

/** Columnas de UNA tabla (Database Explorer en producción). Los LOTES van por
 *  `queryReportColumns` (doc 102). */
export function listReportColumns(projectId: string, tableId?: string): Promise<ReportColumnRow[]> {
  const qs = new URLSearchParams();
  if (tableId) qs.set('tableId', tableId);
  return apiGet<ReportColumnRow[]>(`${API_BASE}/api/reporting/columns${withScope(projectId, qs)}`);
}

/** Cuerpo de un lote (doc 102): los ids viajan en el CUERPO — en la URL, 300
 *  uuid (~12 KB) más las cabeceras de Databricks pasaban el tope de 16 KB del
 *  servidor del front y volvía 431 sin cuerpo. */
const lotBody = (projectId: string, tableIds: string[], changesetId?: string | null) =>
  (changesetId ? { projectId, tableIds, changesetId } : { projectId, tableIds });

/** `POST /api/reporting/columns/query` — columnas de un LOTE de tablas. */
export function queryReportColumns(projectId: string, tableIds: string[], changesetId?: string | null): Promise<ReportColumnRow[]> {
  if (tableIds.length === 0) return Promise.resolve([]);
  return apiPost<ReportColumnRow[]>(`${API_BASE}/api/reporting/columns/query`, lotBody(projectId, tableIds, changesetId));
}

/** `POST /api/reporting/views/query` — vistas derivadas de un LOTE de tablas. */
export function queryReportViews(projectId: string, tableIds: string[], changesetId?: string | null): Promise<ReportViewRow[]> {
  if (tableIds.length === 0) return Promise.resolve([]);
  return apiPost<ReportViewRow[]>(`${API_BASE}/api/reporting/views/query`, lotBody(projectId, tableIds, changesetId));
}

/** Una fila de la hoja Relationships del export por niveles. */
export interface RelationshipRow {
  /** v2 (doc 19): UNA fila POR PAR de columnas — una FK compuesta repite `id`
   *  con `pairIndex` incremental. parent = lado PK, child = lado FK. */
  id: string; pairIndex?: number; pairCount?: number;
  parent: string; parentSchema?: string; child: string; childSchema?: string;
  parentTableId?: string; childTableId?: string;
  parentTable?: string; parentColumn?: string; childTable?: string; childColumn?: string;
  roleName?: string | null;
  /** Doc 98: frases de la RELACIÓN (se repiten en cada fila de par). */
  parentToChildPhrase?: string | null;
  childToParentPhrase?: string | null;
  cardinality: string; identifying: boolean; isSelfReferencing: boolean; crossSchema: boolean; label: string;
}

/** `POST /api/reporting/insights/relationships/query` — las filas de la hoja
 *  Relationships (una por PAR de columnas), sólo de las relaciones con el padre
 *  o el hijo en el LOTE de tablas (1..300 ids en el cuerpo). Con `changesetId`,
 *  las de una versión PROPIA sin publicar (doc 102). Los lotes los arma
 *  `fetchRelationshipsFor`. */
export function queryRelationshipsReport(projectId: string, tableIds: string[], changesetId?: string | null): Promise<RelationshipRow[]> {
  return apiPost<RelationshipRow[]>(`${API_BASE}/api/reporting/insights/relationships/query`, lotBody(projectId, tableIds, changesetId));
}
