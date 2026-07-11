// DDL generators — ported from `data.js` (genDDL / genViewDDL).
// Views are SQL projections embedded in their table; `includeViews` appends a
// `CREATE VIEW` per role view.

import type { Table, View, DatabaseEngine } from '@/types/model';

/** `CREATE VIEW schema.name AS SELECT <exprs> FROM schema.table [WHERE …];`
 *  WHERE is a single free-text condition used verbatim (Feature 7). */
export function genViewDDL(table: Table, v: View): string {
  const full = `${table.schema}.${table.name}`;
  const cols = (v.select ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const where = (v.where ?? '').trim();
  let out = `CREATE VIEW ${table.schema}.${v.name} AS\nSELECT\n  ${cols.join(',\n  ') || '*'}\nFROM ${full}`;
  if (where) out += `\nWHERE ${where}`;
  return out + ';';
}

/** Engine-aware partition clause for a `CREATE TABLE`, from the columns the user
 *  marked as partition keys (Feature 6A). Emitted between `)` and `;`. */
function partitionClause(engine: DatabaseEngine | undefined, cols: string[]): string {
  if (!cols.length) return '';
  const list = cols.join(', ');
  switch (engine) {
    case 'databricks_sql':
      return `\nPARTITIONED BY (${list})`;
    case 'postgresql':
    case 'mysql':
      return `\nPARTITION BY RANGE (${list})`;
    case 'sqlserver':
      return `\n-- Partition: define una PARTITION FUNCTION/SCHEME sobre (${list})`;
    default:
      return `\n-- Partition columns: ${list}`;
  }
}

export interface GenDDLOptions {
  name?: string;
  engineLabel?: string;
  /** Engine id — drives the partition clause syntax. */
  engine?: DatabaseEngine;
  includeViews?: boolean;
  /** Emit PRIMARY KEY + FOREIGN KEY statements (combined switch). Default true. */
  includeKeys?: boolean;
}

export function genDDL(tables: Table[], opts: GenDDLOptions = {}): string {
  const includeKeys = opts.includeKeys !== false;
  let out = `-- ${opts.name ?? 'model'} · ${opts.engineLabel ?? ''}\n\n`;
  tables.forEach((t) => {
    const full = `${t.schema}.${t.name}`;
    const lines = t.columns.map((c) => {
      let l = `  ${c.name} ${c.dataType.toUpperCase()}`;
      if (c.isNullable === false) l += ' NOT NULL';
      return l;
    });
    const pks = t.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
    if (includeKeys && pks.length) lines.push(`  PRIMARY KEY (${pks.join(', ')})`);
    const partCols = t.columns.filter((c) => c.isPartitionKey).map((c) => c.name);
    out += `CREATE TABLE ${full} (\n${lines.join(',\n')}\n)${partitionClause(opts.engine, partCols)};\n`;
    if (includeKeys) {
      t.columns
        .filter((c) => c.isForeignKey && c.foreignKeyRef)
        .forEach((c) => {
          out += `ALTER TABLE ${full} ADD FOREIGN KEY (${c.name}) REFERENCES ${c.foreignKeyRef!.table}(${c.foreignKeyRef!.column});\n`;
        });
    }
    out += '\n';
  });
  if (opts.includeViews) {
    tables.forEach((t) => (t.views ?? []).forEach((v) => {
      out += `-- view · ${v.type} · ${v.role ?? ''}\n${genViewDDL(t, v)}\n\n`;
    }));
  }
  return out.trim();
}

export function countViews(tables: Table[]): number {
  return tables.reduce((a, t) => a + (t.views?.length ?? 0), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Databricks DDL generator (Screen 10 — Export DDL, `#pd`).
//
// Decoupled from `@/types/model`: works off the *canonical* diagram shape the
// modeler store actually holds (`Diagram.tables/columns/relationships`). Kept as
// thin local interfaces so the generator is pure and unit-testable, and so the
// older `genDDL`/EditorScreen path above stays untouched.
// ─────────────────────────────────────────────────────────────────────────────

/** Dialects offered by the Export DDL modal. Only `databricks` is implemented;
 *  `oracle` is surfaced as a locked/disabled option per the design. */
export type DdlDialect = 'databricks' | 'oracle';

/** Storage format for `USING <format>` (Databricks). */
export type DdlTableFormat = 'delta' | 'parquet' | 'avro' | 'orc' | 'csv' | 'json';

/** Minimal table shape the generator consumes (subset of `CanonicalTable`). */
export interface DdlTable {
  id: string;
  physicalName: string;
  logicalName?: string;
  schema?: string;
  /** Functional/business definition → emitted as a table `COMMENT`. */
  description?: string;
}

/** Minimal column shape (subset of `CanonicalColumn`). */
export interface DdlColumn {
  id: string;
  tableId: string;
  physicalName: string;
  logicalName?: string;
  dataType: string;
  ordinal: number;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  isNullable?: boolean;
  /** Column marked as a partition key. */
  isPartition?: boolean;
  /** Functional definition → emitted as a column `COMMENT`. */
  description?: string;
}

/** Minimal relationship shape (subset of governance `Relationship`). Used to
 *  emit `FOREIGN KEY … REFERENCES` constraints. */
export interface DdlRelationship {
  id: string;
  sourceTableId: string;
  sourceColumnId: string;
  targetTableId: string;
  targetColumnId: string;
}

/** Minimal view shape para emitir `CREATE VIEW` (subconjunto de la View canónica). */
export interface DdlView {
  id: string;
  tableId?: string;
  name: string;
  schema?: string;
  /** Definición SQL libre (fallback cuando no hay estructura). */
  sql?: string;
  /** Filtro (WHERE). */
  filter?: string;
  description?: string;
  /** Proyecciones del editor de vista: una por columna incluida. Sin proyecciones
   *  (o todas plain = todas las columnas sin rename/expresión) ⇒ SELECT *. */
  sources?: { column?: string; table?: string; outputAlias?: string; expression?: string }[];
}

export interface DatabricksDdlOptions {
  /** Emite `CREATE OR REPLACE VIEW` por cada vista del canvas exportado. */
  includeViews: boolean;
  /** Emit PRIMARY KEY / FOREIGN KEY constraints. */
  includeKeys: boolean;
  /** Emit `COMMENT` clauses from functional definitions. */
  includeComments: boolean;
  /** Emit `PARTITIONED BY (…)` from partition-key columns. */
  includePartitions: boolean;
  /** Emit a trailing `-- index` hint (Databricz has no CREATE INDEX). */
  includeIndexes: boolean;
  /** `USING <format>`. */
  tableFormat: DdlTableFormat;
  /** Unity Catalog: qualify names as `catalog.schema.table`. */
  unityCatalog: boolean;
  /** Catalog name used when `unityCatalog` is on. */
  catalog: string;
  /** Default schema when a table has none. */
  defaultSchema: string;
  /** External table → `CREATE EXTERNAL TABLE … LOCATION '<base>/<table>'`. */
  external: boolean;
  /** Base storage path (S3/ADLS/…) for external tables. */
  location: string;
  /** Optional `TBLPROPERTIES (…)` key/value pairs. */
  tblProperties: { key: string; value: string }[];
}

export const DEFAULT_DATABRICKS_OPTS: DatabricksDdlOptions = {
  includeViews: false,
  includeKeys: true,
  includeComments: true,
  includePartitions: true,
  includeIndexes: false,
  tableFormat: 'delta',
  unityCatalog: false,
  catalog: 'main',
  defaultSchema: 'default',
  external: false,
  location: 's3://my-bucket/warehouse',
  tblProperties: [],
};

/** Backtick-quote a Databricks identifier. */
const ident = (s: string) => `\`${s}\``;

/** SQL string literal with single-quote escaping. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Fully-qualified, backtick-quoted table name honoring Unity Catalog. */
function qualify(t: DdlTable, o: DatabricksDdlOptions): string {
  const schema = (t.schema?.trim() || o.defaultSchema || 'default');
  const parts = o.unityCatalog
    ? [o.catalog || 'main', schema, t.physicalName]
    : [schema, t.physicalName];
  return parts.map(ident).join('.');
}

/** Map a canonical/logical data type to a Databricks SQL type. */
function dbxType(raw: string): string {
  const t = (raw || 'string').trim().toLowerCase();
  const map: Record<string, string> = {
    integer: 'INT', int: 'INT', smallint: 'SMALLINT', tinyint: 'TINYINT', bigint: 'BIGINT',
    float: 'FLOAT', real: 'FLOAT', double: 'DOUBLE',
    decimal: 'DECIMAL(38,18)', numeric: 'DECIMAL(38,18)', money: 'DECIMAL(19,4)',
    varchar: 'STRING', nvarchar: 'STRING', char: 'STRING', text: 'STRING', string: 'STRING', uuid: 'STRING',
    boolean: 'BOOLEAN', bool: 'BOOLEAN',
    date: 'DATE', datetime: 'TIMESTAMP', timestamp: 'TIMESTAMP', timestamptz: 'TIMESTAMP', time: 'STRING',
    binary: 'BINARY', varbinary: 'BINARY', blob: 'BINARY', bytes: 'BINARY',
    json: 'STRING', jsonb: 'STRING', xml: 'STRING',
    array: 'ARRAY<STRING>', map: 'MAP<STRING,STRING>', struct: 'STRUCT<>',
  };
  // Preserve explicit params like decimal(10,2) verbatim (upper-cased).
  if (/\(.*\)/.test(t)) return t.toUpperCase();
  return map[t] ?? t.toUpperCase();
}

/** One `CREATE TABLE` statement for a single table. */
function tableDDL(
  t: DdlTable,
  cols: DdlColumn[],
  rels: DdlRelationship[],
  o: DatabricksDdlOptions,
  tableById: Map<string, DdlTable>,
  colName: Map<string, string>,
): string {
  const full = qualify(t, o);
  const ordered = [...cols].sort((a, b) => a.ordinal - b.ordinal);

  const colLines = ordered.map((c) => {
    let l = `  ${ident(c.physicalName)} ${dbxType(c.dataType)}`;
    if (c.isNullable === false || c.isPrimaryKey) l += ' NOT NULL';
    if (o.includeComments && c.description?.trim()) l += ` COMMENT ${lit(c.description.trim())}`;
    return l;
  });

  const inner: string[] = [...colLines];
  if (o.includeKeys) {
    const pks = ordered.filter((c) => c.isPrimaryKey).map((c) => ident(c.physicalName));
    if (pks.length) inner.push(`  CONSTRAINT ${ident(`pk_${t.physicalName}`)} PRIMARY KEY (${pks.join(', ')})`);
  }

  const create = o.external ? 'CREATE EXTERNAL TABLE' : 'CREATE TABLE';
  let out = `${create} IF NOT EXISTS ${full} (\n${inner.join(',\n')}\n)`;
  out += `\nUSING ${o.tableFormat}`;

  if (o.includePartitions) {
    const parts = ordered.filter((c) => c.isPartition).map((c) => ident(c.physicalName));
    if (parts.length) out += `\nPARTITIONED BY (${parts.join(', ')})`;
  }

  if (o.includeComments && t.description?.trim()) out += `\nCOMMENT ${lit(t.description.trim())}`;

  if (o.external) {
    const base = (o.location || '').replace(/\/+$/, '');
    out += `\nLOCATION ${lit(`${base}/${t.physicalName}`)}`;
  }

  if (o.tblProperties.length) {
    const props = o.tblProperties
      .filter((p) => p.key.trim())
      .map((p) => `  ${lit(p.key.trim())} = ${lit(p.value)}`);
    if (props.length) out += `\nTBLPROPERTIES (\n${props.join(',\n')}\n)`;
  }

  out += ';\n';

  // FK constraints (added after the table; Databricks supports informational FKs).
  if (o.includeKeys) {
    rels
      .filter((r) => r.sourceTableId === t.id || r.targetTableId === t.id)
      // child = source table holds the FK column referencing the parent (target).
      .filter((r) => r.sourceTableId === t.id)
      .forEach((r) => {
        const fkCol = cols.find((c) => c.id === r.sourceColumnId);
        if (!fkCol) return;
        const parent = tableById.get(r.targetTableId);
        const parentRef = parent ? qualify(parent, o) : ident(r.targetTableId);
        const parentCol = colName.get(r.targetColumnId) ?? r.targetColumnId;
        out += `ALTER TABLE ${full} ADD CONSTRAINT ${ident(`fk_${t.physicalName}_${fkCol.physicalName}`)}`
          + ` FOREIGN KEY (${ident(fkCol.physicalName)}) REFERENCES ${parentRef}(${ident(parentCol)});\n`;
      });
  }

  if (o.includeIndexes) {
    out += `-- index: Databricks has no CREATE INDEX; clustering via ZORDER (OPTIMIZE ${full} ZORDER BY (…)).\n`;
  }

  return out;
}

/** Condición de JOIN inferida de las relaciones modeladas entre las fuentes de
 *  una vista (D2, spec §3-5). Para cada fuente después de la primera toma la
 *  PRIMERA relación que la conecte con alguna fuente ANTERIOR y emite
 *  `tA.col = tB.col` con alias POSICIONALES (t1, t2… por orden en
 *  sourceTableIds; la fuente anterior a la izquierda). Une las condiciones con
 *  ' AND '; devuelve '' si ninguna fuente nueva conecta con las previas (el
 *  ViewEditor entonces exige joinOverride). Los alias y nombres de columna se
 *  emiten RAW (sin ident(): no deben casearse — coordinación F4).
 *  Pura — la usan viewDDL y la sección JOIN del ViewEditor. */
export function inferJoin(
  sourceTableIds: string[],
  relationships: DdlRelationship[],
  columns: DdlColumn[],
): string {
  if (sourceTableIds.length < 2) return '';
  const alias = new Map(sourceTableIds.map((id, i) => [id, `t${i + 1}`]));
  const colName = new Map(columns.map((c) => [c.id, c.physicalName]));
  const conds: string[] = [];
  for (let k = 1; k < sourceTableIds.length; k++) {
    const cur = sourceTableIds[k];
    const prev = new Set(sourceTableIds.slice(0, k));
    const rel = relationships.find(
      (r) => (r.sourceTableId === cur && prev.has(r.targetTableId))
        || (r.targetTableId === cur && prev.has(r.sourceTableId)),
    );
    if (!rel) continue;
    // Extremo de la fuente ANTERIOR primero (se lee izquierda→derecha).
    const [aTid, aCol, bTid, bCol] = rel.sourceTableId === cur
      ? [rel.targetTableId, rel.targetColumnId, rel.sourceTableId, rel.sourceColumnId]
      : [rel.sourceTableId, rel.sourceColumnId, rel.targetTableId, rel.targetColumnId];
    conds.push(`${alias.get(aTid)}.${colName.get(aCol) ?? aCol} = ${alias.get(bTid)}.${colName.get(bCol) ?? bCol}`);
  }
  return conds.join(' AND ');
}

/** Un `CREATE OR REPLACE VIEW` desde una vista canónica. Regla de columnas:
 *  si la vista NO declara proyecciones (es de todas las columnas) ⇒ `SELECT *`;
 *  si declara columnas/expresiones en sus `sources` ⇒ se listan explícitas.
 *  El FROM usa la tabla base CUALIFICADA (honra Unity Catalog); WHERE = filter. */
function viewDDL(v: DdlView, o: DatabricksDdlOptions, tableById: Map<string, DdlTable>): string {
  const base = v.tableId ? tableById.get(v.tableId) : undefined;
  const schema = (v.schema?.trim() || base?.schema?.trim() || o.defaultSchema || 'default');
  const parts = o.unityCatalog ? [o.catalog || 'main', schema, v.name] : [schema, v.name];
  const full = parts.map(ident).join('.');

  // Solo cuentan las proyecciones por COLUMNA o EXPRESIÓN (se ignora el formato
  // legacy table-only, que cae al fallback SELECT *).
  const srcs = (v.sources ?? []).filter((s) => (s.column ?? s.expression));
  const from = base ? qualify(base, o) : `${ident(schema)}.${ident(v.name)}`;
  const where = (v.filter ?? '').trim();

  // La vista LISTA sus columnas explícitas (una por línea) en el orden definido.
  // `SELECT *` solo como fallback si la vista no tiene proyección por columna.
  let body: string;
  if (srcs.length === 0) {
    body = (!base && v.sql?.trim() && !where)
      ? v.sql.trim().replace(/;\s*$/, '')
      : `SELECT *\nFROM ${from}`;
  } else {
    const projections = srcs.map((s) => {
      const expr = (s.expression ?? '').trim() || (s.column ?? '*');
      const alias = (s.outputAlias ?? '').trim();
      return alias && alias !== expr ? `${expr} AS ${alias}` : expr;
    });
    body = `SELECT\n  ${projections.join(',\n  ')}\nFROM ${from}`;
  }
  if (where) body += `\nWHERE ${where}`;

  let out = `CREATE OR REPLACE VIEW ${full}`;
  if (o.includeComments && v.description?.trim()) out += ` COMMENT ${lit(v.description.trim())}`;
  return out + ` AS\n${body};\n`;
}

export interface DatabricksDdlInput {
  tables: DdlTable[];
  columns: DdlColumn[];
  relationships: DdlRelationship[];
  /** Vistas del canvas (para `CREATE VIEW` cuando `includeViews`). */
  views?: DdlView[];
  /** Only export these table ids; empty/undefined ⇒ all. */
  tableIds?: string[];
  modelName?: string;
}

/** Generate Databricks DDL for the selected tables of a diagram. */
export function databricksDdl(input: DatabricksDdlInput, o: DatabricksDdlOptions): string {
  const wanted = input.tableIds && input.tableIds.length
    ? new Set(input.tableIds)
    : null;
  const tables = input.tables.filter((t) => !wanted || wanted.has(t.id));
  const byTable = new Map<string, DdlColumn[]>();
  for (const c of input.columns) {
    (byTable.get(c.tableId) ?? byTable.set(c.tableId, []).get(c.tableId)!).push(c);
  }
  // Lookups para resolver el destino de las FK a nombre físico (no id).
  const tableById = new Map(input.tables.map((t) => [t.id, t]));
  const colName = new Map(input.columns.map((c) => [c.id, c.physicalName]));
  // Only relationships fully inside the export set produce constraints.
  const ids = new Set(tables.map((t) => t.id));
  const rels = input.relationships.filter((r) => ids.has(r.sourceTableId) && ids.has(r.targetTableId));

  const header = `-- ${input.modelName ?? 'model'} · Databricks · ${tables.length} table(s)\n`
    + `-- Generated by Data Model Hub\n`;

  if (!tables.length) return `${header}\n-- (no tables selected)`;

  const body = tables
    .map((t) => tableDDL(t, byTable.get(t.id) ?? [], rels, o, tableById, colName))
    .join('\n');

  // Vistas: solo las de las tablas dentro del set exportado.
  let viewsOut = '';
  if (o.includeViews && input.views?.length) {
    const wanted = input.views.filter((v) => !v.tableId || ids.has(v.tableId));
    if (wanted.length) {
      viewsOut = `\n-- ${wanted.length} view(s)\n` + wanted.map((v) => viewDDL(v, o, tableById)).join('\n');
    }
  }

  return `${header}\n${body}${viewsOut}`.trimEnd() + '\n';
}

/** Filesystem-safe filename for the download. One table ⇒ its physical name. */
export function ddlFilename(tables: DdlTable[], modelName?: string): string {
  const base = tables.length === 1
    ? tables[0].physicalName
    : (modelName ?? 'model');
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'model';
  return `${safe}.sql`;
}
