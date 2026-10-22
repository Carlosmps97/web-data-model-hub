// Tipos centrales del modelo de datos compartidos entre features. Las formas
// canónicas en runtime (tablas, columnas, relaciones, vistas) viven junto a sus
// servicios (`services/governance.service`, `services/views.service`,
// `features/modeler/services/modeler.service`); este módulo guarda solo los
// contratos transversales.

/** Tag de metadatos clave-valor asociado a tablas y vistas. Ambos campos son texto libre. */
export interface Tag {
  key: string;
  value: string;
}

/** Proyecto: raíz del alcance de todo el modelo y sus estándares.
 *  Espeja `ProjectDoc` del backend. */
export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Qué contiene un esquema de BD: solo tablas, solo vistas o ambas. Espeja
 *  `SchemaKind` del backend (`app/features/schemas/models.py`). */
export type SchemaKind = 'tables' | 'views' | 'both';

// Tipos de dato canónicos de columna: una sola lista para todos los motores, sin
// validaciones por motor (incluye Databricks SQL / Hive, Oracle y SQL Server).
// Espejo de `CATALOG` del backend (`app/core/datatypes.py`).
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
