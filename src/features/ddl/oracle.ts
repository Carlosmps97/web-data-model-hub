// ─────────────────────────────────────────────────────────────────────────────
// Oracle DDL generator (doc 101 — Export DDL · dialecto Oracle).
//
// PURO y con el MISMO input que el generador de Databricks (`generators.ts`).
// Lo que cambia es la sintaxis:
//  - `CREATE TABLE` simple (Oracle no tiene OR REPLACE para tablas) con la PK
//    adentro. Las FK son `ALTER TABLE … ADD CONSTRAINT` y van TODAS después de
//    todas las tablas (en el script único) o en su propio archivo del `.zip`
//    (`oracleForeignKeysFile`): así nunca corren antes que su tabla padre, ni
//    con ciclos. Nombres de constraint únicos y de a lo sumo 128 bytes.
//  - Comentarios con `COMMENT ON TABLE / COLUMN` (Oracle no los acepta dentro
//    del CREATE): recortados a 4 000 bytes y sin nada que corte la sentencia en
//    SQL*Plus / SQL Developer (líneas en blanco, líneas que terminan en «;»,
//    líneas de solo «/» o «.», líneas de más de 2 000 caracteres). Si algo trae
//    «&», el script arranca con `SET DEFINE OFF`.
//  - Identificadores con comillas DOBLES solo si el nombre las necesita (o
//    siempre, si así se configura).
//  - Sin particiones, LOCATION, TBLPROPERTIES, tags, USING ni Unity Catalog:
//    no existen en Oracle. Las Export rules tampoco corren (son de Databricks).
//  - Tipos: TAL CUAL el modelo, con el casing elegido; solo se reemplazan los
//    que Oracle no tiene, según el mapeo de tipos de la configuración (dato
//    del proyecto, editable en Data Standards), y un largo que la base no
//    admite pasa a LOB según su MAX_STRING_SIZE. Defaults espejo de
//    `app/features/ddl_rules/output.py` (backend).
// ─────────────────────────────────────────────────────────────────────────────
import { foldComplexType } from '@/lib/typeText';
import {
  pkFirstColumns,
  type DatabricksDdlInput, type DdlColumn, type DdlRelationship, type DdlTable, type DdlView,
  type IdentifierCase, type QuoteMode, type TypeCase,
} from './generators';

/** Una fila del mapeo de tipos: `from` (tipo del modelo) → `to` (tipo Oracle). */
export interface OracleTypeMapping { from: string; to: string }

/** MAX_STRING_SIZE de la base destino: `standard` = VARCHAR2 hasta 4 000 bytes
 *  (NVARCHAR2 2 000 caracteres, RAW 2 000); `extended` = 32 767. */
export type MaxStringSize = 'standard' | 'extended';

/** Configuración PROPIA de Oracle (doc 101 §4.1) — independiente de la de Databricks. */
export interface OracleDdlOptions {
  /** `CREATE OR REPLACE VIEW` por cada vista del canvas exportado. */
  includeViews: boolean;
  /** PRIMARY KEY / FOREIGN KEY y NOT NULL. */
  includeKeys: boolean;
  /** `COMMENT ON TABLE / COLUMN` desde las definiciones. */
  includeComments: boolean;
  identifierCase: IdentifierCase;
  quoteIdentifiers: QuoteMode;
  typeCase: TypeCase;
  /** Largo máximo de los tipos de texto/binarios; lo que lo pase sale CLOB / NCLOB / BLOB. */
  maxStringSize: MaxStringSize;
  /** Esquema de las tablas sin esquema; vacío = nombre sin calificar (el esquema del usuario). */
  defaultSchema: string;
  /** Tipos que Oracle no tiene → su equivalente (ver `oracleType`). */
  typeMap: OracleTypeMapping[];
}

/** Tipos del catálogo de la plataforma que NO existen en Oracle (o que Oracle
 *  no acepta sin largo) — doc 101 §4.3. Espejo de `ORACLE_TYPE_MAP_DEFAULT` del
 *  backend. */
export const DEFAULT_ORACLE_TYPE_MAP: readonly OracleTypeMapping[] = [
  { from: 'DATETIME', to: 'DATE' },
  { from: 'STRING', to: 'VARCHAR2(4000)' },
  { from: 'VARCHAR', to: 'VARCHAR(4000)' },
  { from: 'VARCHAR2', to: 'VARCHAR2(4000)' },
  { from: 'VARCHAR(MAX)', to: 'CLOB' },
  { from: 'NVARCHAR', to: 'NVARCHAR2(2000)' },
  { from: 'NVARCHAR(MAX)', to: 'NCLOB' },
  { from: 'TEXT', to: 'CLOB' },
  { from: 'DECIMAL', to: 'DECIMAL(38,18)' },
  { from: 'NUMERIC', to: 'NUMERIC(38,18)' },
  { from: 'BIGINT', to: 'NUMBER(19)' },
  { from: 'TINYINT', to: 'NUMBER(3)' },
  { from: 'DOUBLE', to: 'BINARY_DOUBLE' },
  { from: 'MONEY', to: 'NUMBER(19,4)' },
  { from: 'BOOLEAN', to: 'NUMBER(1)' },
  { from: 'TIMESTAMPTZ', to: 'TIMESTAMP WITH TIME ZONE' },
  { from: 'TIME', to: 'DATE' },
  { from: 'BINARY', to: 'BLOB' },
  { from: 'VARBINARY', to: 'RAW(2000)' },
  { from: 'VARBINARY(MAX)', to: 'BLOB' },
  { from: 'BYTES', to: 'BLOB' },
  { from: 'JSON', to: 'CLOB' },
  { from: 'JSONB', to: 'CLOB' },
  { from: 'VARIANT', to: 'CLOB' },
  { from: 'XML', to: 'XMLTYPE' },
  { from: 'UUID', to: 'VARCHAR2(36)' },
  { from: 'ARRAY', to: 'CLOB' },
  { from: 'MAP', to: 'CLOB' },
  { from: 'STRUCT', to: 'CLOB' },
];

/** Defaults de Oracle = lo pedido por el owner para el proyecto RDV (comentarios
 *  OFF, PK/FK ON, tipos en MAYÚSCULA) + identificadores en MAYÚSCULA y la base
 *  con MAX_STRING_SIZE estándar (lo que trae Oracle de fábrica). */
export const DEFAULT_ORACLE_OPTS: OracleDdlOptions = {
  includeViews: true,
  includeKeys: true,
  includeComments: false,
  identifierCase: 'upper',
  quoteIdentifiers: 'when-needed',
  typeCase: 'upper',
  maxStringSize: 'standard',
  defaultSchema: '',
  typeMap: DEFAULT_ORACLE_TYPE_MAP.map((m) => ({ ...m })),
};

/** Palabras reservadas de Oracle (SQL Language Reference, «Oracle SQL Reserved
 *  Words»): como identificador exigen comillas dobles. */
export const ORACLE_RESERVED_WORDS: ReadonlySet<string> = new Set(`
ACCESS ADD ALL ALTER AND ANY AS ASC AUDIT BETWEEN BY CHAR CHECK CLUSTER COLUMN
COLUMN_VALUE COMMENT COMPRESS CONNECT CREATE CURRENT DATE DECIMAL DEFAULT DELETE DESC
DISTINCT DROP ELSE EXCLUSIVE EXISTS FILE FLOAT FOR FROM GRANT GROUP HAVING IDENTIFIED
IMMEDIATE IN INCREMENT INDEX INITIAL INSERT INTEGER INTERSECT INTO IS LEVEL LIKE LOCK
LONG MAXEXTENTS MINUS MLSLABEL MODE MODIFY NESTED_TABLE_ID NOAUDIT NOCOMPRESS NOT NOWAIT
NULL NUMBER OF OFFLINE ON ONLINE OPTION OR ORDER PCTFREE PRIOR PRIVILEGES PUBLIC RAW
RENAME RESOURCE REVOKE ROW ROWID ROWNUM ROWS SELECT SESSION SET SHARE SIZE SMALLINT
START SUCCESSFUL SYNONYM SYSDATE TABLE THEN TO TRIGGER UID UNION UNIQUE UPDATE USER
VALIDATE VALUES VARCHAR VARCHAR2 VIEW WHENEVER WHERE WITH
`.split(/\s+/).filter(Boolean));

// Sin comillas, un identificador Oracle empieza con letra y sigue con letras,
// dígitos, `_`, `$` o `#`.
const ORACLE_SAFE_IDENT = /^[A-Za-z][A-Za-z0-9_$#]*$/;

/** true si el nombre NO compila sin comillas dobles en Oracle. */
export const oracleNeedsQuote = (s: string): boolean =>
  !ORACLE_SAFE_IDENT.test(s) || ORACLE_RESERVED_WORDS.has(s.toUpperCase());

const caseWith = (s: string, mode: IdentifierCase): string =>
  mode === 'lower' ? s.toLowerCase() : mode === 'upper' ? s.toUpperCase() : s;

/** Literal de texto SQL (comilla simple duplicada). */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Identificador del modelo con el casing y las comillas de la configuración.
 *  Oracle no admite comillas dobles DENTRO de un identificador: se quitan. */
function identOf(o: Pick<OracleDdlOptions, 'identifierCase' | 'quoteIdentifiers'>): (s: string) => string {
  return (s: string) => {
    const c = caseWith(s, o.identifierCase);
    return o.quoteIdentifiers === 'always' || oracleNeedsQuote(c) ? `"${c.replace(/"/g, '')}"` : c;
  };
}

const utf8 = new TextEncoder();
const bytesOf = (s: string): number => utf8.encode(s).length;

// ── Tipos ────────────────────────────────────────────────────────────────────

const normType = (s: string): string => s.replace(/\s+/g, '').toUpperCase();
// `BASE` o `BASE(args)`; la base puede tener varias palabras (DOUBLE PRECISION).
const SIMPLE_TYPE = /^([A-Za-z][A-Za-z0-9_ ]*?)\s*(\([^()]*\))?$/;
// Complejo: `ARRAY<…>`, `MAP<…>`, `STRUCT<…>` (el `<…>` no es un largo).
const COMPLEX_TYPE = /^([A-Za-z][A-Za-z0-9_]*)\s*<[\s\S]*>$/;
// Tipos Oracle que llevan largo / precisión entre paréntesis.
const TAKES_LENGTH: ReadonlySet<string> = new Set([
  'VARCHAR2', 'VARCHAR', 'NVARCHAR2', 'CHAR', 'NCHAR', 'CHARACTER', 'RAW', 'NUMBER', 'FLOAT',
  'DECIMAL', 'DEC', 'NUMERIC', 'TIMESTAMP', 'UROWID',
]);
// La precisión de un TIMESTAMP … TIME ZONE va después de TIMESTAMP.
const WITH_TIME_ZONE = /^TIMESTAMP\s+(WITH\s+(?:LOCAL\s+)?TIME\s+ZONE)$/i;

/** El destino de una fila aplicado a una columna: sin largo, el destino tal
 *  cual; con largo, el de la columna si el destino lo admite (y en su lugar),
 *  si no se descarta (DATETIME(3) → DATE). Si el largo del destino se mide en
 *  CHAR o BYTE y el de la columna es solo un número, lo hereda:
 *  `VARCHAR(30)` con destino `VARCHAR2(4000 CHAR)` → `VARCHAR2(30 CHAR)`. */
function withColumnLength(to: string, colParams: string | null): string {
  if (!colParams) return to;
  const tz = WITH_TIME_ZONE.exec(to);
  if (tz) return `TIMESTAMP${colParams} ${tz[1]}`;
  const m = SIMPLE_TYPE.exec(to);
  if (!m) return to;
  const base = m[1].trim();
  if (!m[2] && !TAKES_LENGTH.has(normType(base))) return base;
  const unit = m[2] ? /\s(CHAR|BYTE)\s*\)$/i.exec(m[2])?.[1] : undefined;
  const params = unit && /^\(\s*\d+\s*\)$/.test(colParams)
    ? colParams.replace(/\s*\)$/, ` ${unit.toUpperCase()})`)
    : colParams;
  return `${base}${params}`;
}

/** Tipo Oracle según el mapeo, o null si ninguna fila aplica. Reglas (doc 101):
 *  1) una fila cuyo origen es el tipo COMPLETO de la columna (sin distinguir
 *     espacios ni mayúsculas) — un origen con paréntesis (`VARCHAR(MAX)`) solo
 *     aplica así —, y su destino sale tal cual;
 *  2) si no, la fila del tipo BASE (origen sin paréntesis): el largo del
 *     destino es el de las columnas SIN largo; una columna CON largo conserva
 *     el suyo si el destino lo admite (`NVARCHAR(50)` → `NVARCHAR2(50)`,
 *     `VARCHAR(30)` → `VARCHAR(30)`) y lo pierde si no (`DATETIME(3)` → `DATE`).
 *     Un complejo pierde su `<…>`. Gana la primera fila. */
function mapType(src: string, map: readonly OracleTypeMapping[]): string | null {
  const rows = map
    .map((m) => ({ from: (m.from ?? '').trim(), to: (m.to ?? '').trim() }))
    .filter((m) => m.from && m.to);
  const key = normType(src);
  const exact = rows.find((m) => normType(m.from) === key);
  if (exact) return exact.to;
  const simple = SIMPLE_TYPE.exec(src);
  const complex = simple ? null : COMPLEX_TYPE.exec(src);
  const baseText = simple?.[1] ?? complex?.[1];
  if (!baseText) return null;
  const base = normType(baseText);
  const row = rows.find((m) => !/[(<]/.test(m.from) && normType(m.from) === base);
  return row ? withColumnLength(row.to, simple?.[2] ?? null) : null;
}

// Texto de un tipo del mapeo — espejo de `_TYPE_TEXT` / `_TYPE_MAX` del backend
// (sale TAL CUAL en el DDL: nada de `;`, comillas, saltos de línea ni `--`).
const TYPE_TEXT = /^[A-Za-z][A-Za-z0-9_ (),<>:*.-]*$/;
const TYPE_TEXT_MAX = 100;

/** Problemas del mapeo de tipos que el guardado rechazaría (espejo de la
 *  validación del backend): una fila con un solo lado, un texto que no es un
 *  tipo (o de más de 100 caracteres) y un origen repetido (sin distinguir
 *  mayúsculas ni espacios — gana siempre la primera fila). Filas 1-based, como
 *  las ve el usuario. Pura. */
export function typeMapIssues(map: OracleTypeMapping[]): { rows: Set<number>; messages: string[] } {
  const rows = new Set<number>();
  const messages: string[] = [];
  const first = new Map<string, number>();
  map.forEach((m, i) => {
    const row = i + 1;
    const from = (m.from ?? '').replace(/\s+/g, ' ').trim();
    const to = (m.to ?? '').replace(/\s+/g, ' ').trim();
    if (!from && !to) return;
    if (!from || !to) {
      rows.add(row);
      messages.push(`Row ${row}: ${from ? 'the Oracle type' : 'the model type'} is missing.`);
      return;
    }
    const bad = [[from, 'model type'], [to, 'Oracle type']].find(([text]) => text.length > TYPE_TEXT_MAX
      || text.includes('--') || !TYPE_TEXT.test(text));
    if (bad) {
      rows.add(row);
      messages.push(bad[0].length > TYPE_TEXT_MAX
        ? `Row ${row}: the ${bad[1]} is longer than ${TYPE_TEXT_MAX} characters.`
        : `Row ${row}: '${bad[0].slice(0, 40)}' isn't a valid data type.`);
      return;
    }
    const key = normType(from);
    const prev = first.get(key);
    if (prev !== undefined) {
      rows.add(row);
      messages.push(`Row ${row}: ${from} is already mapped in row ${prev} — only the first row applies.`);
    } else {
      first.set(key, row);
    }
  });
  return { rows, messages };
}

// Largos máximos (doc 101 · revisión): lo que los pasa no compila en Oracle.
const LENGTH_TYPE = /^([A-Za-z][A-Za-z0-9_]*)\s*\(\s*(\d+)(?:\s+(?:CHAR|BYTE))?\s*\)$/i;
const STRING_LIMITS: Record<MaxStringSize, Record<string, number>> = {
  standard: { VARCHAR2: 4000, VARCHAR: 4000, NVARCHAR2: 2000, RAW: 2000 },
  extended: { VARCHAR2: 32767, VARCHAR: 32767, NVARCHAR2: 16383, RAW: 32767 },
};
const FIXED_LIMITS: Record<string, number> = { CHAR: 2000, NCHAR: 1000 };
const LOB_OF: Record<string, string> = {
  VARCHAR2: 'CLOB', VARCHAR: 'CLOB', CHAR: 'CLOB', NVARCHAR2: 'NCLOB', NCHAR: 'NCLOB', RAW: 'BLOB',
};

// Tipos Oracle sin argumentos (`INT(11)` — display width de otros motores — no compila)
// y precisión máxima de los que sí llevan.
const NO_ARGS: ReadonlySet<string> = new Set([
  'INT', 'INTEGER', 'SMALLINT', 'DATE', 'CLOB', 'NCLOB', 'BLOB', 'BFILE', 'LONG', 'BINARY_FLOAT',
  'BINARY_DOUBLE', 'REAL', 'ROWID', 'XMLTYPE',
]);
const MAX_PRECISION: Record<string, number> = { NUMBER: 38, DECIMAL: 38, NUMERIC: 38, DEC: 38, FLOAT: 126, TIMESTAMP: 9 };
const ARGS_TYPE = /^([A-Za-z][A-Za-z0-9_]*)\s*\(([^()]*)\)(.*)$/;

/** Argumentos que Oracle no admite: se quitan de un tipo que no lleva
 *  (`INT(11)` → `INT`) y una precisión fuera de rango baja a la máxima
 *  (`NUMBER(40,2)` → `NUMBER(38,2)`, `TIMESTAMP(10)` → `TIMESTAMP(9)`). */
function fitArgs(t: string): string {
  const m = ARGS_TYPE.exec(t.trim());
  if (!m) return t;
  const base = m[1].toUpperCase();
  if (NO_ARGS.has(base) && !m[3].trim()) return m[1];
  const cap = MAX_PRECISION[base];
  const args = m[2].split(',').map((a) => a.trim());
  if (cap === undefined || !(Number(args[0]) > cap)) return t;
  args[0] = String(cap);
  return `${m[1]}(${args.join(',')})${m[3]}`;
}

/** Un tipo de texto/binario con un largo que la base no admite pasa a su LOB. */
function fitLength(t: string, size: MaxStringSize): string {
  const m = LENGTH_TYPE.exec(t.trim());
  if (!m) return t;
  const base = m[1].toUpperCase();
  const max = FIXED_LIMITS[base] ?? STRING_LIMITS[size][base];
  return max !== undefined && Number(m[2]) > max ? LOB_OF[base] : t;
}

/** Tipo de una columna tal como sale en el CREATE de Oracle: el del modelo con
 *  el casing `typeCase`, salvo que el mapeo lo reemplace o que su largo no
 *  quepa (→ LOB). Sin tipo = STRING (como en Databricks), que el mapeo por
 *  default lleva a VARCHAR2(4000). Un complejo sin mapeo sale verbatim (los
 *  nombres de sus campos son del modelo). */
export function oracleType(
  raw: string, o: Pick<OracleDdlOptions, 'typeCase' | 'typeMap'> & Partial<Pick<OracleDdlOptions, 'maxStringSize'>>,
): string {
  const src = foldComplexType((raw ?? '').trim()) || 'STRING';
  const mapped = mapType(src, o.typeMap ?? []);
  if (mapped === null && src.includes('<')) return src;
  const out = fitLength(fitArgs(mapped ?? src), o.maxStringSize ?? 'standard');
  return o.typeCase === 'upper' ? out.toUpperCase() : out.toLowerCase();
}

// ── Comentarios ─────────────────────────────────────────────────────────────

/** Máximo de un comentario en Oracle (COMMENT ON … IS '…'). */
export const ORACLE_MAX_COMMENT_BYTES = 4000;
// SQL*Plus no acepta líneas de más de 2 499 caracteres: con margen para el
// `COMMENT ON COLUMN esquema.tabla.columna IS '` de la primera.
const MAX_COMMENT_LINE = 2000;

// SQL*Plus / SQL Developer dentro de una sentencia: una línea que termina en «;»
// la cierra, una línea de solo «/» la ejecuta, una de solo «.» la corta y una que
// empieza con «#» (SQLPREFIX) corre como comando aparte.
const ENDS_STATEMENT = (l: string) => l.endsWith(';');
const LONE_BREAK = (l: string) => /^\s*[/.]\s*$/.test(l);
// Peligrosa si queda al INICIO de una línea física (la primera del literal va
// en la misma línea que `COMMENT ON … IS '`: esa no cuenta).
const BREAKS_STATEMENT = (l: string) => LONE_BREAK(l) || /^\s*#/.test(l);

/** Índice hasta el que una línea entra en el tope, medida como queda en el
 *  literal (cada «'» sale duplicada). */
function fitIndex(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n += s[i] === "'" ? 2 : 1;
    if (n > MAX_COMMENT_LINE) return i;
  }
  return s.length;
}
const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Parte una línea larga en un espacio antes del tope, sin dejar una pieza en
 *  blanco ni una línea que termine en «;» o que arranque la siguiente de forma
 *  peligrosa; sin espacio posible, en un corte duro con el mismo cuidado (y sin
 *  partir un carácter de dos unidades, como un emoji). */
function wrapLine(line: string): string[] {
  const out: string[] = [];
  let rest = line;
  const unsafe = (cut: number, skip: number): boolean => {
    const head = rest.slice(0, cut);
    return head.trim() === '' || ENDS_STATEMENT(head) || LONE_BREAK(head) || BREAKS_STATEMENT(rest.slice(cut + skip));
  };
  for (let limit = fitIndex(rest); limit < rest.length; limit = fitIndex(rest)) {
    let cut = rest.lastIndexOf(' ', limit);
    while (cut > 0 && unsafe(cut, 1)) cut = rest.lastIndexOf(' ', cut - 1);
    if (cut > 0) { out.push(rest.slice(0, cut)); rest = rest.slice(cut + 1); continue; }
    let hard = limit;
    while (hard > 1 && (unsafe(hard, 0) || isHighSurrogate(rest.charCodeAt(hard - 1)))) hard--;
    out.push(rest.slice(0, hard));
    rest = rest.slice(hard);
  }
  out.push(rest);
  return out;
}

/** Texto de un COMMENT de Oracle que corre igual en SQL*Plus / SQL Developer:
 *  sin líneas en blanco (cortan la sentencia), una línea que termina en «;» o
 *  una línea de solo «/» o «.», o que empieza con «#», se pega a su vecina
 *  (cerrarían, ejecutarían o partirían la sentencia dentro del literal), líneas
 *  de a lo sumo 2 000 caracteres partidas en cortes seguros; y a lo sumo 4 000
 *  bytes UTF-8, sin partir un carácter. */
export function oracleComment(s: string): string {
  const lines = (s ?? '').replace(/\r\n?/g, '\n').split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '');
  const joined: string[] = [];
  for (const line of lines) {
    const prev = joined.length ? joined[joined.length - 1] : null;
    if (prev !== null && (ENDS_STATEMENT(prev) || BREAKS_STATEMENT(line))) joined[joined.length - 1] = `${prev} ${line.trim()}`;
    else joined.push(line);
  }
  const text = joined.flatMap(wrapLine).join('\n').trim();
  if (bytesOf(text) <= ORACLE_MAX_COMMENT_BYTES) return text;
  let bytes = 0;
  let out = '';
  for (const ch of text) {
    const n = bytesOf(ch);
    if (bytes + n > ORACLE_MAX_COMMENT_BYTES) break;
    bytes += n;
    out += ch;
  }
  return out.trimEnd();                       // el corte pudo caer justo después de un salto de línea
}

/** SQL*Plus y SQL Developer toman «&x» como variable de sustitución. */
const DEFINE_OFF = 'SET DEFINE OFF';
const withDefineOff = (sql: string): string => (sql.includes('&') ? `${DEFINE_OFF}\n${sql}` : sql);

// ── Nombres de constraint ───────────────────────────────────────────────────

/** Oracle: nombres de hasta 128 bytes. Uno más largo se recorta y lleva un hash corto (determinista). */
const MAX_NAME_BYTES = 128;
function capName(raw: string): string {
  if (bytesOf(raw) <= MAX_NAME_BYTES) return raw;
  let h = 0x811c9dc5;                                            // FNV-1a 32 bits
  for (const ch of raw) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  const hash = h.toString(16).padStart(8, '0');
  let head = '';
  for (const ch of raw) {
    if (bytesOf(head + ch) > MAX_NAME_BYTES - hash.length - 1) break;
    head += ch;
  }
  return `${head}_${hash}`;
}

// ── Sentencias ──────────────────────────────────────────────────────────────

interface Ctx {
  o: OracleDdlOptions;
  ident: (s: string) => string;
  tables: DdlTable[];                                  // las del export, en su orden
  tableById: Map<string, DdlTable>;
  colName: Map<string, string>;
  byTable: Map<string, DdlColumn[]>;
  /** tabla → NOMBRE EN MAYÚSCULA → nombre físico real (las vistas lo usan). */
  realColumn: Map<string, Map<string, string>>;
  rels: DdlRelationship[];                             // FK con padre e hijo dentro del export
  pkName: Map<string, string>;
  fkName: Map<string, string>;
}

function qualifiedName(schema: string, name: string, ident: (s: string) => string): string {
  return schema ? `${ident(schema)}.${ident(name)}` : ident(name);
}

/** Nombre calificado de una tabla: su esquema, o el de por default, o nada. */
function qualify(t: DdlTable, ctx: Ctx): string {
  const schema = t.schema?.trim() || (ctx.o.defaultSchema ?? '').trim();
  return qualifiedName(schema, t.physicalName, ctx.ident);
}

/** Columnas de la FK en el hijo (null si algún par cae fuera del export). */
function fkColumns(r: DdlRelationship, ctx: Ctx): DdlColumn[] | null {
  const cols = ctx.byTable.get(r.childTableId) ?? [];
  const out = r.pairs.map((p) => cols.find((c) => c.id === p.childColumnId)).filter((c): c is DdlColumn => !!c);
  return r.pairs.length && out.length === r.pairs.length ? out : null;
}

function contextOf(input: DatabricksDdlInput, o: OracleDdlOptions): Ctx {
  const wanted = input.tableIds && input.tableIds.length ? new Set(input.tableIds) : null;
  const tables = input.tables.filter((t) => !wanted || wanted.has(t.id));
  const byTable = new Map<string, DdlColumn[]>();
  const realColumn = new Map<string, Map<string, string>>();
  for (const c of input.columns) {
    (byTable.get(c.tableId) ?? byTable.set(c.tableId, []).get(c.tableId)!).push(c);
    (realColumn.get(c.tableId) ?? realColumn.set(c.tableId, new Map()).get(c.tableId)!)
      .set(c.physicalName.toUpperCase(), c.physicalName);
  }
  const ids = new Set(tables.map((t) => t.id));
  const ctx: Ctx = {
    o, ident: identOf(o), tables,
    tableById: new Map(input.tables.map((t) => [t.id, t])),
    colName: new Map(input.columns.map((c) => [c.id, c.physicalName])),
    byTable, realColumn,
    rels: input.relationships.filter((r) => ids.has(r.parentTableId) && ids.has(r.childTableId)),
    pkName: new Map(), fkName: new Map(),
  };
  // Nombres de constraint: únicos en el export (sin distinguir mayúsculas) y
  // deterministas — primero las PK en el orden de las tablas, después las FK.
  const used = new Set<string>();
  const take = (raw: string): string => {
    let name = capName(raw);
    for (let n = 2; used.has(name.toUpperCase()); n++) name = capName(`${raw}_${n}`);
    used.add(name.toUpperCase());
    return name;
  };
  if (o.includeKeys) {
    for (const t of tables) {
      if ((byTable.get(t.id) ?? []).some((c) => c.isPrimaryKey)) ctx.pkName.set(t.id, take(`pk_${t.physicalName}`));
    }
    for (const t of tables) {
      for (const r of ctx.rels) {
        if (r.childTableId !== t.id) continue;
        const cols = fkColumns(r, ctx);
        if (cols) ctx.fkName.set(r.id, take(`fk_${t.physicalName}_${cols[0].physicalName}`));
      }
    }
  }
  return ctx;
}

/** CREATE TABLE (+ sus COMMENT ON) de una tabla — sin FK. */
function tableDDL(t: DdlTable, ctx: Ctx): string {
  const { o, ident } = ctx;
  const full = qualify(t, ctx);
  // Doc 94: el orden único — PK primero y cada bloque por ordinal.
  const ordered = pkFirstColumns(ctx.byTable.get(t.id) ?? []);
  const inner = ordered.map((c) => {
    let l = `  ${ident(c.physicalName)} ${oracleType(c.dataType, o)}`;
    if (o.includeKeys && (c.isNullable === false || c.isPrimaryKey)) l += ' NOT NULL';
    return l;
  });
  const pk = ctx.pkName.get(t.id);
  if (o.includeKeys && pk) {
    const pks = ordered.filter((c) => c.isPrimaryKey).map((c) => ident(c.physicalName));
    inner.push(`  CONSTRAINT ${ident(pk)} PRIMARY KEY (${pks.join(', ')})`);
  }
  let out = `CREATE TABLE ${full} (\n${inner.join(',\n')}\n);\n`;

  if (o.includeComments) {
    const td = oracleComment(t.description ?? '');
    if (td) out += `COMMENT ON TABLE ${full} IS ${lit(td)};\n`;
    for (const c of ordered) {
      // Doc 85 D10: el comment FÍSICO manda; si no hay, la definición.
      const cm = oracleComment((c.physicalDescription ?? '').trim() || (c.description ?? ''));
      if (cm) out += `COMMENT ON COLUMN ${full}.${ident(c.physicalName)} IS ${lit(cm)};\n`;
    }
  }
  return out;
}

/** Los `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` del export: la tiene el
 *  HIJO; una relación con varios pares = UNA constraint compuesta. */
function foreignKeys(ctx: Ctx): string[] {
  const { o, ident } = ctx;
  if (!o.includeKeys) return [];
  const out: string[] = [];
  for (const t of ctx.tables) {
    for (const r of ctx.rels) {
      if (r.childTableId !== t.id) continue;
      const cols = fkColumns(r, ctx);
      const name = ctx.fkName.get(r.id);
      if (!cols || !name) continue;
      const parent = ctx.tableById.get(r.parentTableId);
      const parentRef = parent ? qualify(parent, ctx) : ident(r.parentTableId);
      const parentCols = r.pairs.map((p) => ctx.colName.get(p.parentColumnId) ?? p.parentColumnId);
      out.push(`ALTER TABLE ${qualify(t, ctx)} ADD CONSTRAINT ${ident(name)}`
        + ` FOREIGN KEY (${cols.map((c) => ident(c.physicalName)).join(', ')})`
        + ` REFERENCES ${parentRef} (${parentCols.map((c) => ident(c)).join(', ')});`);
    }
  }
  return out;
}

/** `CREATE OR REPLACE VIEW` Oracle — misma estructura que la de Databricks
 *  (`viewDDL`): expresión VERBATIM > `CAST(col AS tipo) AS alias` > `col AS
 *  alias`; con 2+ fuentes, alias posicionales t1, t2… y `FROM a t1, b t2`. Las
 *  columnas llevan el nombre REAL de la columna de su tabla y el MISMO casing y
 *  comillas que las columnas de la tabla (en Oracle, un nombre entre comillas
 *  distingue mayúsculas); el tipo del CAST pasa por el mapeo. */
function viewDDL(v: DdlView, ctx: Ctx): string {
  const { o, ident } = ctx;
  const srcIds = v.sourceTableIds?.length ? v.sourceTableIds : (v.tableId ? [v.tableId] : []);
  const base = srcIds.length ? ctx.tableById.get(srcIds[0]) : undefined;
  const schema = v.schema?.trim() || base?.schema?.trim() || (o.defaultSchema ?? '').trim();
  const full = qualifiedName(schema, v.name, ident);

  const aliased = srcIds.length > 1;
  const aliasOf = new Map(srcIds.map((id, i) => [id, `t${i + 1}`]));
  const refOf = (id: string) => { const t = ctx.tableById.get(id); return t ? qualify(t, ctx) : ident(id); };
  const srcs = (v.sources ?? []).filter((s) => (s.column ?? '').trim() || (s.expression ?? '').trim());

  let from: string;
  if (!srcIds.length) from = full;
  else if (!aliased) from = refOf(srcIds[0]);
  else from = srcIds.map((id) => `${refOf(id)} ${aliasOf.get(id)}`).join(',\n  ');

  let body: string;
  if (srcs.length === 0) {
    body = (!base && v.sql?.trim()) ? v.sql.trim().replace(/;\s*$/, '') : `SELECT *\nFROM ${from}`;
  } else {
    const projections = srcs.map((s) => {
      const rawAlias = (s.outputAlias ?? '').trim();
      const cast = (s.castType ?? '').trim() ? oracleType(s.castType!, o) : '';
      const expr = (s.expression ?? '').trim();
      if (expr) return rawAlias && rawAlias !== expr ? `${expr} AS ${rawAlias}` : expr;
      const sourceId = s.tableId || srcIds[0] || '';
      const real = (ctx.byTable.get(sourceId) ?? []).find((c) => c.physicalName === s.column)?.physicalName
        ?? ctx.realColumn.get(sourceId)?.get(s.column!.toUpperCase()) ?? s.column!;
      const colName = ident(real);
      const col = aliased ? `${aliasOf.get(s.tableId ?? '') ?? 't1'}.${colName}` : colName;
      const alias = ident(rawAlias || s.column!);
      if (cast) return `CAST(${col} AS ${cast}) AS ${alias}`;
      return `${col} AS ${alias}`;
    });
    body = `SELECT\n  ${projections.join(',\n  ')}\nFROM ${from}`;
  }

  let out = `CREATE OR REPLACE VIEW ${full} AS\n${body};\n`;
  const vd = o.includeComments ? oracleComment(v.description ?? '') : '';
  if (vd) out += `COMMENT ON TABLE ${full} IS ${lit(vd)};\n`;
  return out;
}

function exportViews(input: DatabricksDdlInput, ctx: Ctx): DdlView[] {
  const ids = new Set(ctx.tables.map((t) => t.id));
  return (input.views ?? []).filter((v) => {
    const src = v.sourceTableIds?.length ? v.sourceTableIds : (v.tableId ? [v.tableId] : []);
    return src.length === 0 || src.some((id) => ids.has(id));
  });
}

/** Un statement por TABLA del set exportado: su CREATE y sus COMMENT ON (las FK
 *  van en `oracleForeignKeysFile`). Alimenta el `.zip` (un archivo por objeto). */
export function oracleTableStatements(
  input: DatabricksDdlInput, o: OracleDdlOptions,
): { table: DdlTable; sql: string }[] {
  const ctx = contextOf(input, o);
  return ctx.tables.map((t) => ({ table: t, sql: withDefineOff(tableDDL(t, ctx)) }));
}

/** Las vistas que entran al export (alguna fuente dentro del set) — mismo
 *  criterio que Databricks. */
export function oracleViewStatements(
  input: DatabricksDdlInput, o: OracleDdlOptions,
): { view: DdlView; sql: string }[] {
  const ctx = contextOf(input, o);
  return exportViews(input, ctx).map((v) => ({ view: v, sql: withDefineOff(viewDDL(v, ctx)) }));
}

/** El archivo de las FK del `.zip` (null si no hay): se corre al final, cuando
 *  ya existen todas las tablas. */
export function oracleForeignKeysFile(input: DatabricksDdlInput, o: OracleDdlOptions): string | null {
  const fks = foreignKeys(contextOf(input, o));
  if (!fks.length) return null;
  return withDefineOff(`-- ${input.modelName ?? 'model'} · Oracle · ${fks.length} foreign key(s)\n`
    + '-- Run after all the tables: every parent table must exist first.\n\n'
    + `${fks.join('\n')}\n`);
}

/** DDL Oracle de las tablas elegidas en un solo texto: tablas → FK → vistas. */
export function oracleDdl(input: DatabricksDdlInput, o: OracleDdlOptions): string {
  const ctx = contextOf(input, o);
  const header = `-- ${input.modelName ?? 'model'} · Oracle · ${ctx.tables.length} table(s)\n`
    + `-- Generated by Data Model Hub\n`;
  if (!ctx.tables.length) return withDefineOff(`${header}\n-- (no tables selected)`);
  const parts = [ctx.tables.map((t) => tableDDL(t, ctx)).join('\n')];
  const fks = foreignKeys(ctx);
  if (fks.length) parts.push(`\n-- ${fks.length} foreign key(s)\n${fks.join('\n')}\n`);
  if (o.includeViews) {
    const vs = exportViews(input, ctx);
    if (vs.length) parts.push(`\n-- ${vs.length} view(s)\n` + vs.map((v) => viewDDL(v, ctx)).join('\n'));
  }
  return withDefineOff(`${header}\n${parts.join('')}`.trimEnd() + '\n');
}
