// Core data model types for Data Model Hub

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TableColumn {
  name: string;
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
  /** SQL schema / namespace the table belongs to. Required at form-level;
   *  may be absent on legacy records and will then default to engine's
   *  conventional schema (`dbo`, `public`, `default`). */
  schema?: string;
  name: string;
  columns: TableColumn[];
  functionalDefinition?: string;
  color?: string;
  /** Optional classification metadata to help organise large catalogs. */
  applicationCode?: string;
  domain?: string;
  subdomain?: string;
  /** Free-form labels users can attach to a table (filtering / grouping). */
  tags?: string[];
  /** Partitioning specification (engine-aware DDL generation will respect this). */
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
// Intentionally limited to the engines we generate first-class DDL for.
export type DatabaseEngine =
  | 'postgresql'
  | 'oracle'
  | 'databricks';

export interface DataModel {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  engine?: DatabaseEngine;
  tables: TableModel[];
  relationships: Relationship[];
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
