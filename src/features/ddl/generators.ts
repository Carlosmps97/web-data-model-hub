// ─────────────────────────────────────────────────────────────────────────────
// Generador de DDL Databricks (modal Export DDL).
//
// Trabaja sobre la forma *canónica* del diagrama que guarda el store del modeler
// (`Diagram.tables/columns/relationships`), con interfaces locales mínimas para
// que el generador sea puro y se pueda probar de forma unitaria.
//
// Defaults según la macro de referencia: identificadores en minúscula, tabla
// externa con LOCATION ADLS `abfss://…` y la carpeta en mayúsculas; las
// proyecciones de columnas de las vistas se emiten como `col AS alias` con el
// casing del export.
//
// Sin comillas salvo que el nombre las necesite (`quoteIdentifiers`), tipos con
// `typeCase`, CREATE según `createTable`, `USING` en mayúscula y `NOT NULL` solo
// con keys. Los defaults son las convenciones de la macro; el proyecto las
// cambia en Data Standards (Output settings).
//
// Con PARTITIONED BY las columnas de partición no van en la lista del CREATE:
// se declaran ahí con su tipo (`PARTITIONED BY (codmes int)`). Formato fijo.
// ─────────────────────────────────────────────────────────────────────────────
import { foldComplexType } from '@/lib/typeText';

/** Dialectos que ofrece el modal Export DDL. `oracle` lo genera `oracle.ts`; las
 *  Output settings del proyecto indican con cuál abre el modal. */
export type DdlDialect = 'databricks' | 'oracle';

/** Formato de almacenamiento para `USING <format>` (Databricks). */
export type DdlTableFormat = 'delta' | 'parquet' | 'avro' | 'orc' | 'csv' | 'json';

/** Forma mínima de tabla que consume el generador (subconjunto de `CanonicalTable`). */
export interface DdlTable {
  id: string;
  physicalName: string;
  logicalName?: string;
  schema?: string;
  /** Definición funcional o de negocio → se emite como `COMMENT` de la tabla. */
  description?: string;
}

/** Forma mínima de columna (subconjunto de `CanonicalColumn`). */
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
  /** Columna marcada como llave de partición. */
  isPartition?: boolean;
  /** Definición funcional → se emite como `COMMENT` de la columna. */
  description?: string;
  /** Comment físico (Comment de Erwin): si existe, es el COMMENT; si no, `description`. */
  physicalDescription?: string | null;
}

/** Forma mínima de relación (subconjunto de `Relationship` de governance:
 *  parent = lado PK, child = lado FK, con pares múltiples). Se usa para emitir
 *  constraints `FOREIGN KEY … REFERENCES` (compuestas incluidas). */
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

/** Forma mínima de vista para emitir `CREATE VIEW` (subconjunto de la View canónica). */
export interface DdlView {
  id: string;
  /** Primera fuente, por compatibilidad. La lista canónica es `sourceTableIds`. */
  tableId?: string;
  /** Fuentes de la vista, en orden: definen los alias posicionales t1, t2…
   *  Con 2+ fuentes el FROM las lista separadas por coma (como Erwin), sin JOIN. */
  sourceTableIds?: string[];
  name: string;
  schema?: string;
  /** Definición SQL libre (fallback cuando no hay estructura). */
  sql?: string;
  description?: string;
  /** "On canvas": define la vista de negocio para las Export rules. No afecta
   *  qué se exporta, solo qué reglas la decoran. */
  showOnCanvas?: boolean;
  /** Proyecciones del editor de vista: una por columna incluida. Sin proyecciones
   *  por columna ni expresión ⇒ SELECT *. `tableId` = de qué fuente viene la
   *  columna; `castType` ⇒ `CAST(col AS castType) AS alias` (verbatim). */
  sources?: { column?: string; table?: string; tableId?: string; outputAlias?: string; expression?: string; castType?: string }[];
}

/** Casing aplicado a los identificadores exportados. Solo afecta el texto
 *  exportado (ADLS es case-sensitive), nunca la base de datos. */
export type IdentifierCase = 'as-is' | 'lower' | 'upper';

/** Comillas solo si el nombre las necesita, o siempre. */
export type QuoteMode = 'when-needed' | 'always';
/** Casing de los tipos de dato simples. */
export type TypeCase = 'lower' | 'upper';
/** Forma del CREATE TABLE. */
export type CreateTableMode = 'or-replace' | 'if-not-exists';
/** Keyword de los SET TAGS sobre vistas (Output settings); ningún export lo lee: las reglas escriben sus tags. */
export type ViewTagsAs = 'table' | 'view';

export interface DatabricksDdlOptions {
  /** Emite `CREATE OR REPLACE VIEW` por cada vista del canvas exportado. */
  includeViews: boolean;
  /** Emite constraints PRIMARY KEY / FOREIGN KEY y NOT NULL (una PK en Databricks exige NOT NULL). */
  includeKeys: boolean;
  /** Emite cláusulas `COMMENT` desde las definiciones funcionales. */
  includeComments: boolean;
  /** Emite `PARTITIONED BY (…)` desde las columnas marcadas como partición. */
  includePartitions: boolean;
  /** Emite una pista final `-- index` (Databricks no tiene CREATE INDEX). */
  includeIndexes: boolean;
  /** `USING <format>`. */
  tableFormat: DdlTableFormat;
  /** Unity Catalog: cualifica los nombres como `catalog.schema.table`. */
  unityCatalog: boolean;
  /** Nombre del catálogo que se usa cuando `unityCatalog` está activo. */
  catalog: string;
  /** Esquema por defecto cuando una tabla no tiene uno. */
  defaultSchema: string;
  /** Tabla externa → `LOCATION '<base>/<TABLE>'` (con `createTable = if-not-exists` además `CREATE EXTERNAL TABLE`). */
  external: boolean;
  /** Ruta base de almacenamiento (S3/ADLS/…) para tablas externas. */
  location: string;
  /** Casing de la carpeta del LOCATION (`<base>/<TABLE>`): la convención ADLS
   *  de la macro usa mayúsculas. Es un literal de path, ajeno a `identifierCase`.
   *  Ausente ⇒ 'upper'. */
  locationFolderCase?: IdentifierCase;
  /** Pares clave/valor opcionales de `TBLPROPERTIES (…)`. */
  tblProperties: { key: string; value: string }[];
  /** Casing de identificadores (schema/tabla/columna/constraints pk_/fk_ y
   *  columnas/alias de las proyecciones de vistas). Nunca aplica a literales,
   *  COMMENTs, tipos de datos, expresiones/castType de vistas ni alias
   *  generados (t1, t2, …). */
  identifierCase: IdentifierCase;
  /** Comillas de los identificadores. */
  quoteIdentifiers: QuoteMode;
  /** Casing de los tipos simples (los complejos y los CAST de vistas van tal cual). */
  typeCase: TypeCase;
  /** `or-replace` ⇒ CREATE OR REPLACE TABLE; `if-not-exists` ⇒ CREATE [EXTERNAL] TABLE IF NOT EXISTS. */
  createTable: CreateTableMode;
  /** Tags sobre vistas: `ALTER TABLE` (como la macro) o `ALTER VIEW` (ver `ViewTagsAs`). */
  viewTagsAs: ViewTagsAs;
}

export const DEFAULT_DATABRICKS_OPTS: DatabricksDdlOptions = {
  // Convenciones de la macro de referencia; el proyecto las cambia en Data
  // Standards → Output settings. Por defecto: Views y Partitions activas;
  // Comments, PK&FK (keys) e Indexes apagadas: los COMMENT de las definiciones
  // funcionales son largos y ensucian el CREATE, así que se piden explícitamente.
  includeViews: true,
  includeKeys: false,
  includeComments: false,
  includePartitions: true,
  includeIndexes: false,
  tableFormat: 'delta',
  unityCatalog: false,
  catalog: 'main',
  defaultSchema: 'default',
  // La macro de referencia escribe en minúscula sobre ADLS, con LOCATION por
  // defecto y la carpeta en mayúsculas.
  external: true,
  location: 'abfss://<container_name>@<storage_account_name>.dfs.core.windows.net/<path>',
  locationFolderCase: 'upper',
  tblProperties: [],
  identifierCase: 'lower',
  quoteIdentifiers: 'when-needed',
  typeCase: 'lower',
  createTable: 'or-replace',
  viewTagsAs: 'table',
};

// Estilo activo del export en curso: casing, comillas y tipos. Lo fijan los
// entry points (`tableStatements`/`viewStatements`/`viewDDL`) desde sus propias
// opciones; así cada identificador (incluidos los del FROM de las vistas
// multi-fuente y los nombres de constraint pk_/fk_) pasa por el mismo funnel
// sin enhebrar la opción por call-site. El generador es síncrono ⇒ sin
// carreras.
interface ActiveStyle { idCase: IdentifierCase; quote: QuoteMode; typeCase: TypeCase }
let active: ActiveStyle = { idCase: 'as-is', quote: 'when-needed', typeCase: 'lower' };
const useStyle = (o: DatabricksDdlOptions): void => {
  active = { idCase: o.identifierCase ?? 'as-is', quote: o.quoteIdentifiers ?? 'when-needed', typeCase: o.typeCase ?? 'lower' };
};

const caseWith = (s: string, mode: IdentifierCase): string =>
  mode === 'lower' ? s.toLowerCase() : mode === 'upper' ? s.toUpperCase() : s;

const applyCase = (s: string): string => caseWith(s, active.idCase);

/** Palabras que no pueden ir sin comillas como identificador. Espejo exacto de
 *  `RESERVED_WORDS` de las reglas (backend engine/sqltext.py). */
export const RESERVED_WORDS: ReadonlySet<string> = new Set(`
all alter and anti any as authorization between both by case cast check collate column
constraint create cross current_date current_time current_timestamp current_user delete
describe distinct drop else end escape except exists external false fetch filter for foreign
from full function global grant group having in inner insert intersect interval into is join
lateral leading left like local minus natural no not null of on only or order out outer
overlaps position primary range references revoke right rollback rollup row rows select semi
session_user set some start table tablesample then time to trailing true truncate union
unique unknown update user using values when where window with
`.split(/\s+/).filter(Boolean));

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Devuelve true si el nombre no compila sin backticks (caracteres fuera de
 *  [A-Za-z0-9_], empieza con dígito o es palabra reservada). */
export const needsQuote = (s: string): boolean => !SAFE_IDENT.test(s) || RESERVED_WORDS.has(s.toLowerCase());

const quote = (s: string): string => `\`${s.replace(/`/g, '``')}\``;

/** Identificador del modelo: casing del export + comillas según `quoteIdentifiers`. */
const ident = (s: string): string => {
  const c = applyCase(s);
  return active.quote === 'always' || needsQuote(c) ? quote(c) : c;
};

/** Proyección de vista (`col AS col`): casing del export; comillas solo si hacen falta. */
const projIdent = (s: string): string => {
  const c = applyCase(s);
  return needsQuote(c) ? quote(c) : c;
};

/** Literal de texto SQL con las comillas simples escapadas. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Carpeta del LOCATION: nombre del objeto con el casing de carpeta. */
export const locationFolder = (name: string, o: Pick<DatabricksDdlOptions, 'locationFolderCase'>): string =>
  caseWith(name, o.locationFolderCase ?? 'upper');

/** Orden único de las columnas de una tabla: PK primero y cada bloque por
 *  `ordinal`, sin orden de llave aparte. Espejo de `orderColumns` del modeler
 *  y de `display_order` del motor (el generador es puro y no importa internos
 *  de otra feature). */
export function pkFirstColumns<C extends { ordinal: number; isPrimaryKey?: boolean }>(cols: C[]): C[] {
  const byOrdinal = [...cols].sort((a, b) => a.ordinal - b.ordinal);
  return [...byOrdinal.filter((c) => c.isPrimaryKey), ...byOrdinal.filter((c) => !c.isPrimaryKey)];
}

/** Nombre completo de la tabla según Unity Catalog (comillas según `quoteIdentifiers`). */
function qualify(t: DdlTable, o: DatabricksDdlOptions): string {
  const schema = (t.schema?.trim() || o.defaultSchema || 'default');
  const parts = o.unityCatalog
    ? [o.catalog || 'main', schema, t.physicalName]
    : [schema, t.physicalName];
  return parts.map(ident).join('.');
}

/** Tipo Databricks de una columna tal como sale en el CREATE: simples mapeados
 *  y con el casing `typeCase`; complejos (con `<`) tal cual, plegados a una
 *  línea. Las reglas lo reciben como `tipo_ddl` (`rulesBridge`). */
export function ddlType(raw: string, typeCase: TypeCase = 'lower'): string {
  const t0 = (raw || 'string').trim();
  // Tipos complejos (contienen '<'): verbatim. Cambiarles el casing rompería
  // la sintaxis interna (campos del STRUCT, tipos anidados). Los saltos de
  // línea/tabs que trae Erwin se pliegan a un espacio para que la definición
  // de la columna salga en una sola línea.
  if (t0.includes('<')) return foldComplexType(t0);
  const t = t0.toLowerCase();
  const map: Record<string, string> = {
    integer: 'int', int: 'int', smallint: 'smallint', tinyint: 'tinyint', bigint: 'bigint',
    float: 'float', real: 'float', double: 'double',
    decimal: 'decimal(38,18)', numeric: 'decimal(38,18)', money: 'decimal(19,4)',
    varchar: 'string', nvarchar: 'string', char: 'string', text: 'string', string: 'string', uuid: 'string',
    boolean: 'boolean', bool: 'boolean',
    date: 'date', datetime: 'timestamp', timestamp: 'timestamp', timestamptz: 'timestamp', time: 'string',
    binary: 'binary', varbinary: 'binary', blob: 'binary', bytes: 'binary',
    json: 'string', jsonb: 'string', xml: 'string',
    array: 'array<string>', map: 'map<string,string>', struct: 'struct<>',
  };
  // Parámetros explícitos (decimal(10,2), char(20)) se conservan verbatim.
  const out = /\(.*\)/.test(t) ? t : (map[t] ?? t);
  return typeCase === 'upper' ? out.toUpperCase() : out;
}

/** Encabezado del CREATE TABLE. */
export function createTableSql(o: Pick<DatabricksDdlOptions, 'createTable' | 'external'>): string {
  if (o.createTable === 'if-not-exists') return o.external ? 'CREATE EXTERNAL TABLE IF NOT EXISTS' : 'CREATE TABLE IF NOT EXISTS';
  return 'CREATE OR REPLACE TABLE';
}

/** Un statement `CREATE TABLE` para una tabla. */
function tableDDL(
  t: DdlTable,
  cols: DdlColumn[],
  rels: DdlRelationship[],
  o: DatabricksDdlOptions,
  tableById: Map<string, DdlTable>,
  colName: Map<string, string>,
): string {
  const full = qualify(t, o);
  // Orden único: PK primero y cada bloque por ordinal.
  const ordered = pkFirstColumns(cols);
  // Con PARTITIONED BY las particiones no van en la lista: se declaran ahí con
  // su tipo (formato fijo). Sin él (Output setting «Partitions» apagada) van en
  // la lista, en orden físico.
  const partitions = ordered.filter((c) => c.isPartition);
  const rest = ordered.filter((c) => !c.isPartition);
  const emitted = o.includePartitions && partitions.length > 0 ? rest : ordered;

  /** Definición de una columna: la misma en la lista o dentro del PARTITIONED BY. */
  const colDef = (c: DdlColumn): string => {
    let l = `${ident(c.physicalName)} ${ddlType(c.dataType, active.typeCase)}`;
    if (o.includeKeys && (c.isNullable === false || c.isPrimaryKey)) l += ' NOT NULL';
    const comment = (c.physicalDescription ?? '').trim() || (c.description ?? '').trim();
    if (o.includeComments && comment) l += ` COMMENT ${lit(comment)}`;
    return l;
  };
  const colLines = emitted.map((c) => `  ${colDef(c)}`);

  const inner: string[] = [...colLines];
  if (o.includeKeys) {
    // El PRIMARY KEY(...) sigue el orden único (las PK por ordinal); no existe
    // un orden de llave aparte.
    const pks = ordered.filter((c) => c.isPrimaryKey).map((c) => ident(c.physicalName));
    if (pks.length) inner.push(`  CONSTRAINT ${ident(`pk_${t.physicalName}`)} PRIMARY KEY (${pks.join(', ')})`);
  }

  let out = `${createTableSql(o)} ${full} (\n${inner.join(',\n')}\n)`;
  out += `\nUSING ${o.tableFormat.toUpperCase()}`;

  if (o.includePartitions) {
    // En orden físico; cada partición va con su definición (`codmes int`), no
    // solo con el nombre.
    const parts = partitions.map(colDef);
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

  // Constraints FK (se agregan después de la tabla; Databricks admite FK
  // informativas). El hijo (childTableId) es quien tiene la FK; una relación con
  // pares múltiples emite una sola constraint compuesta con las listas de columnas.
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

/** Fuentes de una vista, en orden (con respaldo en `tableId` para documentos
 *  que solo traen ese campo). */
export const sourceIdsOf = (v: DdlView): string[] =>
  (v.sourceTableIds?.length ? v.sourceTableIds : (v.tableId ? [v.tableId] : []));

/** Una proyección de vista como la escribe el export: `sql` sin el alias
 *  (`t1.codcli`, `CAST(codcli AS int)` o la expresión tal cual). */
export interface ViewProjection {
  sql: string;
  /** Columnas: siempre (la misma columna si no tiene otro); expresión: el que
   *  tipeó el modelador, o null. */
  alias: string | null;
  /** Columna fuente (nombre del modelo) y su tabla; null en una expresión. */
  column: string | null;
  tableId: string | null;
  expression: boolean;
}

/** Las partes del `CREATE VIEW` de una vista: nombre completo, esquema
 *  efectivo, proyecciones y FROM; `freeSql` es la SQL congelada que se usa de
 *  cuerpo cuando no hay proyecciones ni primera fuente resoluble. */
export interface ViewParts {
  full: string;
  schema: string;
  projections: ViewProjection[];
  from: string;
  freeSql: string | null;
}

/** Partes del `CREATE OR REPLACE VIEW` de una vista canónica (multi-fuente).
 *  Por columna: `expression` verbatim (con su alias tal cual) >
 *  `CAST(col AS castType)` > `col`, siempre con alias explícito (outputAlias o
 *  la misma columna), como escribe la macro. Las columnas y alias de proyección
 *  son identificadores del modelo y respetan `identifierCase`, con comillas
 *  solo si el nombre las necesita; con 2+ fuentes se cualifican con alias
 *  posicionales t1, t2… (raw, nunca vía ident()) y el FROM las lista separadas
 *  por coma, sin JOIN ni ON (el default de Erwin: `from tabla1, tabla2`). Las
 *  usan `viewDDL` y el payload de las reglas (`rulesBridge`). */
export function viewParts(
  v: DdlView,
  o: DatabricksDdlOptions,
  tableById: Map<string, DdlTable>,
): ViewParts {
  // Funnel de estilo: fija el estilo activo desde sus propias opciones.
  // - Como entry point directo (ViewEditor → viewDDL(...), nunca databricksDdl):
  //   deriva casing/comillas de sus opciones en vez de heredar el estilo que
  //   dejó el último export → el preview del editor no arrastra un 'upper'.
  // - Desde databricksDdl: idempotente (ya se fijó al mismo valor y pasa `o`
  //   tal cual) ⇒ respeta el estilo del export en curso.
  useStyle(o);
  const srcIds = sourceIdsOf(v);
  const base = srcIds.length ? tableById.get(srcIds[0]) : undefined;
  const schema = (v.schema?.trim() || base?.schema?.trim() || o.defaultSchema || 'default');
  const parts = o.unityCatalog ? [o.catalog || 'main', schema, v.name] : [schema, v.name];
  const full = parts.map(ident).join('.');

  // La User-Defined SQL de una vista es texto informativo: el DDL sale siempre
  // de su estructura (`sources`), con `FROM t1, t2` sin JOIN si hay 2 o más
  // fuentes. Este generador no la conoce.
  const aliased = srcIds.length > 1;
  // Alias posicional por fuente (t1, t2, …): raw, nunca vía ident().
  const aliasOf = new Map(srcIds.map((id, i) => [id, `t${i + 1}`]));
  // Fuente fuera del contexto exportado (tabla no resuelta): id visible —
  // señal explícita en el DDL en vez de inventar un nombre.
  const refOf = (id: string) => { const t = tableById.get(id); return t ? qualify(t, o) : ident(id); };

  // Solo cuentan proyecciones por columna o expresión (un ítem que solo nombra
  // la tabla cae al fallback SELECT *). Trim: una expression solo-espacios es
  // ausencia (evita proyectar `t1.undefined` con payloads directos a la API).
  const srcs = (v.sources ?? []).filter((s) => (s.column ?? '').trim() || (s.expression ?? '').trim());

  // FROM: 1 fuente = la tabla sola; 2+ = lista separada por coma con alias
  // posicionales (`from tabla1, tabla2` de Erwin; sin JOIN/ON).
  let from: string;
  if (!srcIds.length) from = `${ident(schema)}.${ident(v.name)}`; // vista sin tabla fuente
  else if (!aliased) from = refOf(srcIds[0]);
  else from = srcIds.map((id) => `${refOf(id)} ${aliasOf.get(id)}`).join(',\n  ');

  const projections = srcs.map((s): ViewProjection => {
    const rawAlias = (s.outputAlias ?? '').trim();
    const cast = foldComplexType((s.castType ?? '').trim());   // una sola línea
    const expr = (s.expression ?? '').trim();
    // Expresión libre: verbatim, alias incluido (lo tipeó el modelador junto
    // con la expresión).
    if (expr) return { sql: expr, alias: rawAlias || null, column: null, tableId: s.tableId ?? null, expression: true };
    // Columna del modelo: identificador ⇒ casing del export, comillas solo si
    // el nombre las necesita. Cualificada con su alias de fuente cuando hay 2+
    // (sin tableId ⇒ t1, ítems de una sola tabla).
    const colName = projIdent(s.column!);
    const col = aliased ? `${aliasOf.get(s.tableId ?? '') ?? 't1'}.${colName}` : colName;
    return {
      sql: cast ? `CAST(${col} AS ${cast})` : col, alias: projIdent(rawAlias || s.column!),
      column: s.column!, tableId: s.tableId ?? null, expression: false,
    };
  });
  const freeSql = !projections.length && !base && v.sql?.trim() ? v.sql.trim().replace(/;\s*$/, '') : null;
  return { full, schema, projections, from, freeSql };
}

/** Una proyección con su alias: la expresión lo lleva solo si es otro texto. */
const projectionSql = (p: ViewProjection): string => (p.expression
  ? (p.alias && p.alias !== p.sql ? `${p.sql} AS ${p.alias}` : p.sql)
  : `${p.sql} AS ${p.alias}`);

/** Un `CREATE OR REPLACE VIEW` desde una vista canónica (ver `viewParts`). La
 *  vista lista sus columnas explícitas (una por línea) en el orden definido;
 *  sin proyecciones ⇒ `SELECT *`, o la `sql` libre (sin su `;` final) si la
 *  primera fuente no se resuelve.
 *  `showOnCanvas` no cambia este SQL: qué vistas se exportan lo decide la
 *  membresía del canvas (`canvasDdlViews`); con las reglas, `showOnCanvas`
 *  marca la vista de negocio (`rulesBridge`). Exportada: el ViewEditor la usa
 *  para el preview (mismo SQL que el export). */
export function viewDDL(
  v: DdlView,
  o: DatabricksDdlOptions,
  tableById: Map<string, DdlTable>,
): string {
  const p = viewParts(v, o, tableById);
  const body = p.freeSql ?? (p.projections.length
    ? `SELECT\n  ${p.projections.map(projectionSql).join(',\n  ')}\nFROM ${p.from}`
    : `SELECT *\nFROM ${p.from}`);
  let out = `CREATE OR REPLACE VIEW ${p.full}`;
  if (o.includeComments && v.description?.trim()) out += ` COMMENT ${lit(v.description.trim())}`;
  return out + ` AS\n${body};\n`;
}

export interface DatabricksDdlInput {
  tables: DdlTable[];
  columns: DdlColumn[];
  relationships: DdlRelationship[];
  /** Vistas del canvas (para `CREATE VIEW` cuando `includeViews`). */
  views?: DdlView[];
  /** Solo se exportan estos ids de tabla; vacío/undefined ⇒ todas. */
  tableIds?: string[];
  modelName?: string;
}

/** Las tablas del set exportado (`tableIds`; vacío ⇒ todas), en el orden del input. */
export function exportTables(input: DatabricksDdlInput): DdlTable[] {
  const wanted = input.tableIds && input.tableIds.length
    ? new Set(input.tableIds)
    : null;
  return input.tables.filter((t) => !wanted || wanted.has(t.id));
}

/** Las vistas que entran al export: sin fuentes o con alguna fuente dentro del
 *  set exportado. */
export function exportViews(input: DatabricksDdlInput): DdlView[] {
  const ids = new Set(exportTables(input).map((t) => t.id));
  return (input.views ?? []).filter((v) => {
    const src = sourceIdsOf(v);
    return src.length === 0 || src.some((id) => ids.has(id));
  });
}

/** Un statement por tabla del set exportado: el bloque que `databricksDdl`
 *  une, expuesto para el zip. Mismo output que `databricksDdl`. */
export function tableStatements(
  input: DatabricksDdlInput, o: DatabricksDdlOptions,
): { table: DdlTable; sql: string }[] {
  useStyle(o);
  const tables = exportTables(input);
  const byTable = new Map<string, DdlColumn[]>();
  for (const c of input.columns) {
    (byTable.get(c.tableId) ?? byTable.set(c.tableId, []).get(c.tableId)!).push(c);
  }
  // Lookups para resolver el destino de las FK a nombre físico (no id).
  const tableById = new Map(input.tables.map((t) => [t.id, t]));
  const colName = new Map(input.columns.map((c) => [c.id, c.physicalName]));
  // Solo las relaciones contenidas por completo en el set exportado generan constraints.
  const ids = new Set(tables.map((t) => t.id));
  const rels = input.relationships.filter((r) => ids.has(r.parentTableId) && ids.has(r.childTableId));
  return tables.map((t) => ({ table: t, sql: tableDDL(t, byTable.get(t.id) ?? [], rels, o, tableById, colName) }));
}

/** Las vistas que entran al export (alguna fuente dentro del set) con su
 *  `CREATE OR REPLACE VIEW` — mismo criterio y output que `databricksDdl`. */
export function viewStatements(
  input: DatabricksDdlInput, o: DatabricksDdlOptions,
): { view: DdlView; sql: string }[] {
  useStyle(o);
  const tableById = new Map(input.tables.map((t) => [t.id, t]));
  return exportViews(input).map((v) => ({ view: v, sql: viewDDL(v, o, tableById) }));
}

/** Genera el DDL Databricks de las tablas seleccionadas de un diagrama. */
export function databricksDdl(input: DatabricksDdlInput, o: DatabricksDdlOptions): string {
  const stmts = tableStatements(input, o);

  const header = `-- ${input.modelName ?? 'model'} · Databricks · ${stmts.length} table(s)\n`
    + `-- Generated by Data Model Hub\n`;

  if (!stmts.length) return `${header}\n-- (no tables selected)`;

  const body = stmts.map((s) => s.sql).join('\n');

  // Vistas: `input.views` ya son las miembro del canvas (`canvasDdlViews`); de
  // ellas entra toda vista con alguna fuente dentro del set exportado (o sin
  // fuentes). `showOnCanvas` no decide cuáles: con Export rules solo marca la
  // vista de negocio (`rulesBridge`).
  let viewsOut = '';
  if (o.includeViews && input.views?.length) {
    const vs = viewStatements(input, o);
    if (vs.length) {
      viewsOut = `\n-- ${vs.length} view(s)\n` + vs.map((v) => v.sql).join('\n');
    }
  }

  return `${header}\n${body}${viewsOut}`.trimEnd() + '\n';
}

/** Nombre de archivo seguro para la descarga. Una sola tabla ⇒ su nombre físico. */
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
