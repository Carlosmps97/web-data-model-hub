/**
 * query.service — cliente del motor de consulta del reporting (07). Todo gira
 * alrededor del `ReportSpec` (mismo IR que el backend): lo produce el builder
 * visual Y la caja SQL, y lo consumen la grilla, las queries guardadas y el
 * export. Doc 75: toda consulta, catálogo, faceta, insight y reporte guardado
 * es de UN proyecto (`projectId`).
 */
import { apiGet, apiPost, apiPut, apiDelete } from '@/services/http';

import { API_BASE } from '@/services/apiBase';
const R = `${API_BASE}/api/reporting`;

export type ViewKey = 'columns' | 'tables' | 'relationships' | 'views' | 'view_columns' | 'models';
export type FieldType = 'string' | 'enum' | 'number' | 'boolean' | 'date';
export type Op =
  | 'eq' | 'ne' | 'in' | 'nin' | 'contains' | 'startsWith'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'exists' | 'isnull';

export interface FieldDef {
  key: string; label: string; type: FieldType; ops: Op[];
  sortable: boolean; groupable: boolean; indexed: boolean;
  enumValues: string[] | null; udp: boolean; hydrated: boolean;
  // Campo calculado post-fetch (p.ej. tableCount): el backend lo publica con
  // ops=[]; NO es filtrable ni facetable, solo seleccionable.
  derived?: boolean;
}

/** Campos que el builder de filtros puede ofrecer: los derived (ops=[]) quedan
 *  fuera (el backend los rechaza en where → 422). */
export const isFilterableField = (fd: FieldDef): boolean =>
  !fd.derived && fd.ops.length > 0;

/** ¿Debe dispararse el typeahead server-side (facets) para este campo? Nunca en
 *  derived (valores inútiles); sí en hidratados o facetables conocidos. */
export const shouldFetchFacets = (fd: FieldDef): boolean =>
  !fd.derived && fd.ops.length > 0 && !fd.enumValues &&
  (fd.hydrated || ['schema', 'dataType'].includes(fd.key));

export interface Condition { field: string; op: Op; value?: unknown; }
export interface WhereGroup { op: 'and' | 'or' | 'not'; conditions: (Condition | WhereGroup)[]; }
export interface Aggregation { fn: 'count' | 'countDistinct' | 'sum' | 'avg' | 'min' | 'max'; field?: string | null; as: string; }
export interface OrderBy { field: string; dir: 'asc' | 'desc'; }

export interface ReportSpec {
  /** Proyecto de la consulta (doc 75): el backend lo exige en el spec. */
  projectId: string;
  from: ViewKey;
  select: string[];
  where?: WhereGroup | null;
  groupBy: string[];
  aggregations: Aggregation[];
  orderBy: OrderBy[];
  limit: number;
}

export interface ResultColumn { key: string; label: string; type?: string; udp?: boolean; }
export interface QueryResult {
  rows: Record<string, unknown>[];
  columns: ResultColumn[];
  nextCursor: string | null;
  hasMore: boolean;
  meta: { grouped: boolean; warnings: string[]; scan?: string };
}
export interface SqlValidation { spec: ReportSpec | null; errors: { line: number; col: number; message: string }[]; }
export interface SavedReport { id: string; projectId: string; name: string; description?: string | null; spec: ReportSpec; owner: string; shared: boolean; folderId?: string | null; }
/** Body de alta/edición de un reporte guardado (el spec lleva el mismo proyecto). */
export interface SavedReportBody { projectId: string; name: string; description?: string; spec: ReportSpec; shared?: boolean; }

// ── Vistas curadas / Insights (07 §3) ──
export interface Scorecard {
  tables: number; columns: number;
  tablesWithoutPk: number; tablesWithoutDescription: number; orphanTables: number;
  columnsWithoutDomain: number; columnsWithoutDescription: number; columnsTypeOverridden: number;
  pkColumns: number; fkColumns: number;
  udpFillRateColumn: number; udpFillRateTable: number; completenessScore: number;
}
export interface UdpCoverage {
  defId: string; name: string; level: string; dataType: string; allowedValues: string[]; defaultValue?: string;
  totalEntities: number; setCount: number; missingCount: number; coveragePct: number;
  distinctValueCount: number; valueBreakdown: { value: string; count: number; pct: number }[]; invalidCount: number;
}
export interface DomainUsage {
  domainId: string; name: string; defaultDataType?: string; namingTerm?: string;
  columnCount: number; tableCount: number; overrideCount: number; overridePct: number;
  distinctDataTypes: string[]; isUnused: boolean;
}
export interface GlossaryUsage { term: string; abbrev?: string; scope?: string; columnUsage: number; isUnused: boolean; }
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

const P = (projectId: string) => `projectId=${encodeURIComponent(projectId)}`;

export const getScorecard = (projectId: string) => apiGet<Scorecard>(`${R}/insights/scorecard?${P(projectId)}`);
export const getUdpCoverage = (projectId: string) => apiGet<UdpCoverage[]>(`${R}/insights/udp-coverage?${P(projectId)}`);
export const getDomainUsage = (projectId: string) => apiGet<DomainUsage[]>(`${R}/insights/domain-usage?${P(projectId)}`);
export const getGlossaryUsage = (projectId: string) => apiGet<GlossaryUsage[]>(`${R}/insights/glossary-usage?${P(projectId)}`);
/** Doc 102: con `changesetId`, las relaciones de una versión PROPIA sin publicar. */
export const getRelationshipsReport = (projectId: string, limit = 2000, changesetId?: string | null) =>
  apiGet<RelationshipRow[]>(`${R}/insights/relationships?${P(projectId)}&limit=${limit}${changesetId ? `&changesetId=${encodeURIComponent(changesetId)}` : ''}`);

export const emptySpec = (projectId: string, from: ViewKey = 'columns'): ReportSpec => ({
  projectId, from, select: [], groupBy: [], aggregations: [], orderBy: [], limit: 100, where: { op: 'and', conditions: [] },
});

// ── API ──
export const getCatalog = (projectId: string, from: ViewKey) =>
  apiGet<{ from: ViewKey; fields: FieldDef[] }>(`${R}/catalog?from=${from}&${P(projectId)}`).then((r) => r.fields);

export const runQuery = (spec: ReportSpec, cursor?: string) =>
  apiPost<QueryResult>(`${R}/query${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, spec);

export const runSql = (projectId: string, text: string, cursor?: string) =>
  apiPost<QueryResult>(`${R}/query/sql${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { text, projectId });

export const validateSql = (projectId: string, text: string) =>
  apiPost<SqlValidation>(`${R}/query/validate`, { text, projectId });

export const getFacets = (projectId: string, from: ViewKey, field: string, q?: string) =>
  apiGet<{ value: string; label: string }[]>(
    `${R}/facets?from=${from}&field=${encodeURIComponent(field)}&${P(projectId)}${q ? `&q=${encodeURIComponent(q)}` : ''}`);

export const listReports = (projectId: string) => apiGet<SavedReport[]>(`${R}/reports?${P(projectId)}`);
export const createReport = (b: SavedReportBody) => apiPost<SavedReport>(`${R}/reports`, b);
export const updateReport = (id: string, b: SavedReportBody) => apiPut<SavedReport>(`${R}/reports/${id}`, b);
export const deleteReport = (id: string) => apiDelete(`${R}/reports/${id}`);

/** Export CSV por streaming: descarga directa (el stream no bufferea en JS). */
export async function exportCsv(spec: ReportSpec): Promise<void> {
  const token = localStorage.getItem('dmh.token');
  const res = await fetch(`${R}/export`, {
    method: 'POST',
    // X-Session-Token (no Authorization) + credentials: mismo contrato que
    // http.ts — en Databricks Apps el proxy SSO consume `Authorization` y
    // exige su cookie de sesión en requests cross-app.
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Session-Token': token } : {}) },
    body: JSON.stringify(spec),
  });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `report-${spec.from}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
