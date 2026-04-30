// Core data model types for Data Model Hub

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Views (logical layer derived from physical tables) ────────────────────

/**
 * Category of a view, reflecting its intended audience.
 *  - `technical`  — internal/ETL use (e.g. staging, audit layers)
 *  - `user`       — end-user facing (simplified, clean column names)
 *  - `business`   — business-analyst facing (with KPI transforms, filters)
 */
export type ViewType = 'technical' | 'user' | 'business';

/**
 * Configuration for a single column inside a ViewModel.
 * Defines whether it's included, its alias, and any SQL expression applied.
 */
export interface ViewColumnTransform {
  /** Physical column name from the source table. */
  sourceColumn: string;
  /** Alias exposed by the view (null = same as sourceColumn). */
  alias?: string;
  /**
   * SQL expression to apply to the column.
   * Examples: "CAST(col AS VARCHAR(50))", "CASE WHEN active = 1 THEN 'SI' ELSE 'NO' END"
   * Engine-specific syntax is allowed (validated by the user, not by the app).
   */
  expression?: string;
  /** Whether to include this column in the view. Defaults to true. */
  include: boolean;
}

/**
 * A SQL view derived from a physical table.
 * Lives alongside TableModel in the canvas as a distinct visual entity.
 */
export interface ViewModel {
  id: string;
  /** Physical view name (e.g. VW_CLIENTE, VW_CAMPANIAS_ACTIVAS). */
  name: string;
  /** Business / logical name shown as label. */
  logicalName?: string;
  schema?: string;
  /** ID of the TableModel this view is derived from. */
  sourceTableId: string;
  viewType: ViewType;
  /** Column-level configuration (include, alias, expression). */
  columns: ViewColumnTransform[];
  /** SQL WHERE clause to filter the source data (engine-specific syntax). */
  whereClause?: string;
  /**
   * When true the view is defined by customSql instead of the derived query.
   * Useful for complex joins or subqueries that go beyond a single source table.
   */
  useCustomSql?: boolean;
  customSql?: string;
  functionalDefinition?: string;
  domain?: string;
  subdomain?: string;
  domainId?: string;
  subdomainId?: string;
  tags?: string[];
  color?: string;
}

// ─── Domain catalog ────────────────────────────────────────────────────────

export interface SubdomainDefinition {
  id: string;
  name: string;
  /** Short abbreviation used in naming conventions (e.g. "CRM", "MKTG"). */
  code?: string;
  description?: string;
  /** Values inherited by tables assigned to this subdomain. */
  defaults?: {
    schema?: string;
    tags?: string[];
  };
}

export interface DomainDefinition {
  id: string;
  name: string;
  /** Short abbreviation used in naming conventions (e.g. "CRM", "MKTG"). */
  code?: string;
  description?: string;
  /** Hex color for visual identification in the canvas (#0d9488). */
  color?: string;
  subdomains: SubdomainDefinition[];
  /** Values inherited by tables assigned to this domain (overridden by subdomain defaults). */
  defaults?: {
    schema?: string;
    tags?: string[];
  };
}

// ─── Column ────────────────────────────────────────────────────────────────

export interface TableColumn {
  /** Physical column name (SQL). */
  name: string;
  /** Logical / business attribute name shown in logical view (e.g. "Código de Cliente"). */
  logicalName?: string;
  dataType: string;
  /** Optional length / precision (e.g. 50 for varchar(50)) */
  length?: number;
  /** Optional scale for decimal/numeric types */
  scale?: number;
  isPrimaryKey?: boolean;
  isSurrogateKey?: boolean;
  /** Legacy single-column partition flag — kept for backwards compatibility.
   *  Prefer TableModel.partition.columns going forward. */
  isPartitionKey?: boolean;
  isForeignKey?: boolean;
  foreignKeyRef?: { table: string; column: string };
  isNullable?: boolean;
  isUnique?: boolean;
  defaultValue?: string;
  functionalDefinition?: string;
  /**
   * Notas libres sobre la columna (ej. razón del tipo, default aplicado,
   * constraints inusuales). Poblado por el AI Agent cuando propone un
   * modelo; editable a mano si se expone en el TableForm.
   */
  observations?: string;
}

/**
 * Partitioning strategy supported by the target engine.
 *
 *  - `RANGE`   — partition by a value range (Postgres, Oracle, SQL Server)
 *  - `LIST`    — partition by an explicit set of values
 *  - `HASH`    — hash modulo N buckets for parallelism
 *  - `DATE`    — temporal partitioning (BigQuery DATE/TIMESTAMP)
 *  - `INGESTION_TIME` — BigQuery `_PARTITIONTIME`
 *  - `BUCKET`  — Databricks/Snowflake bucketing on a column set
 *  - `NONE`    — explicit non-partitioned (default when omitted)
 */
export type PartitionStrategy =
  | 'NONE'
  | 'RANGE'
  | 'LIST'
  | 'HASH'
  | 'DATE'
  | 'INGESTION_TIME'
  | 'BUCKET';

export interface PartitionSpec {
  strategy: PartitionStrategy;
  /** Columns that drive the partition. Order matters. */
  columns: string[];
  /** Bucket count for HASH / BUCKET strategies. */
  buckets?: number;
  /** Temporal granularity for DATE strategy: 'DAY' | 'MONTH' | 'YEAR' | 'HOUR'. */
  granularity?: 'DAY' | 'MONTH' | 'YEAR' | 'HOUR';
  /** Additional columns used for clustering / Z-ORDER (Databricks, BigQuery, Redshift). */
  clusteringColumns?: string[];
}

export interface TableModel {
  id: string;
  /** SQL schema / namespace the table belongs to. */
  schema?: string;
  /** Physical table name (SQL, e.g. HD_CLIENTE). */
  name: string;
  /** Logical / business entity name shown in logical view (e.g. "Cliente"). */
  logicalName?: string;
  columns: TableColumn[];
  functionalDefinition?: string;
  color?: string;
  applicationCode?: string;
  /** Business domain — free text OR populated from DomainDefinition.name via catalog. */
  domain?: string;
  /** Business subdomain — free text OR populated from SubdomainDefinition.name via catalog. */
  subdomain?: string;
  /** IDs into the model's domainCatalog, enabling inheritance of defaults. */
  domainId?: string;
  subdomainId?: string;
  tags?: string[];
  partition?: PartitionSpec;
}

export interface Relationship {
  id: string;
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

// Database engines a DataModel can target.
//
// The first five values are the engines the AI agent backend supports
// natively (`agent-modeler/src/config.py::SUPPORTED_ENGINES`). The
// frontend's manual editor and DDL generator must accept the same set
// so a model produced by the agent can be opened, edited and re-exported
// without engine drift.
//
// The last two values are LEGACY entries kept only so saved JSON files
// from previous versions still load. They are not shown in the engine
// picker and `loadModel` normalizes `databricks` → `databricks_sql` on
// read. `oracle` is preserved verbatim because there is no obvious
// migration target; the AI agent degrades it to PostgreSQL with a
// console warning during a turn.
export type DatabaseEngine =
  | 'postgresql'
  | 'databricks_sql'
  | 'sqlserver'
  | 'mysql'
  | 'cosmosdb'
  // Legacy — read-only, hidden from the picker.
  | 'databricks'
  | 'oracle';

export interface DataModel {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  engine?: DatabaseEngine;
  tables: TableModel[];
  relationships: Relationship[];
  /** SQL views derived from the physical tables in this model. */
  views?: ViewModel[];
  /** Model-level domain catalog. Tables reference entries by domainId/subdomainId. */
  domainCatalog?: DomainDefinition[];
  createdAt: string;
  updatedAt: string;
}

// Column data type options
export const COLUMN_DATA_TYPES = [
  'integer',
  'bigint',
  'smallint',
  'float',
  'double',
  'decimal',
  'numeric',
  'varchar',
  'char',
  'text',
  'nvarchar',
  'boolean',
  'date',
  'datetime',
  'timestamp',
  'time',
  'binary',
  'varbinary',
  'blob',
  'json',
  'xml',
  'uuid',
  'array',
  'map',
  'struct',
] as const;

export type ColumnDataType = (typeof COLUMN_DATA_TYPES)[number] | string;

// Relationship type labels
export const RELATIONSHIP_TYPE_LABELS: Record<Relationship['type'], string> = {
  'one-to-one': '1:1',
  'one-to-many': '1:N',
  'many-to-many': 'N:M',
};
