// Engine-aware DDL generators.
//
// Each generator takes a normalised input (a table + the surrounding model so
// FK references can be resolved across the catalog) and produces a full
// CREATE TABLE block. Top-level helpers (`generateTablesDDL`, etc.) take care
// of grouping CREATE SCHEMA statements, ordering by dependency, and stitching
// individual statements into a single document.

import type {
  TableModel,
  TableColumn,
  Relationship,
  DatabaseEngine,
} from '@/types/model';
import { getEngine, resolveSchema } from '@/features/engines/engines';
import { resolveDataType, quoteIdent, qualifyTable } from './typeMappings';

export interface GenerateOptions {
  /** Include CREATE SCHEMA statements at the top of the output. */
  emitSchemas?: boolean;
  /** Include FK constraints inline / as ALTER TABLE blocks at the bottom. */
  emitForeignKeys?: boolean;
  /** Include COMMENT ON / column descriptions when supported. */
  emitComments?: boolean;
}

const DEFAULT_OPTIONS: Required<GenerateOptions> = {
  emitSchemas: true,
  emitForeignKeys: true,
  emitComments: true,
};

interface GenContext {
  engine: DatabaseEngine;
  supportsSchemas: boolean;
  options: Required<GenerateOptions>;
  /** Map from table name (without schema) → resolved schema name. */
  schemaByTableName: Map<string, string>;
  allTables: TableModel[];
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generate DDL for a single table within the context of a model.
 * The context is required so FK references can be qualified with their
 * target schema.
 */
export function generateTableDDL(
  table: TableModel,
  allTables: TableModel[],
  relationships: Relationship[],
  engine: DatabaseEngine,
  options: GenerateOptions = {}
): string {
  const ctx = buildContext(allTables, engine, options);
  const lines: string[] = [];
  emitSchema(lines, table, ctx);
  emitTable(lines, table, ctx);
  if (ctx.options.emitForeignKeys) {
    emitForeignKeysFor(lines, table, relationships, ctx);
  }
  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Generate DDL for an arbitrary set of tables. Schemas are grouped at the
 * top, tables are emitted next, and FK ALTER TABLE statements are appended
 * at the bottom so the output applies cleanly even with cross-table
 * dependencies.
 */
export function generateTablesDDL(
  tables: TableModel[],
  allTables: TableModel[],
  relationships: Relationship[],
  engine: DatabaseEngine,
  options: GenerateOptions = {}
): string {
  const ctx = buildContext(allTables, engine, options);
  const lines: string[] = [];

  // Group schemas
  if (ctx.options.emitSchemas && ctx.supportsSchemas) {
    const schemas = new Set<string>();
    for (const t of tables) schemas.add(resolveSchema(t.schema, engine));
    for (const s of Array.from(schemas).sort()) {
      lines.push(createSchemaStmt(s, engine));
    }
    if (schemas.size) lines.push('');
  }

  // Tables
  for (const t of tables) {
    emitTable(lines, t, ctx);
    lines.push('');
  }

  // Foreign-key ALTERs
  if (ctx.options.emitForeignKeys) {
    const fkLines: string[] = [];
    for (const t of tables) {
      emitForeignKeysFor(fkLines, t, relationships, ctx);
    }
    if (fkLines.length) {
      lines.push('-- Foreign key constraints');
      lines.push(...fkLines);
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

/** Generate DDL for every table that belongs to a domain (TableModel.domain). */
export function generateDomainDDL(
  domain: string,
  allTables: TableModel[],
  relationships: Relationship[],
  engine: DatabaseEngine,
  options: GenerateOptions = {}
): string {
  const subset = allTables.filter((t) => (t.domain ?? '').toLowerCase() === domain.toLowerCase());
  return generateTablesDDL(subset, allTables, relationships, engine, options);
}

// ────────────────────────────────────────────────────────────────────────────
// Internal — context + table emission
// ────────────────────────────────────────────────────────────────────────────

function buildContext(
  allTables: TableModel[],
  engine: DatabaseEngine,
  options: GenerateOptions
): GenContext {
  const def = getEngine(engine);
  const supportsSchemas = def?.supportsSchemas ?? true;
  const schemaByTableName = new Map<string, string>();
  for (const t of allTables) {
    schemaByTableName.set(t.name, resolveSchema(t.schema, engine));
  }
  return {
    engine,
    supportsSchemas,
    options: { ...DEFAULT_OPTIONS, ...options },
    schemaByTableName,
    allTables,
  };
}

function emitSchema(lines: string[], table: TableModel, ctx: GenContext) {
  if (!ctx.options.emitSchemas || !ctx.supportsSchemas) return;
  const s = resolveSchema(table.schema, ctx.engine);
  lines.push(createSchemaStmt(s, ctx.engine));
  lines.push('');
}

function createSchemaStmt(schema: string, engine: DatabaseEngine): string {
  if (engine === 'oracle') {
    return `-- Oracle: schemas are users; ensure user ${schema} exists`;
  }
  // PostgreSQL and Databricks both accept CREATE SCHEMA IF NOT EXISTS
  return `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema, engine)};`;
}

function emitTable(lines: string[], table: TableModel, ctx: GenContext) {
  const { engine, supportsSchemas } = ctx;
  const schema = resolveSchema(table.schema, engine);
  const fqName = qualifyTable(schema, table.name, engine, supportsSchemas);

  // Optional table comment header
  if (ctx.options.emitComments && table.functionalDefinition) {
    lines.push(`-- ${truncateOneLine(table.functionalDefinition)}`);
  }

  const colLines = table.columns
    .filter((c) => c.name.trim().length > 0)
    .map((c) => '  ' + buildColumnLine(c, ctx));

  // Inline PRIMARY KEY clause — supported by all 3 target engines
  const pkCols = table.columns.filter((c) => c.isPrimaryKey).map((c) => quoteIdent(c.name, engine));
  if (pkCols.length > 0) {
    colLines.push(`  PRIMARY KEY (${pkCols.join(', ')})`);
  }

  // Inline UNIQUE constraints (single-column only — composite kept simple)
  for (const c of table.columns) {
    if (c.isUnique && !c.isPrimaryKey) {
      colLines.push(`  UNIQUE (${quoteIdent(c.name, engine)})`);
    }
  }

  const createPrefix = engine === 'databricks' ? 'CREATE TABLE IF NOT EXISTS' : 'CREATE TABLE';
  lines.push(`${createPrefix} ${fqName} (`);
  lines.push(colLines.join(',\n'));
  lines.push(')');

  // Engine-specific table-level clauses: USING / PARTITION / CLUSTER
  appendTableSuffix(lines, table, ctx);

  // Comments: COMMENT ON COLUMN / COMMENT ON TABLE
  if (ctx.options.emitComments) {
    appendComments(lines, table, ctx);
  }
}

function buildColumnLine(col: TableColumn, ctx: GenContext): string {
  const { engine } = ctx;
  const name = quoteIdent(col.name, engine);
  const type = resolveDataType(col, engine);
  const parts: string[] = [name, type];

  // NULL / NOT NULL — primary keys are implicitly NOT NULL on most engines but
  // we emit it explicitly for clarity.
  if (col.isNullable === false || col.isPrimaryKey) parts.push('NOT NULL');
  if (col.defaultValue) parts.push(`DEFAULT ${formatDefault(col.defaultValue, type)}`);

  return parts.join(' ');
}

function formatDefault(raw: string, dataType: string): string {
  const isNumeric = /^(INT|BIGINT|SMALLINT|NUMERIC|DECIMAL|NUMBER|FLOAT|DOUBLE|REAL|INT64|FLOAT64)/i.test(dataType);
  if (isNumeric) return raw;
  if (/^(CURRENT_TIMESTAMP|CURRENT_DATE|NOW\(\)|GETDATE\(\)|SYSDATE)$/i.test(raw)) return raw;
  if (raw.startsWith("'") || raw.startsWith('"')) return raw;
  return `'${raw.replace(/'/g, "''")}'`;
}

// ────────────────────────────────────────────────────────────────────────────
// Partitioning + clustering
// ────────────────────────────────────────────────────────────────────────────

function appendTableSuffix(lines: string[], table: TableModel, ctx: GenContext) {
  const partition = table.partition;
  const cluster = partition?.clusteringColumns ?? [];

  // ── Databricks SQL ────────────────────────────────────────────────
  // USING DELTA + PARTITIONED BY (cols) + CLUSTER BY (Z-ORDER cols) + COMMENT
  if (ctx.engine === 'databricks') {
    const tail: string[] = ['USING DELTA'];
    if (partition && partition.strategy !== 'NONE' && partition.columns.length > 0) {
      tail.push(`PARTITIONED BY (${joinCols(partition.columns, ctx)})`);
    }
    if (cluster.length > 0) {
      tail.push(`CLUSTER BY (${joinCols(cluster, ctx)})`);
    }
    if (table.functionalDefinition && ctx.options.emitComments) {
      tail.push(`COMMENT '${escapeSqlLiteral(table.functionalDefinition)}'`);
    }
    lines[lines.length - 1] = lines[lines.length - 1] + '\n' + tail.join('\n') + ';';
    return;
  }

  // ── PostgreSQL / Oracle ───────────────────────────────────────────
  // PARTITION BY <STRATEGY> (cols)
  if (
    partition &&
    partition.strategy !== 'NONE' &&
    partition.columns.length > 0
  ) {
    const strat = partition.strategy === 'BUCKET' ? 'HASH' : partition.strategy;
    const colsExpr = joinCols(partition.columns, ctx);
    if (partition.strategy === 'HASH' && partition.buckets) {
      lines[lines.length - 1] += `\nPARTITION BY ${strat} (${colsExpr})  -- ${partition.buckets} buckets`;
    } else {
      lines[lines.length - 1] += `\nPARTITION BY ${strat} (${colsExpr})`;
    }
  }

  lines[lines.length - 1] += ';';
}

function joinCols(cols: string[], ctx: GenContext): string {
  return cols.map((c) => quoteIdent(c, ctx.engine)).join(', ');
}

// ────────────────────────────────────────────────────────────────────────────
// FKs + comments
// ────────────────────────────────────────────────────────────────────────────

function emitForeignKeysFor(
  out: string[],
  table: TableModel,
  relationships: Relationship[],
  ctx: GenContext
) {
  const { engine, supportsSchemas } = ctx;
  const sourceSchema = resolveSchema(table.schema, engine);
  const sourceFq = qualifyTable(sourceSchema, table.name, engine, supportsSchemas);

  for (const col of table.columns) {
    if (!col.isForeignKey || !col.foreignKeyRef?.table || !col.foreignKeyRef?.column) continue;
    const targetSchema = ctx.schemaByTableName.get(col.foreignKeyRef.table) ?? resolveSchema(undefined, engine);
    const targetFq = qualifyTable(targetSchema, col.foreignKeyRef.table, engine, supportsSchemas);
    const fkName = `fk_${table.name}_${col.name}`;
    out.push(
      `ALTER TABLE ${sourceFq} ADD CONSTRAINT ${quoteIdent(fkName, engine)} ` +
      `FOREIGN KEY (${quoteIdent(col.name, engine)}) REFERENCES ${targetFq}(${quoteIdent(col.foreignKeyRef.column, engine)});`
    );
  }

  // Standalone relationships not represented by a column-level FK
  for (const rel of relationships) {
    if (rel.sourceTable !== table.name) continue;
    const inlineMatch = table.columns.some(
      (c) =>
        c.isForeignKey &&
        c.name === rel.sourceColumn &&
        c.foreignKeyRef?.table === rel.targetTable &&
        c.foreignKeyRef?.column === rel.targetColumn
    );
    if (inlineMatch) continue;

    const targetSchema = ctx.schemaByTableName.get(rel.targetTable) ?? resolveSchema(undefined, engine);
    const targetFq = qualifyTable(targetSchema, rel.targetTable, engine, supportsSchemas);
    const fkName = `fk_${rel.sourceTable}_${rel.sourceColumn}`;
    out.push(
      `ALTER TABLE ${sourceFq} ADD CONSTRAINT ${quoteIdent(fkName, engine)} ` +
      `FOREIGN KEY (${quoteIdent(rel.sourceColumn, engine)}) REFERENCES ${targetFq}(${quoteIdent(rel.targetColumn, engine)});`
    );
  }
}

function appendComments(lines: string[], table: TableModel, ctx: GenContext) {
  // Databricks embeds COMMENT inside CREATE TABLE — skip the trailing block
  if (ctx.engine === 'databricks') return;

  const schema = resolveSchema(table.schema, ctx.engine);
  const fqName = qualifyTable(schema, table.name, ctx.engine, ctx.supportsSchemas);

  if (table.functionalDefinition) {
    lines.push(
      `COMMENT ON TABLE ${fqName} IS '${escapeSqlLiteral(table.functionalDefinition)}';`
    );
  }

  for (const c of table.columns) {
    if (!c.functionalDefinition) continue;
    lines.push(
      `COMMENT ON COLUMN ${fqName}.${quoteIdent(c.name, ctx.engine)} IS '${escapeSqlLiteral(c.functionalDefinition)}';`
    );
  }
}

function escapeSqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

function truncateOneLine(s: string): string {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > 200 ? line.slice(0, 197) + '...' : line;
}
