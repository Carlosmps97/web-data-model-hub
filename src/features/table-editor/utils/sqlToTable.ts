/**
 * SQL → TableModel inference.
 *
 * Parsea un `SELECT` o un `CREATE TABLE ... AS SELECT` y propone la
 * forma de una nueva tabla:
 *
 *   - columnas directas  (`a.col`, `a.col AS x`, `a.*`)  →  heredan
 *     dataType / functionalDefinition / domain / subdomain / tags de
 *     la columna fuente encontrada en `sourceTables`.
 *   - expresiones        (`CAST(...)`, `CASE ... END`, `SUM(...)`, etc.)
 *     →  se infiere el tipo por heurística y se marca como "computed"
 *     para que el usuario confirme / ajuste en el preview.
 *   - JOINs detectados   (`LEFT JOIN b ON a.fk = b.pk`)  →  se devuelven
 *     como `InferredJoin[]` para que la UI los muestre como checkboxes
 *     de relaciones a crear.
 *
 * NO es un parser SQL completo. Es un *scanner* tolerante: si el SQL
 * es sintácticamente válido pero no soportado, se devuelve la mejor
 * aproximación posible + warnings legibles. No arroja en el caso feliz.
 *
 * Dialecto: neutral. No depende del engine del modelo; el tipo que
 * infiere es un string normalizado (e.g. `VARCHAR`, `NUMERIC(18,2)`,
 * `DATE`) y el consumidor decide si lo refina.
 */

import type { TableModel, TableColumn } from '@/types/model';

// ─── Public API shapes ───────────────────────────────────────────────

export type InferredColumnKind = 'direct' | 'wildcard' | 'expression';

export interface InferredColumn {
  /** Column name as it will live in the new table. */
  name: string;
  /** Proposed data type (normalised). */
  dataType: string;
  /** Inherited / inferred description. */
  functionalDefinition?: string;
  /** Inherited from source column. */
  domainId?: string;
  subdomainId?: string;
  tags?: string[];
  /** Kind of expression in the SELECT that produced this column. */
  kind: InferredColumnKind;
  /** Raw SQL snippet — helpful for the user in the preview. */
  rawExpression: string;
  /** When `kind === 'direct'` (or `wildcard`), points to the source. */
  sourceRef?: { tableName: string; columnName: string };
  /** Reasoning exposed to the user (why this type/name was chosen). */
  explanation: string;
}

export interface InferredJoin {
  leftTable: string;
  leftColumn: string;
  rightTable: string;
  rightColumn: string;
  joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'CROSS';
}

export interface ParsedSqlResult {
  /** True when we could extract at least a column list. */
  success: boolean;
  /** Name extracted from CTAS. Undefined when input was a bare SELECT. */
  tableName?: string;
  columns: InferredColumn[];
  joins: InferredJoin[];
  warnings: string[];
  errors: string[];
}

// ─── Internal helpers ────────────────────────────────────────────────

/** Strip single-line `--` and block `/* … *\/` comments without touching string literals. */
function stripComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    // String literals — copy verbatim, respect escaped quotes.
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += ch;
      i++;
      while (i < sql.length) {
        const c = sql[i];
        out += c;
        i++;
        if (c === '\\' && i < sql.length) { out += sql[i]; i++; continue; }
        if (c === quote) break;
      }
      continue;
    }
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Split `text` by `,` at depth-zero parenthesis nesting. Respects
 * string literals. Used for splitting SELECT column lists that contain
 * `CAST(…)` or `CASE …`.
 */
function splitTopLevel(text: string, sep = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let inString: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') { i++; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === "'" || c === '"') { inString = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && c === sep) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map(p => p.trim()).filter(Boolean);
}

/** Find the first occurrence of one of `keywords` at depth zero. */
function findTopLevelKeyword(text: string, keywords: string[]): { index: number; keyword: string } | null {
  const upper = text.toUpperCase();
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') { i++; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === "'" || c === '"') { inString = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0) {
      for (const kw of keywords) {
        if (upper.startsWith(kw, i)) {
          // must be bounded (start-of-string or non-word before, same after).
          const before = i === 0 ? ' ' : text[i - 1];
          const after = text[i + kw.length] ?? ' ';
          if (!/[A-Z0-9_]/i.test(before) && !/[A-Z0-9_]/i.test(after)) {
            return { index: i, keyword: kw };
          }
        }
      }
    }
  }
  return null;
}

/** Unquote `"name"` or `` `name` `` or `[name]` → `name`. Leaves bare. */
function unquoteIdent(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('`') && t.endsWith('`'))) {
    return t.slice(1, -1);
  }
  if (t.startsWith('[') && t.endsWith(']')) return t.slice(1, -1);
  return t;
}

// ─── Column expression analysis ───────────────────────────────────────

/**
 * Try to interpret a single SELECT item (between commas, already trimmed).
 * Returns one or many InferredColumn — wildcards expand to many.
 */
function analyseSelectItem(
  raw: string,
  aliasMap: Map<string, TableModel>,
  allTables: TableModel[],
): InferredColumn[] {
  // Split off `AS <alias>` at depth zero. Both `foo AS bar` and `foo bar`
  // are valid, but we only honour the explicit `AS` form to avoid misreading
  // trailing cast syntax as an alias.
  const asSplit = splitOffAlias(raw);
  const expr = asSplit.expression.trim();
  const alias = asSplit.alias;

  // Wildcard: `*` or `a.*`
  if (expr === '*') {
    return allTables.flatMap((t) =>
      t.columns.map((c) => directColumnFromSource(c, t, c.name, '*')),
    );
  }
  const wildMatch = expr.match(/^([A-Za-z_][\w]*)\.\*$/);
  if (wildMatch) {
    const key = wildMatch[1].toLowerCase();
    const tbl = aliasMap.get(key);
    if (!tbl) {
      return [{
        kind: 'wildcard',
        name: `${wildMatch[1]}_all`,
        dataType: 'VARCHAR',
        rawExpression: expr,
        explanation: `Wildcard \`${expr}\` but table/alias "${wildMatch[1]}" was not found in sources.`,
      }];
    }
    return tbl.columns.map((c) => directColumnFromSource(c, tbl, c.name, expr));
  }

  // Plain identifier `foo` or qualified `a.foo`.
  const identMatch = expr.match(/^([A-Za-z_][\w]*)(?:\.([A-Za-z_][\w]*))?$/);
  if (identMatch) {
    const left = identMatch[1];
    const right = identMatch[2];
    // Unqualified column: search across tables, ambiguity warning.
    if (!right) {
      const candidates = allTables.flatMap((t) =>
        t.columns.filter((c) => c.name.toLowerCase() === left.toLowerCase()).map((c) => ({ t, c })),
      );
      if (candidates.length === 1) {
        return [directColumnFromSource(candidates[0].c, candidates[0].t, alias ?? left, expr)];
      }
      // 0 or many → expression-style fallback.
      return [{
        kind: candidates.length === 0 ? 'expression' : 'direct',
        name: alias ?? left,
        dataType: candidates[0]?.c.dataType ?? 'VARCHAR',
        functionalDefinition: candidates[0]?.c.functionalDefinition,
        rawExpression: expr,
        explanation:
          candidates.length === 0
            ? `Column "${left}" not found in any source table. Please set the type manually.`
            : `Column name "${left}" is ambiguous across source tables — picked the first match.`,
      }];
    }
    // Qualified: `a.col`
    const tbl = aliasMap.get(left.toLowerCase());
    if (!tbl) {
      return [{
        kind: 'expression',
        name: alias ?? right,
        dataType: 'VARCHAR',
        rawExpression: expr,
        explanation: `Table/alias "${left}" not found in the FROM clause.`,
      }];
    }
    const col = tbl.columns.find((c) => c.name.toLowerCase() === right.toLowerCase());
    if (!col) {
      return [{
        kind: 'expression',
        name: alias ?? right,
        dataType: 'VARCHAR',
        rawExpression: expr,
        explanation: `Column "${right}" not found in table "${tbl.name}".`,
      }];
    }
    return [directColumnFromSource(col, tbl, alias ?? right, expr)];
  }

  // Expression (function call, CASE, CAST, …). Infer type heuristically.
  const inferred = inferExpressionType(expr);
  return [{
    kind: 'expression',
    name: alias ?? inferred.fallbackName,
    dataType: inferred.dataType,
    rawExpression: expr,
    explanation: inferred.reason,
  }];
}

function directColumnFromSource(
  col: TableColumn,
  table: TableModel,
  finalName: string,
  rawExpression: string,
): InferredColumn {
  // Policy: inherit type + description + domain/subdomain + tags.
  // Do NOT inherit PK/FK/SK flags (those are per-table semantics),
  // nor default values / nullability / samples / observations.
  return {
    kind: 'direct',
    name: finalName,
    dataType: formatDataType(col),
    functionalDefinition: col.functionalDefinition,
    domainId: table.domainId,
    subdomainId: table.subdomainId,
    tags: table.tags ? [...table.tags] : undefined,
    rawExpression,
    sourceRef: { tableName: table.name, columnName: col.name },
    explanation: `Direct reference — inherited from ${table.name}.${col.name}.`,
  };
}

function formatDataType(col: TableColumn): string {
  const t = col.dataType.toUpperCase();
  if (col.length && col.scale !== undefined && ['DECIMAL', 'NUMERIC'].includes(t)) {
    return `${t}(${col.length},${col.scale})`;
  }
  if (col.length && ['VARCHAR', 'CHAR', 'NVARCHAR'].includes(t)) {
    return `${t}(${col.length})`;
  }
  return t;
}

function splitOffAlias(item: string): { expression: string; alias?: string } {
  // Look for ` AS <ident>` case-insensitively at depth zero.
  const re = /\s+AS\s+([A-Za-z_"`\[]\w*["\]`]?)\s*$/i;
  const m = item.match(re);
  if (m) {
    return { expression: item.slice(0, m.index).trim(), alias: unquoteIdent(m[1]) };
  }
  return { expression: item.trim() };
}

/** Heuristic type inference for SELECT expressions. */
function inferExpressionType(expr: string): { dataType: string; fallbackName: string; reason: string } {
  const up = expr.toUpperCase();

  // CAST(x AS TYPE[(n,m)])
  const castMatch = expr.match(/\bCAST\s*\(\s*.+?\s+AS\s+([A-Za-z_][\w]*(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)\s*\)/i);
  if (castMatch) {
    return {
      dataType: castMatch[1].toUpperCase().replace(/\s+/g, ''),
      fallbackName: 'cast_expr',
      reason: `Type taken from the CAST target (${castMatch[1].trim()}).`,
    };
  }
  // Postgres-style ::TYPE
  const doubleColonMatch = expr.match(/::\s*([A-Za-z_][\w]*(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)\s*$/);
  if (doubleColonMatch) {
    return {
      dataType: doubleColonMatch[1].toUpperCase().replace(/\s+/g, ''),
      fallbackName: 'cast_expr',
      reason: `Type taken from the Postgres cast (::${doubleColonMatch[1]}).`,
    };
  }

  // Aggregates
  if (/^\s*COUNT\s*\(/i.test(expr)) {
    return { dataType: 'BIGINT', fallbackName: 'count', reason: 'Aggregate COUNT(...) → BIGINT.' };
  }
  if (/^\s*(SUM|AVG|MIN|MAX|STDDEV|VARIANCE)\s*\(/i.test(expr)) {
    return { dataType: 'NUMERIC', fallbackName: 'aggregate', reason: 'Aggregate function → NUMERIC.' };
  }

  // CASE … END
  if (up.startsWith('CASE')) {
    // Cheap peek at THEN values to guess numeric vs string.
    const hasNumericThen = /\bTHEN\s+-?\d/i.test(expr);
    const hasStringThen = /\bTHEN\s+'/i.test(expr);
    if (hasStringThen && !hasNumericThen) {
      return { dataType: 'VARCHAR', fallbackName: 'case_expr', reason: 'CASE returning string literals → VARCHAR.' };
    }
    if (hasNumericThen && !hasStringThen) {
      return { dataType: 'NUMERIC', fallbackName: 'case_expr', reason: 'CASE returning numeric literals → NUMERIC.' };
    }
    return { dataType: 'VARCHAR', fallbackName: 'case_expr', reason: 'CASE expression — defaulted to VARCHAR.' };
  }

  // String concatenation / CONCAT
  if (/^\s*CONCAT\s*\(/i.test(expr) || /\|\|/.test(expr)) {
    return { dataType: 'VARCHAR', fallbackName: 'concat_expr', reason: 'String concatenation → VARCHAR.' };
  }

  // Date/time functions
  if (/^\s*(CURRENT_DATE|CURRENT_TIMESTAMP|NOW|GETDATE|SYSDATE)\b/i.test(expr)) {
    return { dataType: 'TIMESTAMP', fallbackName: 'now', reason: 'Date/time builtin → TIMESTAMP.' };
  }
  if (/^\s*DATE\s*\(/i.test(expr) || /^\s*DATE_TRUNC\s*\(/i.test(expr)) {
    return { dataType: 'DATE', fallbackName: 'date_expr', reason: 'DATE function → DATE.' };
  }

  // Numeric literal or arithmetic
  if (/^[-+\d\s.*/%()]+$/.test(expr)) {
    return { dataType: 'NUMERIC', fallbackName: 'calc', reason: 'Arithmetic expression → NUMERIC.' };
  }

  return { dataType: 'VARCHAR', fallbackName: 'expr', reason: 'Unrecognised expression — defaulted to VARCHAR.' };
}

// ─── FROM / JOIN parsing ──────────────────────────────────────────────

interface FromEntry { tableName: string; alias?: string; }

function parseFromClause(fromText: string): { entries: FromEntry[]; joins: InferredJoin[] } {
  // Split by JOIN keywords while preserving which type. The primary FROM
  // entry is whatever precedes the first JOIN (or the whole string if
  // there is no JOIN).
  const joinRegex = /\b((?:INNER\s+|LEFT\s+(?:OUTER\s+)?|RIGHT\s+(?:OUTER\s+)?|FULL\s+(?:OUTER\s+)?|CROSS\s+)?JOIN)\b/gi;
  const entries: FromEntry[] = [];
  const joins: InferredJoin[] = [];

  const segments: { text: string; joinType?: string }[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = joinRegex.exec(fromText)) !== null) {
    segments.push({ text: fromText.slice(lastIdx, m.index) });
    const next = joinRegex.exec(fromText);
    if (next) {
      segments.push({ text: fromText.slice(m.index + m[0].length, next.index), joinType: m[1] });
      lastIdx = next.index + next[0].length;
      joinRegex.lastIndex = next.index + next[0].length;
    } else {
      segments.push({ text: fromText.slice(m.index + m[0].length), joinType: m[1] });
      lastIdx = fromText.length;
    }
    break; // first pass handled; keep parsing below manually for clarity
  }
  // Re-parse cleanly: split by the regex with capture groups.
  const tokens = fromText.split(joinRegex);
  // tokens = [primary, joinKW1, segment1, joinKW2, segment2, ...]
  const primary = (tokens.shift() ?? '').trim();
  parseFromEntry(primary, entries);

  while (tokens.length >= 2) {
    const joinKW = (tokens.shift() ?? '').trim().toUpperCase();
    const segment = (tokens.shift() ?? '').trim();
    // Split `segment` into "table-ref" and "ON <condition>".
    const onIdx = findTopLevelKeyword(segment, ['ON']);
    const tableRef = onIdx ? segment.slice(0, onIdx.index).trim() : segment;
    const onClause = onIdx ? segment.slice(onIdx.index + 2).trim() : '';
    parseFromEntry(tableRef, entries);

    if (onClause) {
      // Support `a.x = b.y` only. Multi-condition ON clauses split by
      // AND; each equality becomes its own inferred join row.
      const conditions = onClause.split(/\bAND\b/i);
      for (const cond of conditions) {
        const eq = cond.match(/([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\s*=\s*([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)/);
        if (!eq) continue;
        joins.push({
          leftTable: eq[1],
          leftColumn: eq[2],
          rightTable: eq[3],
          rightColumn: eq[4],
          joinType: normaliseJoinType(joinKW),
        });
      }
    }
  }
  return { entries, joins };
}

function parseFromEntry(raw: string, into: FromEntry[]): void {
  const s = raw.trim();
  if (!s) return;
  // `schema.table alias` or `schema.table AS alias` or just `table`.
  const m = s.match(/^([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)(?:\s+(?:AS\s+)?([A-Za-z_][\w]*))?$/i);
  if (!m) return;
  const fullName = m[1];
  const simpleName = fullName.includes('.') ? fullName.split('.').slice(-1)[0] : fullName;
  const alias = m[2];
  into.push({ tableName: simpleName, alias });
}

function normaliseJoinType(kw: string): InferredJoin['joinType'] {
  const u = kw.toUpperCase();
  if (u.includes('LEFT')) return 'LEFT';
  if (u.includes('RIGHT')) return 'RIGHT';
  if (u.includes('FULL')) return 'FULL';
  if (u.includes('CROSS')) return 'CROSS';
  return 'INNER';
}

// ─── Public entry ─────────────────────────────────────────────────────

export function parseSqlToTable(
  inputSql: string,
  sourceTables: TableModel[],
): ParsedSqlResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const sql = stripComments(inputSql).trim().replace(/;\s*$/, '');

  if (!sql) {
    return { success: false, columns: [], joins: [], warnings, errors: ['Empty SQL input.'] };
  }

  // Detect CTAS: `CREATE TABLE [schema.]name [AS] SELECT ...`
  const ctasMatch = sql.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)\s+AS\s+/i);
  let tableName: string | undefined;
  let body = sql;
  if (ctasMatch) {
    tableName = ctasMatch[1].includes('.') ? ctasMatch[1].split('.').slice(-1)[0] : ctasMatch[1];
    body = sql.slice(ctasMatch[0].length);
  }

  // Must now start with SELECT.
  const selectMatch = body.match(/^SELECT\s+(?:DISTINCT\s+)?/i);
  if (!selectMatch) {
    errors.push(
      ctasMatch
        ? 'CREATE TABLE must be followed by an `AS SELECT …`.'
        : 'Input must start with `SELECT` (or `CREATE TABLE … AS SELECT …`).',
    );
    return { success: false, tableName, columns: [], joins: [], warnings, errors };
  }
  body = body.slice(selectMatch[0].length);

  // Find FROM at top level.
  const fromKw = findTopLevelKeyword(body, ['FROM']);
  if (!fromKw) {
    errors.push('Missing `FROM` clause — cannot tell where the column list ends.');
    return { success: false, tableName, columns: [], joins: [], warnings, errors };
  }

  const selectText = body.slice(0, fromKw.index).trim();
  let afterFrom = body.slice(fromKw.index + fromKw.keyword.length).trim();

  // Trim off trailing clauses: WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, OFFSET.
  const trailing = findTopLevelKeyword(afterFrom, [
    'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT',
  ]);
  if (trailing) afterFrom = afterFrom.slice(0, trailing.index).trim();

  const { entries, joins } = parseFromClause(afterFrom);

  // Build alias → table map. Match by both alias (if set) and raw name.
  const aliasMap = new Map<string, TableModel>();
  const unresolved: string[] = [];
  for (const entry of entries) {
    const tbl = sourceTables.find(
      (t) => t.name.toLowerCase() === entry.tableName.toLowerCase(),
    );
    if (!tbl) {
      unresolved.push(entry.tableName);
      continue;
    }
    aliasMap.set(entry.tableName.toLowerCase(), tbl);
    if (entry.alias) aliasMap.set(entry.alias.toLowerCase(), tbl);
  }
  if (unresolved.length) {
    warnings.push(
      `Source table(s) not found in the current model: ${unresolved.join(', ')}. ` +
      `Columns qualified with those aliases will be treated as opaque expressions.`,
    );
  }

  // Split the column list and analyse each item.
  const rawItems = splitTopLevel(selectText);
  const columns: InferredColumn[] = [];
  for (const item of rawItems) {
    const produced = analyseSelectItem(item, aliasMap, Array.from(new Set(aliasMap.values())));
    columns.push(...produced);
  }

  // Validate: unique names, non-empty.
  const seen = new Set<string>();
  for (const col of columns) {
    if (!col.name) {
      errors.push(`An output column has no name. Add an explicit \`AS <alias>\`: \`${col.rawExpression}\`.`);
    }
    const key = col.name.toLowerCase();
    if (seen.has(key)) {
      warnings.push(`Duplicate output column "${col.name}". Add an alias to disambiguate.`);
    }
    seen.add(key);
  }

  // Filter joins to those whose both sides resolve — saves the UI work.
  const resolvedJoins = joins.filter((j) => {
    const l = aliasMap.get(j.leftTable.toLowerCase());
    const r = aliasMap.get(j.rightTable.toLowerCase());
    return !!l && !!r;
  }).map((j) => {
    const l = aliasMap.get(j.leftTable.toLowerCase())!;
    const r = aliasMap.get(j.rightTable.toLowerCase())!;
    return { ...j, leftTable: l.name, rightTable: r.name };
  });

  return {
    success: errors.length === 0 && columns.length > 0,
    tableName,
    columns,
    joins: resolvedJoins,
    warnings,
    errors,
  };
}
