/**
 * query.service — cliente del motor de consulta del reporting (07). Todo gira
 * alrededor del `ReportSpec` (mismo IR que el backend): lo produce el builder
 * visual Y la caja SQL, y lo consumen la grilla, las queries guardadas y el export.
 */
import { apiGet, apiPost, apiPut, apiDelete } from '@/services/http';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const R = `${API_BASE}/api/reporting`;

export type ViewKey = 'columns' | 'tables' | 'relationships' | 'views' | 'models';
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
export interface SavedReport { id: string; name: string; description?: string | null; spec: ReportSpec; owner: string; shared: boolean; folderId?: string | null; }

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
export interface GlossaryUsage { term: string; abbrev?: string; scope?: string; wordType?: string; columnUsage: number; isUnused: boolean; }
export interface RelationshipRow {
  id: string; source: string; sourceSchema?: string; target: string; targetSchema?: string;
  cardinality: string; identifying: boolean; isSelfReferencing: boolean; crossSchema: boolean; label: string;
}

export const getScorecard = () => apiGet<Scorecard>(`${R}/insights/scorecard`);
export const getUdpCoverage = () => apiGet<UdpCoverage[]>(`${R}/insights/udp-coverage`);
export const getDomainUsage = () => apiGet<DomainUsage[]>(`${R}/insights/domain-usage`);
export const getGlossaryUsage = () => apiGet<GlossaryUsage[]>(`${R}/insights/glossary-usage`);
export const getRelationshipsReport = (limit = 2000) => apiGet<RelationshipRow[]>(`${R}/insights/relationships?limit=${limit}`);

export const emptySpec = (from: ViewKey = 'columns'): ReportSpec => ({
  from, select: [], groupBy: [], aggregations: [], orderBy: [], limit: 100, where: { op: 'and', conditions: [] },
});

// ── API ──
export const getCatalog = (from: ViewKey) =>
  apiGet<{ from: ViewKey; fields: FieldDef[] }>(`${R}/catalog?from=${from}`).then((r) => r.fields);

export const runQuery = (spec: ReportSpec, cursor?: string) =>
  apiPost<QueryResult>(`${R}/query${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, spec);

export const runSql = (text: string, cursor?: string) =>
  apiPost<QueryResult>(`${R}/query/sql${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { text });

export const validateSql = (text: string) => apiPost<SqlValidation>(`${R}/query/validate`, { text });

export const getFacets = (from: ViewKey, field: string, q?: string) =>
  apiGet<{ value: string; label: string }[]>(`${R}/facets?from=${from}&field=${encodeURIComponent(field)}${q ? `&q=${encodeURIComponent(q)}` : ''}`);

export const listReports = () => apiGet<SavedReport[]>(`${R}/reports`);
export const createReport = (b: { name: string; description?: string; spec: ReportSpec; shared?: boolean }) => apiPost<SavedReport>(`${R}/reports`, b);
export const updateReport = (id: string, b: { name: string; description?: string; spec: ReportSpec; shared?: boolean }) => apiPut<SavedReport>(`${R}/reports/${id}`, b);
export const deleteReport = (id: string) => apiDelete(`${R}/reports/${id}`);

/** Export CSV por streaming: descarga directa (el stream no bufferea en JS). */
export async function exportCsv(spec: ReportSpec): Promise<void> {
  const token = localStorage.getItem('dmh.token');
  const res = await fetch(`${R}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(spec),
  });
  if (!res.ok) throw new Error(`Export falló (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `report-${spec.from}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
