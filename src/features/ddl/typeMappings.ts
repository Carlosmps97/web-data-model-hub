// Maps the canonical column data types used in the model to the native types
// each engine prefers. The mapper is permissive: if the user has typed a
// dialect-specific type already (e.g. "VARCHAR2(50)" for Oracle), we return it
// untouched. Length / scale captured in TableColumn override the canonical name.
//
// Each row covers the five engines the AI agent backend supports plus the two
// legacy aliases (`databricks`, `oracle`) so a saved model from before the
// engine refresh still emits coherent DDL.

import type { DatabaseEngine, TableColumn } from '@/types/model';

/** Canonical → engine-specific mapping. */
const TYPE_MAP: Record<string, Partial<Record<DatabaseEngine, string>>> = {
  integer:   { postgresql: 'INTEGER',           databricks_sql: 'INT',              sqlserver: 'INT',              mysql: 'INT',              cosmosdb: 'number',        oracle: 'NUMBER(10)',    databricks: 'INT' },
  bigint:    { postgresql: 'BIGINT',            databricks_sql: 'BIGINT',           sqlserver: 'BIGINT',           mysql: 'BIGINT',           cosmosdb: 'number',        oracle: 'NUMBER(19)',    databricks: 'BIGINT' },
  smallint:  { postgresql: 'SMALLINT',          databricks_sql: 'SMALLINT',         sqlserver: 'SMALLINT',         mysql: 'SMALLINT',         cosmosdb: 'number',        oracle: 'NUMBER(5)',     databricks: 'SMALLINT' },
  float:     { postgresql: 'REAL',              databricks_sql: 'FLOAT',            sqlserver: 'REAL',             mysql: 'FLOAT',            cosmosdb: 'number',        oracle: 'BINARY_FLOAT',  databricks: 'FLOAT' },
  double:    { postgresql: 'DOUBLE PRECISION',  databricks_sql: 'DOUBLE',           sqlserver: 'FLOAT',            mysql: 'DOUBLE',           cosmosdb: 'number',        oracle: 'BINARY_DOUBLE', databricks: 'DOUBLE' },
  decimal:   { postgresql: 'NUMERIC',           databricks_sql: 'DECIMAL',          sqlserver: 'DECIMAL',          mysql: 'DECIMAL',          cosmosdb: 'number',        oracle: 'NUMBER',        databricks: 'DECIMAL' },
  numeric:   { postgresql: 'NUMERIC',           databricks_sql: 'DECIMAL',          sqlserver: 'NUMERIC',          mysql: 'DECIMAL',          cosmosdb: 'number',        oracle: 'NUMBER',        databricks: 'DECIMAL' },
  varchar:   { postgresql: 'VARCHAR',           databricks_sql: 'STRING',           sqlserver: 'NVARCHAR',         mysql: 'VARCHAR',          cosmosdb: 'string',        oracle: 'VARCHAR2',      databricks: 'STRING' },
  char:      { postgresql: 'CHAR',              databricks_sql: 'STRING',           sqlserver: 'CHAR',             mysql: 'CHAR',             cosmosdb: 'string',        oracle: 'CHAR',          databricks: 'STRING' },
  text:      { postgresql: 'TEXT',              databricks_sql: 'STRING',           sqlserver: 'NVARCHAR(MAX)',    mysql: 'TEXT',             cosmosdb: 'string',        oracle: 'CLOB',          databricks: 'STRING' },
  nvarchar:  { postgresql: 'VARCHAR',           databricks_sql: 'STRING',           sqlserver: 'NVARCHAR',         mysql: 'VARCHAR',          cosmosdb: 'string',        oracle: 'NVARCHAR2',     databricks: 'STRING' },
  boolean:   { postgresql: 'BOOLEAN',           databricks_sql: 'BOOLEAN',          sqlserver: 'BIT',              mysql: 'TINYINT(1)',       cosmosdb: 'boolean',       oracle: 'NUMBER(1)',     databricks: 'BOOLEAN' },
  date:      { postgresql: 'DATE',              databricks_sql: 'DATE',             sqlserver: 'DATE',             mysql: 'DATE',             cosmosdb: 'string',        oracle: 'DATE',          databricks: 'DATE' },
  datetime:  { postgresql: 'TIMESTAMP',         databricks_sql: 'TIMESTAMP',        sqlserver: 'DATETIME2',        mysql: 'DATETIME',         cosmosdb: 'string',        oracle: 'TIMESTAMP',     databricks: 'TIMESTAMP' },
  timestamp: { postgresql: 'TIMESTAMP',         databricks_sql: 'TIMESTAMP',        sqlserver: 'DATETIME2',        mysql: 'TIMESTAMP',        cosmosdb: 'string',        oracle: 'TIMESTAMP',     databricks: 'TIMESTAMP' },
  time:      { postgresql: 'TIME',              databricks_sql: 'STRING',           sqlserver: 'TIME',             mysql: 'TIME',             cosmosdb: 'string',        oracle: 'TIMESTAMP',     databricks: 'STRING' },
  binary:    { postgresql: 'BYTEA',             databricks_sql: 'BINARY',           sqlserver: 'VARBINARY(MAX)',   mysql: 'BLOB',             cosmosdb: 'string',        oracle: 'RAW',           databricks: 'BINARY' },
  varbinary: { postgresql: 'BYTEA',             databricks_sql: 'BINARY',           sqlserver: 'VARBINARY(MAX)',   mysql: 'BLOB',             cosmosdb: 'string',        oracle: 'BLOB',          databricks: 'BINARY' },
  blob:      { postgresql: 'BYTEA',             databricks_sql: 'BINARY',           sqlserver: 'VARBINARY(MAX)',   mysql: 'BLOB',             cosmosdb: 'string',        oracle: 'BLOB',          databricks: 'BINARY' },
  json:      { postgresql: 'JSONB',             databricks_sql: 'STRING',           sqlserver: 'NVARCHAR(MAX)',    mysql: 'JSON',             cosmosdb: 'object',        oracle: 'JSON',          databricks: 'STRING' },
  xml:       { postgresql: 'XML',               databricks_sql: 'STRING',           sqlserver: 'XML',              mysql: 'TEXT',             cosmosdb: 'string',        oracle: 'XMLTYPE',       databricks: 'STRING' },
  uuid:      { postgresql: 'UUID',              databricks_sql: 'STRING',           sqlserver: 'UNIQUEIDENTIFIER', mysql: 'CHAR(36)',         cosmosdb: 'string',        oracle: 'RAW(16)',       databricks: 'STRING' },
  array:     { postgresql: 'JSONB',             databricks_sql: 'ARRAY<STRING>',    sqlserver: 'NVARCHAR(MAX)',    mysql: 'JSON',             cosmosdb: 'array',         oracle: 'JSON',          databricks: 'ARRAY<STRING>' },
  map:       { postgresql: 'JSONB',             databricks_sql: 'MAP<STRING, STRING>', sqlserver: 'NVARCHAR(MAX)', mysql: 'JSON',             cosmosdb: 'object',        oracle: 'JSON',          databricks: 'MAP<STRING, STRING>' },
  struct:    { postgresql: 'JSONB',             databricks_sql: 'STRUCT',           sqlserver: 'NVARCHAR(MAX)',    mysql: 'JSON',             cosmosdb: 'object',        oracle: 'JSON',          databricks: 'STRUCT' },
};

/**
 * Resolve a column's data type for the target engine.
 *
 * Behaviour:
 *  1. If the user typed a dialect-specific type with parentheses already
 *     (e.g. "VARCHAR2(50)", "DECIMAL(10,2)"), return it as-is (preserving case).
 *  2. Otherwise look up the canonical type in the matrix.
 *  3. If `length` (and optionally `scale`) are set on the column, append them
 *     when the resolved type is varchar/char/decimal/numeric-shaped.
 */
export function resolveDataType(
  column: TableColumn,
  engine: DatabaseEngine
): string {
  const raw = (column.dataType ?? '').trim();
  if (!raw) return 'STRING';

  // Already a parenthesised, dialect-specific type — keep verbatim.
  if (/[()]/.test(raw)) return raw;

  const canonical = raw.toLowerCase();
  const mapped = TYPE_MAP[canonical]?.[engine];
  const base = mapped ?? raw.toUpperCase();

  // Append length / scale if applicable.
  const isCharLike = /^(varchar|char|nvarchar|nvarchar2|varchar2|string)$/i.test(base);
  const isDecimalLike = /^(decimal|numeric|number)$/i.test(base);

  if (column.length != null) {
    if (isCharLike) return `${base}(${column.length})`;
    if (isDecimalLike) {
      return column.scale != null
        ? `${base}(${column.length}, ${column.scale})`
        : `${base}(${column.length})`;
    }
  }
  return base;
}

/**
 * Quote an identifier using engine-specific rules. We intentionally only quote
 * when the identifier contains characters that would require it. This keeps
 * generated DDL clean and idiomatic.
 *
 *  - SQL Server uses square brackets `[name]`.
 *  - Databricks (and the legacy alias) and MySQL use backticks `` `name` ``.
 *  - PostgreSQL, Oracle and Cosmos DB use double quotes `"name"`. Cosmos
 *    isn't really SQL but the few places that emit a quoted identifier
 *    (e.g. for documentation comments) match the JSON-friendly form.
 */
export function quoteIdent(name: string, engine: DatabaseEngine): string {
  const safe = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
  if (safe) return name;
  if (engine === 'sqlserver') return `[${name.replace(/]/g, ']]')}]`;
  if (engine === 'databricks_sql' || engine === 'databricks' || engine === 'mysql') {
    return `\`${name.replace(/`/g, '``')}\``;
  }
  // PostgreSQL, Oracle, Cosmos DB → double quotes.
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Fully-qualified table name "schema.name" using engine quoting rules.
 * For engines where `supportsSchemas` is false the caller already passed
 * a flattened schema (e.g. database name) — we just emit `schema.name`.
 */
export function qualifyTable(
  schema: string,
  name: string,
  engine: DatabaseEngine,
  schemasSupported: boolean
): string {
  const t = quoteIdent(name, engine);
  if (!schemasSupported) return t;
  return `${quoteIdent(schema, engine)}.${t}`;
}
