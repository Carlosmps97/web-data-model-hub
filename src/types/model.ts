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

// ─── UDP / Semantic Type catalog (transversal governance metadata) ───────────
// Cross-project, organization-wide. Created & managed in the Model Center
// "Metadata" section, then assigned to a project's tables/columns. Mirrors the
// backend `SemanticTypeDoc` / `UdpDoc` in `db_models.py`.

/** A controlled-vocabulary label carried by a Semantic Type — the user picks a
 *  value from `allowedValues` when assigning the type to a column. */
export interface SemanticTag {
  key: string;
  allowedValues: string[];
}

/** A semantic classification of a column (e.g. Monto, Porcentaje, Hash).
 *  Assigning it inherits `dataType` onto the column (still editable) and
 *  surfaces its controlled tags. */
export interface SemanticType {
  id: string;
  name: string;
  dataType: string;
  description?: string;
  tags: SemanticTag[];
}

export type UdpScope = 'table' | 'column';

/** A user-defined property assignable to tables and/or columns. Extensible:
 *  free-text or a controlled enum. */
export interface Udp {
  id: string;
  name: string;
  description?: string;
  appliesTo: UdpScope[];
  valueType: 'text' | 'enum';
  allowedValues?: string[];
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
  /** Free key/value governance tags (secondary metadata, shown last). */
  tags?: Tag[];
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
  /** True when the FK was pinned by hand — a relationship delete won't clear it. */
  fkManual?: boolean;
  foreignKeyRef?: { table: string; column: string };
  isNullable?: boolean;
  isUnique?: boolean;
  defaultValue?: string;
  functionalDefinition?: string;
  observations?: string;
  /** Assigned Semantic Type (id into the transversal catalog). Inherits its
   *  data type onto this column and surfaces its controlled-vocab tags. */
  semanticTypeId?: string;
  /** Chosen values for the Semantic Type's controlled tags (tag key → value). */
  semanticValues?: Record<string, string>;
  /** Chosen values for assigned column-level UDPs (udp id → value). */
  udpValues?: Record<string, string>;
  /** Free key/value governance tags (secondary metadata, shown last). */
  tags?: Tag[];
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
  /** Chosen values for assigned table-level UDPs (udp id → value). */
  udpValues?: Record<string, string>;
  partition?: PartitionSpec;
  position?: NodePosition;
}

// ─── Relationship ────────────────────────────────────────────────────────────
// El tipo runtime de relación vive en governance.service (`Relationship` v2:
// parent/child + pairs, doc 19). Acá NO hay tipo de relación: el legacy
// (source/target anidados + '1:N') se eliminó al no tener consumidores.

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

// ─── Constants ───────────────────────────────────────────────────────────────

// Canonical column data types (Databricks-flavored superset).
export const COLUMN_DATA_TYPES = [
  'integer', 'bigint', 'smallint', 'tinyint',
  'float', 'double', 'real', 'decimal', 'numeric', 'number', 'money',
  'varchar', 'varchar2', 'char', 'text', 'nvarchar', 'string',
  'boolean',
  'date', 'datetime', 'timestamp', 'timestamptz', 'time',
  'binary', 'varbinary', 'blob', 'bytes',
  'json', 'jsonb', 'xml', 'uuid', 'variant',
  'array', 'map', 'struct',
] as const;

export type ColumnDataType = (typeof COLUMN_DATA_TYPES)[number] | string;
