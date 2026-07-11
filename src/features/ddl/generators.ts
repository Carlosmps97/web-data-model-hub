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
  /** Legacy: primera fuente (compat). El canónico F3 es `sourceTableIds`. */
  tableId?: string;
  /** F3: fuentes de la vista, en orden — definen los alias posicionales t1, t2… */
  sourceTableIds?: string[];
  /** F3: condición de JOIN manual — se emite VERBATIM (gana a la inferida). */
  joinOverride?: string;
  name: string;
  schema?: string;
  /** Definición SQL libre (fallback cuando no hay estructura). */
  sql?: string;
  /** Filtro (WHERE). */
  filter?: string;
  description?: string;
  /** Proyecciones del editor de vista: una por columna incluida. Sin proyecciones
   *  (o todas plain = legacy) ⇒ SELECT *. `tableId` = de qué fuente viene la
   *  columna; `castType` ⇒ `CAST(col AS castType) AS alias` (verbatim). */
  sources?: { column?: string; table?: string; tableId?: string; outputAlias?: string; expression?: string; castType?: string }[];
}

/** Casing aplicado a los identificadores exportados (F4 #7). Solo afecta el
 *  TEXTO exportado (ADLS es case-sensitive) — nunca la base de datos. */
export type IdentifierCase = 'as-is' | 'lower' | 'upper';

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
  /** Casing de identificadores (schema/tabla/columna/constraints pk_/fk_).
   *  NUNCA aplica a: literales, COMMENTs, tipos de datos, expresiones de
   *  vistas, joinOverride ni alias generados (t1, t2, …). */
  identifierCase: IdentifierCase;
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
  identifierCase: 'as-is',
};

// Casing activo del export en curso. `databricksDdl` (único entry point
// exportado que usa `ident`/`qualify`) lo fija al entrar; así TODO
// identificador — incluidos los del FROM/JOIN de las vistas multi-fuente
// (F3b) y los nombres de constraint pk_/fk_ — pasa por el mismo funnel sin
// enhebrar la opción por call-site. El generador es síncrono ⇒ sin carreras.
let activeCase: IdentifierCase = 'as-is';

const applyCase = (s: string): string =>
  activeCase === 'lower' ? s.toLowerCase() : activeCase === 'upper' ? s.toUpperCase() : s;

/** Backtick-quote a Databricks identifier (aplica el casing del export). */
const ident = (s: string) => `\`${applyCase(s)}\``;

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

/** Un `CREATE OR REPLACE VIEW` desde una vista canónica (F3: multi-fuente).
 *  Reglas por columna: `expression` VERBATIM > `CAST(col AS castType) AS alias`
 *  > `col AS alias` (si difiere) > `col`. Con 2+ fuentes las columnas se
 *  cualifican con alias posicionales t1, t2… — RAW, nunca via ident(): no son
 *  identificadores del modelo (coordinación F4) — y el FROM encadena
 *  `INNER JOIN` con UNA condición: `joinOverride` VERBATIM si está seteado,
 *  si no la inferida de `relationships` (inferJoin), con fallback explícito
 *  `1 = 1` comentado. Sin proyecciones ⇒ `SELECT *` (fallback legacy).
 *  `showOnCanvas` NO participa del export. Exportada: el ViewEditor la usa
 *  para el preview (mismo SQL que el export). */
export function viewDDL(
  v: DdlView,
  o: DatabricksDdlOptions,
  tableById: Map<string, DdlTable>,
  relationships: DdlRelationship[] = [],
  columns: DdlColumn[] = [],
): string {
  // Funnel de casing (F4 #7): fija activeCase desde LAS OPCIONES DE ESTA vista.
  // - Como entry point DIRECTO (ViewEditor → viewDDL(...), nunca databricksDdl):
  //   deriva el casing de SUS opciones en vez de heredar el activeCase que dejó
  //   el último export → el preview del editor no arrastra un 'upper'/'lower'.
  // - Desde databricksDdl: idempotente (databricksDdl ya lo fijó al mismo valor
  //   y pasa `o` tal cual) ⇒ respeta el casing del export en curso.
  activeCase = o.identifierCase ?? 'as-is';
  // Fuentes canónicas con fallback al tableId legacy (docs pre-F3a).
  const srcIds = v.sourceTableIds?.length ? v.sourceTableIds : (v.tableId ? [v.tableId] : []);
  const base = srcIds.length ? tableById.get(srcIds[0]) : undefined;
  const schema = (v.schema?.trim() || base?.schema?.trim() || o.defaultSchema || 'default');
  const parts = o.unityCatalog ? [o.catalog || 'main', schema, v.name] : [schema, v.name];
  const full = parts.map(ident).join('.');

  const aliased = srcIds.length > 1;
  // Alias POSICIONAL por fuente (t1, t2, …): raw, nunca via ident() (F4).
  const aliasOf = new Map(srcIds.map((id, i) => [id, `t${i + 1}`]));
  // Fuente fuera del contexto exportado (tabla no resuelta): id backtickeado
  // visible — señal explícita en el DDL en vez de inventar un nombre.
  const refOf = (id: string) => { const t = tableById.get(id); return t ? qualify(t, o) : ident(id); };

  // Solo cuentan proyecciones por COLUMNA o EXPRESIÓN (el formato legacy
  // table-only cae al fallback SELECT *).
  const srcs = (v.sources ?? []).filter((s) => (s.column ?? s.expression));
  const where = (v.filter ?? '').trim();

  // FROM: 1 fuente = igual que siempre; 2+ = cadena INNER JOIN con UNA condición.
  let from: string;
  if (!srcIds.length) from = `${ident(schema)}.${ident(v.name)}`; // legacy sin tabla
  else if (!aliased) from = refOf(srcIds[0]);
  else {
    const on = (v.joinOverride ?? '').trim()
      || inferJoin(srcIds, relationships, columns)
      || '1 = 1 /* sin relación modelada entre las fuentes */';
    from = `${refOf(srcIds[0])} t1\n`
      + srcIds.slice(1).map((id) => `  INNER JOIN ${refOf(id)} ${aliasOf.get(id)}`).join('\n')
      + `\n  ON ${on}`;
  }

  // La vista LISTA sus columnas explícitas (una por línea) en el orden definido.
  // `SELECT *` solo como fallback si la vista no tiene proyección por columna.
  let body: string;
  if (srcs.length === 0) {
    body = (!base && v.sql?.trim() && !where)
      ? v.sql.trim().replace(/;\s*$/, '')
      : `SELECT *\nFROM ${from}`;
  } else {
    const projections = srcs.map((s) => {
      const alias = (s.outputAlias ?? '').trim();
      const cast = (s.castType ?? '').trim();
      const expr = (s.expression ?? '').trim();
      if (expr) return alias && alias !== expr ? `${expr} AS ${alias}` : expr;
      // Cualificada con su alias de fuente cuando hay 2+ (sin tableId ⇒ t1,
      // ítems legacy de vistas de una sola tabla).
      const col = aliased ? `${aliasOf.get(s.tableId ?? '') ?? 't1'}.${s.column}` : s.column!;
      if (cast) return `CAST(${col} AS ${cast}) AS ${alias || s.column}`;
      return alias && alias !== s.column ? `${col} AS ${alias}` : col;
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
  activeCase = o.identifierCase ?? 'as-is';
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

  // Vistas (F3): entra toda vista con ALGUNA fuente dentro del set exportado
  // (misma semántica que Properties→Views: la vista "pertenece" a cada fuente).
  // showOnCanvas NO participa del export. Las relaciones/columnas van SIN
  // filtrar por el set: el JOIN de la vista es el que es, esté o no exportada
  // la otra fuente.
  let viewsOut = '';
  if (o.includeViews && input.views?.length) {
    const exportViews = input.views.filter((v) => {
      const src = v.sourceTableIds?.length ? v.sourceTableIds : (v.tableId ? [v.tableId] : []);
      return src.length === 0 || src.some((id) => ids.has(id));
    });
    if (exportViews.length) {
      viewsOut = `\n-- ${exportViews.length} view(s)\n`
        + exportViews.map((v) => viewDDL(v, o, tableById, input.relationships, input.columns)).join('\n');
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
