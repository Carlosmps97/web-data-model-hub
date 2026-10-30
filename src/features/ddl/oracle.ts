// ─────────────────────────────────────────────────────────────────────────────
// Generador de DDL Oracle (Export DDL · dialecto Oracle).
//
// Puro y con el mismo input que el generador de Databricks (`generators.ts`).
// Lo que cambia es la sintaxis:
//  - `CREATE TABLE` simple (Oracle no tiene OR REPLACE para tablas) con la PK
//    adentro, como la escribe Erwin: `PRIMARY KEY (…) DISABLE NOVALIDATE`,
//    sin nombre. Las FK son `ALTER TABLE … ADD CONSTRAINT …
//    DISABLE NOVALIDATE` (Oracle no admite una FK habilitada sobre una PK
//    deshabilitada) y van todas después de todas las tablas (en el script
//    único) o en su propio archivo del `.zip` (`oracleForeignKeysFile`): así
//    nunca corren antes que su tabla padre, ni con ciclos. Nombres de FK únicos
//    y de a lo sumo 128 bytes.
//  - `NOT NULL` aparte de las llaves y apagado por default; sin esquema por
//    default (`CREATE TABLE DE_X`), o el del modelo, o uno elegido.
//  - Comentarios como los escribe Erwin: `COMMENT '…'` al final de cada columna
//    y el de la tabla después del `)` del CREATE; el de una vista, con
//    `COMMENT ON TABLE`. Recortados a 4 000 bytes y sin nada que corte la
//    sentencia en SQL*Plus / SQL Developer (líneas en blanco, líneas que
//    terminan en «;», líneas de solo «/» o «.», líneas de más de 2 000
//    caracteres). Si algo trae «&», el script arranca con `SET DEFINE OFF`.
//  - Identificadores con comillas dobles solo si el nombre las necesita (o
//    siempre, si así se configura).
//  - Sin particiones, LOCATION, TBLPROPERTIES, tags, USING ni Unity Catalog:
//    no existen en Oracle.
//  - Tipos: tal cual el modelo, solo con el casing elegido (sin mapeo de tipos
//    ni ajustes: un tipo que Oracle no acepta es del modelo, no del export).
//    Defaults espejo de `app/features/ddl_rules/output.py` (backend).
// ─────────────────────────────────────────────────────────────────────────────
import { foldComplexType } from '@/lib/typeText';
import {
  pkFirstColumns,
  type DatabricksDdlInput, type DdlColumn, type DdlRelationship, type DdlTable, type DdlView,
  type IdentifierCase, type QuoteMode, type TypeCase,
} from './generators';

/** Esquema de los nombres: ninguno (`CREATE TABLE DE_X`, como Erwin), el
 *  de cada objeto en el modelo, o uno elegido para todos (`defaultSchema`). */
export type OracleSchemaMode = 'none' | 'model' | 'custom';

/** Configuración propia de Oracle, independiente de la de Databricks. */
export interface OracleDdlOptions {
  /** `CREATE OR REPLACE VIEW` por cada vista del canvas exportado. */
  includeViews: boolean;
  /** PRIMARY KEY (`… DISABLE NOVALIDATE`) y FOREIGN KEY. */
  includeKeys: boolean;
  /** `NOT NULL` en las columnas obligatorias (y en las de la PK), aparte de las llaves. */
  includeNotNull: boolean;
  /** Comentarios de tablas, columnas y vistas desde las definiciones. */
  includeComments: boolean;
  identifierCase: IdentifierCase;
  quoteIdentifiers: QuoteMode;
  typeCase: TypeCase;
  /** De dónde sale el esquema de los nombres. */
  schemaMode: OracleSchemaMode;
  /** El esquema elegido para todos los objetos (solo con `schemaMode = custom`; vacío = sin esquema). */
  defaultSchema: string;
}

/** Defaults de Oracle: comentarios apagados, PK/FK encendidas, tipos e
 *  identificadores en mayúsculas y, como Erwin, sin NOT NULL y sin esquema. */
export const DEFAULT_ORACLE_OPTS: OracleDdlOptions = {
  includeViews: true,
  includeKeys: true,
  includeNotNull: false,
  includeComments: false,
  identifierCase: 'upper',
  quoteIdentifiers: 'when-needed',
  typeCase: 'upper',
  schemaMode: 'none',
  defaultSchema: '',
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

/** Devuelve true si el nombre no compila sin comillas dobles en Oracle. */
export const oracleNeedsQuote = (s: string): boolean =>
  !ORACLE_SAFE_IDENT.test(s) || ORACLE_RESERVED_WORDS.has(s.toUpperCase());

const caseWith = (s: string, mode: IdentifierCase): string =>
  mode === 'lower' ? s.toLowerCase() : mode === 'upper' ? s.toUpperCase() : s;

/** Literal de texto SQL (comilla simple duplicada). */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Identificador del modelo con el casing y las comillas de la configuración.
 *  Oracle no admite comillas dobles dentro de un identificador: se quitan. */
function identOf(o: Pick<OracleDdlOptions, 'identifierCase' | 'quoteIdentifiers'>): (s: string) => string {
  return (s: string) => {
    const c = caseWith(s, o.identifierCase);
    return o.quoteIdentifiers === 'always' || oracleNeedsQuote(c) ? `"${c.replace(/"/g, '')}"` : c;
  };
}

const utf8 = new TextEncoder();
const bytesOf = (s: string): number => utf8.encode(s).length;

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Tipo de una columna tal como sale en el CREATE de Oracle: el del modelo
 *  tal cual, con el casing `typeCase`. Sin tipo = STRING (como en
 *  Databricks). Un complejo sale verbatim en una línea (los nombres de sus
 *  campos son del modelo). */
export function oracleType(raw: string, o: Pick<OracleDdlOptions, 'typeCase'>): string {
  const src = foldComplexType((raw ?? '').trim()) || 'STRING';
  if (src.includes('<')) return src;
  return o.typeCase === 'upper' ? src.toUpperCase() : src.toLowerCase();
}

// ── Comentarios ─────────────────────────────────────────────────────────────

/** Máximo de un comentario en Oracle (4 000 bytes). */
export const ORACLE_MAX_COMMENT_BYTES = 4000;
// SQL*Plus no acepta líneas de más de 2 499 caracteres: con margen para lo que
// va antes en la primera (`  COLUMNA TIPO COMMENT '`, `COMMENT ON TABLE vista IS '`).
const MAX_COMMENT_LINE = 2000;

// SQL*Plus / SQL Developer dentro de una sentencia: una línea que termina en «;»
// la cierra, una línea de solo «/» la ejecuta, una de solo «.» la corta y una que
// empieza con «#» (SQLPREFIX) corre como comando aparte.
const ENDS_STATEMENT = (l: string) => l.endsWith(';');
const LONE_BREAK = (l: string) => /^\s*[/.]\s*$/.test(l);
// Peligrosa si queda al inicio de una línea física (la primera del literal va
// en la misma línea que `COMMENT '`: esa no cuenta).
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

/** Parte una línea larga en un espacio dentro del tope, sin dejar una pieza en
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
  /** tabla → nombre en mayúsculas → nombre físico real (las vistas lo usan). */
  realColumn: Map<string, Map<string, string>>;
  rels: DdlRelationship[];                             // FK con padre e hijo dentro del export
  fkName: Map<string, string>;
}

function qualifiedName(schema: string, name: string, ident: (s: string) => string): string {
  return schema ? `${ident(schema)}.${ident(name)}` : ident(name);
}

/** Esquema de un objeto según `schemaMode`: ninguno, el del modelo
 *  (`own`) o el elegido para todos. */
function schemaFor(own: string | undefined, o: OracleDdlOptions): string {
  if (o.schemaMode === 'model') return (own ?? '').trim();
  if (o.schemaMode === 'custom') return (o.defaultSchema ?? '').trim();
  return '';
}

/** Nombre de una tabla con el esquema que corresponde. */
function qualify(t: DdlTable, ctx: Ctx): string {
  return qualifiedName(schemaFor(t.schema, ctx.o), t.physicalName, ctx.ident);
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
    fkName: new Map(),
  };
  // Nombres de FK: únicos en el export (sin distinguir mayúsculas) y
  // deterministas, en el orden de las tablas. La PK va sin nombre.
  const used = new Set<string>();
  const take = (raw: string): string => {
    let name = capName(raw);
    for (let n = 2; used.has(name.toUpperCase()); n++) name = capName(`${raw}_${n}`);
    used.add(name.toUpperCase());
    return name;
  };
  if (o.includeKeys) {
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

/** CREATE TABLE de una tabla, con sus comentarios adentro como Erwin — sin FK. */
function tableDDL(t: DdlTable, ctx: Ctx): string {
  const { o, ident } = ctx;
  const full = qualify(t, ctx);
  // Orden único: PK primero y cada bloque por ordinal.
  const ordered = pkFirstColumns(ctx.byTable.get(t.id) ?? []);
  const inner = ordered.map((c) => {
    let l = `  ${ident(c.physicalName)} ${oracleType(c.dataType, o)}`;
    if (o.includeNotNull && (c.isNullable === false || c.isPrimaryKey)) l += ' NOT NULL';
    // El comment físico manda; si no hay, la definición.
    const cm = o.includeComments ? oracleComment((c.physicalDescription ?? '').trim() || (c.description ?? '')) : '';
    if (cm) l += ` COMMENT ${lit(cm)}`;
    return l;
  });
  // Como Erwin: sin nombre de constraint y DISABLE NOVALIDATE.
  const pks = ordered.filter((c) => c.isPrimaryKey).map((c) => ident(c.physicalName));
  if (o.includeKeys && pks.length) inner.push(`  PRIMARY KEY (${pks.join(', ')}) DISABLE NOVALIDATE`);
  const td = o.includeComments ? oracleComment(t.description ?? '') : '';
  return `CREATE TABLE ${full} (\n${inner.join(',\n')}\n)${td ? `\nCOMMENT ${lit(td)}` : ''};\n`;
}

/** Los `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` del export: la tiene el
 *  hijo; una relación con varios pares = una sola constraint compuesta. */
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
        + ` REFERENCES ${parentRef} (${parentCols.map((c) => ident(c)).join(', ')}) DISABLE NOVALIDATE;`);
    }
  }
  return out;
}

/** `CREATE OR REPLACE VIEW` Oracle — misma estructura que la de Databricks
 *  (`viewDDL`): expresión verbatim > `CAST(col AS tipo) AS alias` > `col AS
 *  alias`; con 2+ fuentes, alias posicionales t1, t2… y `FROM a t1, b t2`. Las
 *  columnas llevan el nombre real de la columna de su tabla y el mismo casing y
 *  comillas que las columnas de la tabla (en Oracle, un nombre entre comillas
 *  distingue mayúsculas); el tipo del CAST sale tal cual, con el
 *  casing de los tipos. */
function viewDDL(v: DdlView, ctx: Ctx): string {
  const { o, ident } = ctx;
  const srcIds = v.sourceTableIds?.length ? v.sourceTableIds : (v.tableId ? [v.tableId] : []);
  const base = srcIds.length ? ctx.tableById.get(srcIds[0]) : undefined;
  const schema = schemaFor(v.schema?.trim() || base?.schema, o);
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

/** Un statement por tabla del set exportado: su CREATE con sus comentarios (las
 *  FK van en `oracleForeignKeysFile`). Alimenta el `.zip` (un archivo por objeto). */
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
