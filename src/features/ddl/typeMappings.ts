// Maps the canonical column data types used in the model to the native types
// each engine prefers. The mapper is permissive: if the user has typed a
// dialect-specific type already (e.g. "VARCHAR2(50)" for Oracle), we return it
// untouched. Length / scale captured in TableColumn override the canonical name.

import type { DatabaseEngine, TableColumn } from '@/types/model';

/** Canonical → engine-specific mapping. */
const TYPE_MAP: Record<string, Partial<Record<DatabaseEngine, string>>> = {
  integer:   { postgresql: 'INTEGER',           oracle: 'NUMBER(10)',    databricks: 'INT' },
  bigint:    { postgresql: 'BIGINT',            oracle: 'NUMBER(19)',    databricks: 'BIGINT' },
  smallint:  { postgresql: 'SMALLINT',          oracle: 'NUMBER(5)',     databricks: 'SMALLINT' },
  float:     { postgresql: 'REAL',              oracle: 'BINARY_FLOAT',  databricks: 'FLOAT' },
  double:    { postgresql: 'DOUBLE PRECISION',  oracle: 'BINARY_DOUBLE', databricks: 'DOUBLE' },
  decimal:   { postgresql: 'NUMERIC',           oracle: 'NUMBER',        databricks: 'DECIMAL' },
  numeric:   { postgresql: 'NUMERIC',           oracle: 'NUMBER',        databricks: 'DECIMAL' },
  varchar:   { postgresql: 'VARCHAR',           oracle: 'VARCHAR2',      databricks: 'STRING' },
  char:      { postgresql: 'CHAR',              oracle: 'CHAR',          databricks: 'STRING' },
  text:      { postgresql: 'TEXT',              oracle: 'CLOB',          databricks: 'STRING' },
  nvarchar:  { postgresql: 'VARCHAR',           oracle: 'NVARCHAR2',     databricks: 'STRING' },
  boolean:   { postgresql: 'BOOLEAN',           oracle: 'NUMBER(1)',     databricks: 'BOOLEAN' },
  date:      { postgresql: 'DATE',              oracle: 'DATE',          databricks: 'DATE' },
  datetime:  { postgresql: 'TIMESTAMP',         oracle: 'TIMESTAMP',     databricks: 'TIMESTAMP' },
  timestamp: { postgresql: 'TIMESTAMP',         oracle: 'TIMESTAMP',     databricks: 'TIMESTAMP' },
  time:      { postgresql: 'TIME',              oracle: 'TIMESTAMP',     databricks: 'STRING' },
  binary:    { postgresql: 'BYTEA',             oracle: 'RAW',           databricks: 'BINARY' },
  varbinary: { postgresql: 'BYTEA',             oracle: 'BLOB',          databricks: 'BINARY' },
  blob:      { postgresql: 'BYTEA',             oracle: 'BLOB',          databricks: 'BINARY' },
  json:      { postgresql: 'JSONB',             oracle: 'JSON',          databricks: 'STRING' },
  xml:       { postgresql: 'XML',               oracle: 'XMLTYPE',       databricks: 'STRING' },
  uuid:      { postgresql: 'UUID',              oracle: 'RAW(16)',       databricks: 'STRING' },
  array:     { postgresql: 'JSONB',             oracle: 'JSON',          databricks: 'ARRAY<STRING>' },
  map:       { postgresql: 'JSONB',             oracle: 'JSON',          databricks: 'MAP<STRING, STRING>' },
  struct:    { postgresql: 'JSONB',             oracle: 'JSON',          databricks: 'STRUCT' },
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
 */
export function quoteIdent(name: string, engine: DatabaseEngine): string {
  const safe = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
  if (safe) return name;
  if (engine === 'databricks') return `\`${name.replace(/`/g, '``')}\``;
  // PostgreSQL & Oracle use double quotes
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
