// ─────────────────────────────────────────────────────────────────────────────
// Databricks DDL generator (Screen 10 — Export DDL, `#pd`).
//
// Works off the *canonical* diagram shape the modeler store actually holds
// (`Diagram.tables/columns/relationships`), as thin local interfaces so the
// generator is pure and unit-testable (doc 75 D14: the legacy `genDDL` path
// and the «Aurora» model types were retired).
//
// Doc 76 (macro BCP): defaults = identifiers in lowercase, external table with
// the ADLS `abfss://…` location and the folder name in UPPERCASE; partition
// columns can be ordered by the UDP correlative (PART_01, PART_02…) declared
// by the ruleset's layout rule; column projections of views are emitted as
// `col AS alias` with the export casing.
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
  /** Posición dentro de la llave (0-based) — ordena el PRIMARY KEY(...). */
  pkPosition?: number | null;
  isForeignKey?: boolean;
  isNullable?: boolean;
  /** Column marked as a partition key. */
  isPartition?: boolean;
  /** Doc 76 D3 — correlativo de partición (PART_01 → 1) leído del UDP que
   *  declara la regla de layout (`rulesBridge.withPartitionOrder`). Ordena las
   *  columnas de partición en el bloque final del CREATE y en PARTITIONED BY;
   *  las particiones sin correlativo van después, en orden físico. */
  partitionOrder?: number | null;
  /** Functional definition → emitted as a column `COMMENT`. */
  description?: string;
  /** Doc 85 D10: comment FÍSICO (Erwin Comment) — si existe, es el COMMENT; si no, `description`. */
  physicalDescription?: string | null;
}

/** Minimal relationship shape (subset of governance `Relationship`, v2 doc 19:
 *  parent = lado PK, child = lado FK, con pares múltiples). Used to emit
 *  `FOREIGN KEY … REFERENCES` constraints (compuestas incluidas). */
export interface DdlRelationshipPair {
  parentColumnId: string;
  childColumnId: string;
}
export interface DdlRelationship {
  id: string;
  parentTableId: string;
  childTableId: string;
  pairs: DdlRelationshipPair[];
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
  /** Doc 61: script custom (vista "Personalizada") — si está presente, el
   *  cuerpo del CREATE VIEW ES este script (gana a sources/filter/join). */
  customSql?: string;
  /** Filtro (WHERE). */
  filter?: string;
  description?: string;
  /** "On canvas": define la VISTA DE NEGOCIO para las Export rules (doc 30).
   *  NO afecta qué se exporta — solo qué reglas la decoran. */
  showOnCanvas?: boolean;
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
  /** Doc 76 D9 — casing de la CARPETA del LOCATION (`<base>/<TABLE>`): la
   *  convención ADLS de la macro es MAYÚSCULA. Es un literal de path, ajeno a
   *  `identifierCase`. Ausente ⇒ 'upper'. */
  locationFolderCase?: IdentifierCase;
  /** Optional `TBLPROPERTIES (…)` key/value pairs. */
  tblProperties: { key: string; value: string }[];
  /** Doc 73 — regla de layout del ruleset («Partition columns last»): las
   *  columnas de partición se EMITEN al final del CREATE. El orden físico del
   *  modelo, el PARTITIONED BY y el PRIMARY KEY no cambian. La fija el modal
   *  desde las reglas seleccionadas (rulesBridge.layoutFromRules), nunca a mano. */
  partitionsLast?: boolean;
  /** Casing de identificadores (schema/tabla/columna/constraints pk_/fk_ y
   *  columnas/alias de las proyecciones de vistas). NUNCA aplica a: literales,
   *  COMMENTs, tipos de datos, expresiones/castType/joinOverride/filter/
   *  customSql de vistas ni alias generados (t1, t2, …). */
  identifierCase: IdentifierCase;
}

export const DEFAULT_DATABRICKS_OPTS: DatabricksDdlOptions = {
  // Default pedido owner: Views + Partitions ON; Comments, PK&FK (keys) e
  // Indexes OFF — los COMMENT de las definiciones funcionales son largos y
  // ensucian el CREATE, así que se piden explícitamente.
  includeViews: true,
  includeKeys: false,
  includeComments: false,
  includePartitions: true,
  includeIndexes: false,
  tableFormat: 'delta',
  unityCatalog: false,
  catalog: 'main',
  defaultSchema: 'default',
  // Doc 76 D9: la macro BCP escribe todo en minúscula sobre ADLS con LOCATION
  // por default y la carpeta en MAYÚSCULA.
  external: true,
  location: 'abfss://<container_name>@<storage_account_name>.dfs.core.windows.net/<path>',
  locationFolderCase: 'upper',
  tblProperties: [],
  identifierCase: 'lower',
};

// Casing activo del export en curso. `databricksDdl` (único entry point
// exportado que usa `ident`/`qualify`) lo fija al entrar; así TODO
// identificador — incluidos los del FROM/JOIN de las vistas multi-fuente
// (F3b) y los nombres de constraint pk_/fk_ — pasa por el mismo funnel sin
// enhebrar la opción por call-site. El generador es síncrono ⇒ sin carreras.
let activeCase: IdentifierCase = 'as-is';

const caseWith = (s: string, mode: IdentifierCase): string =>
  mode === 'lower' ? s.toLowerCase() : mode === 'upper' ? s.toUpperCase() : s;

const applyCase = (s: string): string => caseWith(s, activeCase);

/** Backtick-quote a Databricks identifier (aplica el casing del export). */
const ident = (s: string) => `\`${applyCase(s)}\``;

/** SQL string literal with single-quote escaping. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Carpeta del LOCATION: nombre del objeto con el casing de carpeta (doc 76 D9). */
export const locationFolder = (name: string, o: Pick<DatabricksDdlOptions, 'locationFolderCase'>): string =>
  caseWith(name, o.locationFolderCase ?? 'upper');

/** Orden de emisión de las columnas de partición (doc 76 D3): primero las que
 *  traen correlativo (PART_01 < PART_02…), después las demás en orden físico
 *  (sort estable). Espejo de `ordered_partitions` del motor. */
export function orderedPartitions(cols: DdlColumn[]): DdlColumn[] {
  return cols
    .filter((c) => c.isPartition)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ao = a.c.partitionOrder ?? null;
      const bo = b.c.partitionOrder ?? null;
      if (ao === null && bo === null) return a.i - b.i;
      if (ao === null) return 1;
      if (bo === null) return -1;
      return ao - bo || a.i - b.i;
    })
    .map(({ c }) => c);
}

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
  const t0 = (raw || 'string').trim();
  // Tipos complejos (contienen '<'): VERBATIM (F4 #6). Upper-casear rompería
  // la sintaxis interna (campos del STRUCT, tipos anidados). El switch de
  // casing (identifierCase) tampoco aplica: no son identificadores.
  if (t0.includes('<')) return t0;
  const t = t0.toLowerCase();
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
  // Doc 73/76: con la regla de layout, las particiones se emiten al final y
  // ordenadas por su correlativo; el resto conserva el orden físico (espejo de
  // `layout_columns` del motor).
  const partitions = orderedPartitions(ordered);
  const emitted = o.partitionsLast
    ? [...ordered.filter((c) => !c.isPartition), ...partitions]
    : ordered;

  const colLines = emitted.map((c) => {
    let l = `  ${ident(c.physicalName)} ${dbxType(c.dataType)}`;
    if (c.isNullable === false || c.isPrimaryKey) l += ' NOT NULL';
    const comment = (c.physicalDescription ?? '').trim() || (c.description ?? '').trim();
    if (o.includeComments && comment) l += ` COMMENT ${lit(comment)}`;
    return l;
  });

  const inner: string[] = [...colLines];
  if (o.includeKeys) {
    // El PRIMARY KEY(...) va en el ORDEN DE LA LLAVE (pkPosition), que es
    // independiente del orden físico de columnas — convención Erwin (doc 19
    // §12b). Sin pkPosition cae al ordinal (sort estable sobre `ordered`).
    const pks = ordered.filter((c) => c.isPrimaryKey)
      .sort((a, b) => (a.pkPosition ?? Number.MAX_SAFE_INTEGER) - (b.pkPosition ?? Number.MAX_SAFE_INTEGER))
      .map((c) => ident(c.physicalName));
    if (pks.length) inner.push(`  CONSTRAINT ${ident(`pk_${t.physicalName}`)} PRIMARY KEY (${pks.join(', ')})`);
  }

  const create = o.external ? 'CREATE EXTERNAL TABLE' : 'CREATE TABLE';
  let out = `${create} IF NOT EXISTS ${full} (\n${inner.join(',\n')}\n)`;
  out += `\nUSING ${o.tableFormat}`;

  if (o.includePartitions) {
    // Doc 76 D3: PARTITIONED BY sigue el correlativo del UDP cuando la regla
    // de layout lo declara; sin correlativos, el orden físico de siempre.
    const parts = partitions.map((c) => ident(c.physicalName));
    if (parts.length) out += `\nPARTITIONED BY (${parts.join(', ')})`;
  }

  if (o.includeComments && t.description?.trim()) out += `\nCOMMENT ${lit(t.description.trim())}`;

  if (o.external) {
    const base = (o.location || '').replace(/\/+$/, '');
    out += `\nLOCATION ${lit(`${base}/${locationFolder(t.physicalName, o)}`)}`;
  }

  if (o.tblProperties.length) {
    const props = o.tblProperties
      .filter((p) => p.key.trim())
      .map((p) => `  ${lit(p.key.trim())} = ${lit(p.value)}`);
    if (props.length) out += `\nTBLPROPERTIES (\n${props.join(',\n')}\n)`;
  }

  out += ';\n';

  // FK constraints (added after the table; Databricks supports informational FKs).
  // v2 (doc 19): el HIJO (childTableId) es quien tiene la FK; una relación con
  // pares múltiples emite UNA constraint compuesta con las listas de columnas.
  if (o.includeKeys) {
    rels
      .filter((r) => r.childTableId === t.id && r.pairs.length)
      .forEach((r) => {
        const fkCols = r.pairs
          .map((p) => cols.find((c) => c.id === p.childColumnId))
          .filter((c): c is DdlColumn => !!c);
        if (fkCols.length !== r.pairs.length) return; // par con columna fuera del set exportado
        const parent = tableById.get(r.parentTableId);
        const parentRef = parent ? qualify(parent, o) : ident(r.parentTableId);
        const parentCols = r.pairs.map((p) => colName.get(p.parentColumnId) ?? p.parentColumnId);
        out += `ALTER TABLE ${full} ADD CONSTRAINT ${ident(`fk_${t.physicalName}_${fkCols[0].physicalName}`)}`
          + ` FOREIGN KEY (${fkCols.map((c) => ident(c.physicalName)).join(', ')})`
          + ` REFERENCES ${parentRef}(${parentCols.map((c) => ident(c)).join(', ')});\n`;
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
      (r) => (r.childTableId === cur && prev.has(r.parentTableId))
        || (r.parentTableId === cur && prev.has(r.childTableId)),
    );
    if (!rel) continue;
    // TODOS los pares de la relación entran al ON (FK compuesta = AND de pares).
    for (const p of rel.pairs) {
      // Extremo de la fuente ANTERIOR primero (se lee izquierda→derecha).
      const [aTid, aCol, bTid, bCol] = rel.childTableId === cur
        ? [rel.parentTableId, p.parentColumnId, rel.childTableId, p.childColumnId]
        : [rel.childTableId, p.childColumnId, rel.parentTableId, p.parentColumnId];
      conds.push(`${alias.get(aTid)}.${colName.get(aCol) ?? aCol} = ${alias.get(bTid)}.${colName.get(bCol) ?? bCol}`);
    }
  }
  return conds.join(' AND ');
}

/** Un `CREATE OR REPLACE VIEW` desde una vista canónica (F3: multi-fuente).
 *  Reglas por columna (doc 76 D10): `expression` VERBATIM (con su alias tal
 *  cual) > `CAST(col AS castType) AS alias` > `col AS alias` SIEMPRE explícito
 *  (alias = outputAlias o la misma columna) — como escribe la macro. Las
 *  columnas y alias de proyección son identificadores del modelo y respetan
 *  `identifierCase`; con 2+ fuentes se cualifican con alias posicionales t1,
 *  t2… — RAW, nunca via ident() — y el FROM encadena `INNER JOIN` con UNA
 *  condición: `joinOverride` VERBATIM si está seteado, si no la inferida de
 *  `relationships` (inferJoin); sin condición ALGUNA la cadena se emite como
 *  `FULL OUTER JOIN` con `ON 1 = 1` comentado (doc 64 §4a). Sin proyecciones ⇒
 *  `SELECT *` (fallback legacy).
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
  // table-only cae al fallback SELECT *). Trim: una expression solo-espacios
  // es ausencia (evita proyectar `t1.undefined` con payloads directos a la API).
  const srcs = (v.sources ?? []).filter((s) => (s.column ?? '').trim() || (s.expression ?? '').trim());
  const where = (v.filter ?? '').trim();

  // Doc 61 — vista PERSONALIZADA: el script ES el cuerpo del CREATE VIEW.
  // Gana a sources/filter/joinOverride (que quedan inactivos mientras el modo
  // custom esté activo); el backend ya validó/derivó columnas al guardar.
  const custom = (v.customSql ?? '').trim();
  if (custom) {
    let out = `CREATE OR REPLACE VIEW ${full}`;
    if (o.includeComments && v.description?.trim()) out += ` COMMENT ${lit(v.description.trim())}`;
    return out + ` AS\n${custom.replace(/;\s*$/, '')};\n`;
  }

  // FROM: 1 fuente = igual que siempre; 2+ = cadena INNER JOIN con UNA condición.
  let from: string;
  if (!srcIds.length) from = `${ident(schema)}.${ident(v.name)}`; // legacy sin tabla
  else if (!aliased) from = refOf(srcIds[0]);
  else {
    // Doc 64 §4a: sin condición ALGUNA (ni override ni inferible) la vista se
    // emite como FULL OUTER JOIN explícito (ON 1 = 1) — el editor ya no
    // bloquea el guardado; con condición sigue siendo INNER JOIN como siempre.
    const cond = (v.joinOverride ?? '').trim() || inferJoin(srcIds, relationships, columns);
    const joinKw = cond ? 'INNER JOIN' : 'FULL OUTER JOIN';
    const on = cond || '1 = 1 /* no join condition defined — defaulted to FULL OUTER JOIN */';
    from = `${refOf(srcIds[0])} t1\n`
      + srcIds.slice(1).map((id) => `  ${joinKw} ${refOf(id)} ${aliasOf.get(id)}`).join('\n')
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
      const rawAlias = (s.outputAlias ?? '').trim();
      const cast = (s.castType ?? '').trim();
      const expr = (s.expression ?? '').trim();
      // Expresión libre: VERBATIM, alias incluido (lo tipeó el modelador junto
      // con la expresión).
      if (expr) return rawAlias && rawAlias !== expr ? `${expr} AS ${rawAlias}` : expr;
      // Columna del modelo: identificador ⇒ casing del export (sin backticks,
      // como siempre en las proyecciones). Cualificada con su alias de fuente
      // cuando hay 2+ (sin tableId ⇒ t1, ítems legacy de una sola tabla).
      const colName = applyCase(s.column!);
      const col = aliased ? `${aliasOf.get(s.tableId ?? '') ?? 't1'}.${colName}` : colName;
      const alias = applyCase(rawAlias || s.column!);
      if (cast) return `CAST(${col} AS ${cast}) AS ${alias}`;
      return `${col} AS ${alias}`;
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

/** Un statement por TABLA del set exportado — el bloque que `databricksDdl`
 *  une, expuesto para el puente de Export rules (doc 30 F10: cada tabla viaja
 *  con su `baseSql` al motor). Mismo output que siempre. */
export function tableStatements(
  input: DatabricksDdlInput, o: DatabricksDdlOptions,
): { table: DdlTable; sql: string }[] {
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
  const rels = input.relationships.filter((r) => ids.has(r.parentTableId) && ids.has(r.childTableId));
  return tables.map((t) => ({ table: t, sql: tableDDL(t, byTable.get(t.id) ?? [], rels, o, tableById, colName) }));
}

/** Las vistas que entran al export (alguna fuente dentro del set) con su
 *  `CREATE OR REPLACE VIEW` — mismo criterio y output que `databricksDdl`. */
export function viewStatements(
  input: DatabricksDdlInput, o: DatabricksDdlOptions,
): { view: DdlView; sql: string }[] {
  activeCase = o.identifierCase ?? 'as-is';
  const wanted = input.tableIds && input.tableIds.length
    ? new Set(input.tableIds)
    : null;
  const ids = new Set(input.tables.filter((t) => !wanted || wanted.has(t.id)).map((t) => t.id));
  const tableById = new Map(input.tables.map((t) => [t.id, t]));
  const exportViews = (input.views ?? []).filter((v) => {
    const src = v.sourceTableIds?.length ? v.sourceTableIds : (v.tableId ? [v.tableId] : []);
    return src.length === 0 || src.some((id) => ids.has(id));
  });
  return exportViews.map((v) => ({ view: v, sql: viewDDL(v, o, tableById, input.relationships, input.columns) }));
}

/** Generate Databricks DDL for the selected tables of a diagram. */
export function databricksDdl(input: DatabricksDdlInput, o: DatabricksDdlOptions): string {
  const stmts = tableStatements(input, o);

  const header = `-- ${input.modelName ?? 'model'} · Databricks · ${stmts.length} table(s)\n`
    + `-- Generated by Data Model Hub\n`;

  if (!stmts.length) return `${header}\n-- (no tables selected)`;

  const body = stmts.map((s) => s.sql).join('\n');

  // Vistas (F3): entra toda vista con ALGUNA fuente dentro del set exportado
  // (misma semántica que Properties→Views: la vista "pertenece" a cada fuente).
  // showOnCanvas NO participa del export. Las relaciones/columnas van SIN
  // filtrar por el set: el JOIN de la vista es el que es, esté o no exportada
  // la otra fuente.
  let viewsOut = '';
  if (o.includeViews && input.views?.length) {
    const vs = viewStatements(input, o);
    if (vs.length) {
      viewsOut = `\n-- ${vs.length} view(s)\n` + vs.map((v) => v.sql).join('\n');
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

/** Nombre del `.zip` de descarga: mismo criterio/saneado que `ddlFilename`. */
export function ddlZipName(tables: DdlTable[], modelName?: string): string {
  return ddlFilename(tables, modelName).replace(/\.sql$/, '.zip');
}
