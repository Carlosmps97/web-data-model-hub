// Core data model types shared across features. The canonical runtime shapes
// (tables, columns, relationships, views) live next to their services
// (`services/governance.service`, `services/views.service`,
// `features/modeler/services/modeler.service`); this module keeps only the
// cross-cutting contracts.

/** Key-value metadata tag attached to tables and views. Both fields are free-text. */
export interface Tag {
  key: string;
  value: string;
}

/** Proyecto (doc 75): raíz del alcance de todo el modelo y sus estándares.
 *  Espeja `ProjectDoc` del backend. */
export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Qué contiene un esquema de BD: sólo tablas, sólo vistas o ambas. Espeja
 *  `SchemaKind` del backend (`app/features/schemas/models.py`). */
export type SchemaKind = 'tables' | 'views' | 'both';

// Canonical column data types: one list for every engine, no per-engine checks
// (doc 106 adds Databricks SQL / Hive, Oracle and SQL Server). Mirror of
// `CATALOG` in the backend (`app/core/datatypes.py`).
export const COLUMN_DATA_TYPES = [
  'integer', 'bigint', 'smallint', 'tinyint',
  'float', 'double', 'real', 'decimal', 'numeric', 'number', 'money',
  'varchar', 'varchar2', 'char', 'text', 'nvarchar', 'string',
  'boolean',
  'date', 'datetime', 'timestamp', 'timestamptz', 'time',
  'binary', 'varbinary', 'blob', 'bytes',
  'json', 'jsonb', 'xml', 'uuid', 'variant',
  'array', 'map', 'struct',
  // Databricks SQL / Hive
  'int', 'timestamp_ntz', 'double precision', 'geography', 'geometry',
  // Oracle
  'nvarchar2', 'nchar', 'binary_float', 'binary_double', 'long', 'long raw', 'raw', 'rowid',
  'urowid', 'clob', 'nclob', 'bfile', 'xmltype', 'vector',
  'timestamp with time zone', 'timestamp with local time zone',
  'interval year to month', 'interval day to second',
  // SQL Server
  'bit', 'smallmoney', 'datetime2', 'datetimeoffset', 'smalldatetime', 'ntext', 'image',
  'uniqueidentifier', 'sql_variant', 'hierarchyid', 'rowversion',
] as const;
