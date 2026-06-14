// Core data model types for Data Model Hub — project-centric ("Aurora").
//
// Hierarchy:  Project → Model (level) → Domain (vertical) → Table → Column + View
//
// A Project owns its `engines`, `layers` (the "Modelos / niveles", e.g.
// RDV·UDV·DDV) and `domains` (vertical data products that span layers). Tables
// belong to exactly one (layer, domain) and embed their role-specific SQL
// `views`. Relationships use a nested source/target shape and may cross
// layers/domains. Mirrors the backend persistence models in
// `backend-data-model-hub/src/db/db_models.py`.

// ─── Engines ─────────────────────────────────────────────────────────────────

// Database engines a project can target (the set the agent backend supports
// natively). Stored on `Project.engines` and per `ModelLevel.engine`.
export type DatabaseEngine =
  | 'postgresql'
  | 'databricks_sql'
  | 'sqlserver'
  | 'mysql'
  | 'cosmosdb';

export type EngineId = DatabaseEngine;

// ─── Tags ────────────────────────────────────────────────────────────────────

/** Key-value metadata tag attached to tables. Both fields are free-text. */
export interface Tag {
  key: string;
  value: string;
}

// ─── Model level ("Modelo / nivel") ──────────────────────────────────────────

/**
 * A configurable, engine-agnostic layer of the project — e.g. RDV·UDV·DDV
 * (or Staging/Core/Marts…). `order` drives the left→right band position on the
 * canvas and the adjacency used for cross-layer relationship warnings.
 */
export interface ModelLevel {
  id: string;            // slug, e.g. "rdv"
  name: string;          // short code, e.g. "RDV"
  full?: string;         // full name, e.g. "Raw Data Vault"
  color?: string;        // hex
  order: number;         // canvas band order + adjacency
  engine?: DatabaseEngine;
  desc?: string;
}

// ─── Domain (data product, vertical) ─────────────────────────────────────────

export type Sensitivity = 'Public' | 'Internal' | 'Confidential' | 'Restricted' | 'PII';

export const SENSITIVITY_LEVELS: Sensitivity[] = [
  'Public',
  'Internal',
  'Confidential',
  'Restricted',
  'PII',
];

/**
 * A Domain is project-level and **vertical**: the same domain (e.g. Finanzas)
 * has tables across several model levels (`table = (layer, domain)`).
 */
export interface Domain {
  id: string;
  name: string;
  color?: string;
  owner?: string;
  steward?: string;
  sensitivity?: Sensitivity;
  description?: string;
  /** Free-text subdomain labels selectable on a table. */
  subdomains: string[];
  /** ModelLevel ids this domain spans. */
  layers: string[];
}

// ─── View (role-specific SQL projection, embedded in a table) ────────────────

export type ViewType = 'business' | 'technical';

/**
 * A SQL view tied to a table and a role. `select` is multiline (one expression
 * per line, e.g. `sha256(CAST(email AS varchar)) AS email_hash`); `where` is
 * multiline AND-joined conditions. Rendered in the Inspector, not on the canvas.
 */
export interface View {
  id: string;
  name: string;
  type: ViewType;
  role?: string;
  select: string;
  where: string;
}

// ─── Column ──────────────────────────────────────────────────────────────────

export interface TableColumn {
  /** Stable identifier that survives renames. Relationship endpoints and React
   *  Flow handle ids are keyed by this value — never by `name`. */
  id: string;
  name: string;
  logicalName?: string;
  dataType: string;
  length?: number;
  scale?: number;
  isPrimaryKey?: boolean;
  isSurrogateKey?: boolean;
  isPartitionKey?: boolean;
  isForeignKey?: boolean;
  foreignKeyRef?: { table: string; column: string };
  isNullable?: boolean;
  isUnique?: boolean;
  defaultValue?: string;
  functionalDefinition?: string;
  observations?: string;
}

// ─── Partitioning ────────────────────────────────────────────────────────────

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
  columns: string[];
  buckets?: number;
  granularity?: 'DAY' | 'MONTH' | 'YEAR' | 'HOUR';
  clusteringColumns?: string[];
}

// ─── Canvas position ─────────────────────────────────────────────────────────

/** Canvas position of a node, persisted via `PATCH /api/projects/{id}/positions`. */
export interface NodePosition {
  x: number;
  y: number;
}

// ─── Table ───────────────────────────────────────────────────────────────────

export interface Table {
  id: string;
  /** SQL schema / namespace. */
  schema?: string;
  /** Physical table name (SQL). */
  name: string;
  /** Logical / business entity name. */
  logicalName?: string;
  /** ModelLevel id. */
  layer?: string;
  /** Domain id. */
  domain?: string;
  /** Subdomain label (from the domain's `subdomains`). */
  subdomain?: string;
  /** Header color — inherited from the domain. */
  color?: string;
  functionalDefinition?: string;
  applicationCode?: string;
  columns: TableColumn[];
  /** Role-specific SQL views derived from this table. */
  views: View[];
  tags?: Tag[];
  partition?: PartitionSpec;
  position?: NodePosition;
}

// ─── Relationship ────────────────────────────────────────────────────────────

export type Cardinality = '1:1' | '1:N' | 'N:N';

export interface RelationshipEndpoint {
  /** TableColumn endpoint: `table` = Table.id, `column` = TableColumn.id. */
  table: string;
  column: string;
}

/**
 * Crow's Foot cardinality for one end of a relationship. Derived from
 * `cardinality` + the FK column's `isNullable` by the edge renderer
 * (`src/features/diagram/components/ERCanvas.tsx`).
 */
export type CrowsFootCardinality =
  | 'one-only'
  | 'zero-or-one'
  | 'one-or-many'
  | 'zero-or-many';

export interface Relationship {
  id: string;
  source: RelationshipEndpoint;
  target: RelationshipEndpoint;
  cardinality: Cardinality;
  /** Derived (source.layer ≠ target.layer) — not persisted. */
  crossLayer?: boolean;
  /** Derived (|orderΔ| > 1) — not persisted. */
  skip?: boolean;
}

// ─── Project ─────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description?: string;
  engines: EngineId[];
  /** The project's models (levels) — CRUD. */
  layers: ModelLevel[];
  /** The project's domains (vertical) — CRUD. */
  domains: Domain[];
  createdAt?: string;
  updatedAt?: string;
}

/** Hydrated canvas: a project's tables + relationships (heavy child data). */
export interface Canvas {
  tables: Table[];
  relationships: Relationship[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Canonical column data types. Aligned with the backend
// `excel_import/type_normalizer.py::CANONICAL_TYPES`.
export const COLUMN_DATA_TYPES = [
  'integer', 'bigint', 'smallint', 'tinyint',
  'float', 'double', 'real', 'decimal', 'numeric', 'money',
  'varchar', 'char', 'text', 'nvarchar', 'string',
  'boolean',
  'date', 'datetime', 'timestamp', 'timestamptz', 'time',
  'binary', 'varbinary', 'blob', 'bytes',
  'json', 'jsonb', 'xml', 'uuid',
  'array', 'map', 'struct',
] as const;

export type ColumnDataType = (typeof COLUMN_DATA_TYPES)[number] | string;

export const CARDINALITY_VALUES: Cardinality[] = ['1:1', '1:N', 'N:N'];
