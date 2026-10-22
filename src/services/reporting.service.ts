// Servicio de Reporting: metadata tabular de solo lectura para la pantalla
// Reporting: filas por tabla + filas por columna para la grilla en pantalla y
// el export a Excel. El backend devuelve el envelope `{ success, data }`, que
// `apiGet` ya desempaqueta; estos helpers solo dan tipos y arman las URLs.
//
// Todo reporte es de un solo proyecto (`projectId` obligatorio en cada
// lectura).
//   GET /api/reporting/tables?projectId=&schema=   → ReportTableRow[]
//   GET /api/reporting/columns?projectId=&tableId= → ReportColumnRow[] (sin id = todas)
//   POST /api/reporting/columns/query · /views/query · /insights/relationships/query
//        → lotes de ids en el cuerpo
// `changesetId` = una versión propia sin publicar (sin él, producción).

import { apiGet, apiPost } from './http';

import { API_BASE } from '@/services/apiBase';

/** Una fila de tabla en la grilla del reporte (metadata a nivel de tabla). */
export interface ReportTableRow {
  id: string;
  physicalName: string;
  logicalName: string;
  schema: string;
  /** Subject areas = carpetas que contienen los canvases de esta tabla (p. ej.
   *  las subcarpetas de un sub-proyecto), presentadas como chips. */
  subjectAreas: string[];
  /** Nombres de los canvases (diagramas) que contienen la tabla. */
  diagrams?: string[];
  /** Carpetas raíz (sub-proyecto) de esos canvases. Campo «Space» de las
   *  plantillas. */
  spaces?: string[];
  columnCount: number;
  relationshipCount: number;
  /** Nombre del proyecto del reporte (columna de la hoja exportada). */
  projects: string[];
  /** UDPs de la tabla ya traducidos a {nombre de la def: valor} (export). */
  udpValues?: Record<string, string>;
  description: string;
  /** Metadata completa. */
  physicalNameOverridden?: boolean;
  logicalOnly?: boolean;
  physicalOnly?: boolean;
}

/** Una fila de columna (metadata a nivel de campo), usada en la hoja "Columns detail". */
export interface ReportColumnRow {
  /** Id de la columna (join con el catálogo). */
  id?: string;
  tableId: string;
  physicalName: string;
  logicalName: string;
  dataType: string;
  /** Faceta lógica del tipo (null = no informado). */
  logicalDataType?: string | null;
  /** Comment físico (Erwin Comment). */
  physicalDescription?: string | null;
  parentDomain?: string;
  parentDomainId?: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isNullable: boolean;
  isPartition: boolean;
  /** UDPs de la columna ya traducidos a {nombre de la def: valor} (export). */
  udpValues?: Record<string, string>;
  description: string;
  ordinal: number;
  /** Metadata completa. */
  typeOverridden?: boolean;
  logicalTypeOverridden?: boolean;
  physicalNameOverridden?: boolean;
  logicalOnly?: boolean;
  physicalOnly?: boolean;
}

/** Universo completo de los filtros del reporte tabular: no
 *  depende de las filas cargadas en la grilla. */
export interface ReportFilterOptions {
  schemas: string[];
  subjectAreas: string[];
}

/** `projectId` siempre y `changesetId` solo con una versión propia
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

/** Una fila de vista para las hojas "Views detail": fuentes resueltas + detalle
 *  por columna del editor de vistas (alias, origen, cast, expresión). */
export interface ReportViewRow {
  id: string;
  schema?: string | null;
  name: string;
  sourceTableIds: string[];
  /** Fuentes resueltas a `schema.tabla` legible. */
  sourceTables: string[];
  showOnCanvas: boolean;
  /** Canvases donde la vista es miembro (nombres). */
  canvases?: string[];
  description?: string | null;
  sql?: string | null;
  /** User-Defined SQL: texto informativo (el DDL sale de las columnas). */
  customSql?: string | null;
  columns: Array<{
    outputAlias?: string | null;
    sourceTable?: string | null;
    sourceColumn?: string | null;
    castType?: string | null;
    expression?: string | null;
  }>;
}

/** Filtros server-side opcionales de la lista de tablas. Los valores vacíos se omiten. */
export interface ReportTableFilters {
  schema?: string;
  /** Tope de filas (carga inicial más liviana). */
  limit?: number;
  /** Página del scroll infinito (solo sin filtros, orden físico). */
  offset?: number;
}

/** Lista las filas de reporte por tabla del proyecto, opcionalmente acotadas por esquema. */
export function listReportTables(projectId: string, filters: ReportTableFilters = {}, changesetId?: string | null): Promise<ReportTableRow[]> {
  const qs = new URLSearchParams();
  if (filters.schema) qs.set('schema', filters.schema);
  if (filters.limit != null) qs.set('limit', String(filters.limit));
  if (filters.offset) qs.set('offset', String(filters.offset));
  return apiGet<ReportTableRow[]>(`${API_BASE}/api/reporting/tables${withScope(projectId, qs, changesetId)}`);
}

/** Total de tablas activas del proyecto (conteo real de la barra y
 *  del Select all, aunque la grilla tenga cargada solo una página). */
export function countReportTables(projectId: string, changesetId?: string | null): Promise<number> {
  return apiGet<{ total: number }>(`${API_BASE}/api/reporting/tables/count${withScope(projectId, new URLSearchParams(), changesetId)}`)
    .then((r) => r.total);
}

/** Columnas de una tabla (Database Explorer en producción). Los lotes van por
 *  `queryReportColumns`. */
export function listReportColumns(projectId: string, tableId?: string): Promise<ReportColumnRow[]> {
  const qs = new URLSearchParams();
  if (tableId) qs.set('tableId', tableId);
  return apiGet<ReportColumnRow[]>(`${API_BASE}/api/reporting/columns${withScope(projectId, qs)}`);
}

/** Cuerpo de un lote: los ids viajan en el cuerpo; en la URL, 300 uuid
 *  (~12 KB) más las cabeceras de Databricks superarían el tope de 16 KB del
 *  servidor del front y la respuesta sería un 431 sin cuerpo. */
const lotBody = (projectId: string, tableIds: string[], changesetId?: string | null) =>
  (changesetId ? { projectId, tableIds, changesetId } : { projectId, tableIds });

/** `POST /api/reporting/columns/query`: columnas de un lote de tablas. */
export function queryReportColumns(projectId: string, tableIds: string[], changesetId?: string | null): Promise<ReportColumnRow[]> {
  if (tableIds.length === 0) return Promise.resolve([]);
  return apiPost<ReportColumnRow[]>(`${API_BASE}/api/reporting/columns/query`, lotBody(projectId, tableIds, changesetId));
}

/** `POST /api/reporting/views/query`: vistas derivadas de un lote de tablas. */
export function queryReportViews(projectId: string, tableIds: string[], changesetId?: string | null): Promise<ReportViewRow[]> {
  if (tableIds.length === 0) return Promise.resolve([]);
  return apiPost<ReportViewRow[]>(`${API_BASE}/api/reporting/views/query`, lotBody(projectId, tableIds, changesetId));
}

/** Una fila de la hoja Relationships del export por niveles. */
export interface RelationshipRow {
  /** Una fila por par de columnas: una FK compuesta repite `id` con
   *  `pairIndex` incremental. parent = lado PK, child = lado FK. */
  id: string; pairIndex?: number; pairCount?: number;
  parent: string; parentSchema?: string; child: string; childSchema?: string;
  parentTableId?: string; childTableId?: string;
  parentTable?: string; parentColumn?: string; childTable?: string; childColumn?: string;
  roleName?: string | null;
  /** Frases de la relación (se repiten en cada fila de par). */
  parentToChildPhrase?: string | null;
  childToParentPhrase?: string | null;
  cardinality: string; identifying: boolean; isSelfReferencing: boolean; crossSchema: boolean; label: string;
}

/** `POST /api/reporting/insights/relationships/query`: las filas de la hoja
 *  Relationships (una por par de columnas), solo de las relaciones con el padre
 *  o el hijo en el lote de tablas (1..300 ids en el cuerpo). Con `changesetId`,
 *  las de una versión propia sin publicar. Los lotes los arma
 *  `fetchRelationshipsFor`. */
export function queryRelationshipsReport(projectId: string, tableIds: string[], changesetId?: string | null): Promise<RelationshipRow[]> {
  return apiPost<RelationshipRow[]>(`${API_BASE}/api/reporting/insights/relationships/query`, lotBody(projectId, tableIds, changesetId));
}
