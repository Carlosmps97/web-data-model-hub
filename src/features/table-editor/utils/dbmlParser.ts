// DBML (Database Markup Language) Parser
// Parses DBML-like syntax into TableModel[] / Relationship[] structures
// Features supported:
//   - Table { ... } with columns & inline settings
//   - Column settings: pk | primary key, sk, partition, not null, null, unique, default: ..., note: ..., ref: > Table.col
//   - Inline column comments   ("name type // comment")
//   - Standalone Ref: Table.col > Table.col
//   - Single-line Note: 'text'   and   multi-line Note { '''...''' } blocks
//   - Top-level Project { database_type: 'PostgreSQL' Note: '...' } block
//   - // line comments
//   - Graceful handling of cross-model refs (target table may be absent from parsed set)

import { v4 as uuidv4 } from 'uuid';
import type { TableModel, TableColumn, Relationship, DatabaseEngine } from '@/types/model';
import { findColumnId, resolveColumnName } from '@/lib/columnRef';

export interface DBMLParseResult {
  tables: TableModel[];
  relationships: Relationship[];
  errors: DBMLError[];
  project?: {
    name?: string;
    engine?: DatabaseEngine;
    note?: string;
  };
}

export interface DBMLError {
  line: number;
  message: string;
}

// Map DBML `database_type` values (case-insensitive) to our internal engine ids.
// Engines not in this list are rejected silently; the importer can still load
// the model but `engine` will be unset, which the user can fix from the engine
// picker.
//
// `databricks` (legacy alias) → `databricks_sql` so freshly imported DBML
// always lands on a non-legacy engine.
const ENGINE_ALIASES: Record<string, DatabaseEngine> = {
  postgres: 'postgresql',
  postgresql: 'postgresql',
  psql: 'postgresql',
  oracle: 'oracle',
  plsql: 'oracle',
  databricks: 'databricks_sql',
  'databricks sql': 'databricks_sql',
  databrickssql: 'databricks_sql',
  mysql: 'mysql',
  mariadb: 'mysql',
  sqlserver: 'sqlserver',
  'sql server': 'sqlserver',
  mssql: 'sqlserver',
  tsql: 'sqlserver',
  cosmosdb: 'cosmosdb',
  'cosmos db': 'cosmosdb',
  cosmos: 'cosmosdb',
};

function normalizeEngine(raw: string): DatabaseEngine | undefined {
  const k = raw.trim().toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
  return ENGINE_ALIASES[k] ?? ENGINE_ALIASES[k.replace(/\s/g, '')];
}

export function parseDBML(input: string): DBMLParseResult {
  const lines = input.split('\n');
  const tables: TableModel[] = [];
  const relationships: Relationship[] = [];
  const errors: DBMLError[] = [];
  let project: DBMLParseResult['project'] = undefined;

  let currentTable: TableModel | null = null;
  let braceDepth = 0;

  // Context for top-level Project { ... } block
  let inProject = false;
  let projectBraceDepth = 0;

  // Buffers for multi-line note capture
  // When active, lines are accumulated (raw, preserving indentation after the opener)
  // until the closing triple-quote is found.
  let noteBuffer: string[] | null = null;
  let noteTarget: 'table' | 'project' | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i];
    const line = raw.trim();

    // ---------- MULTI-LINE NOTE CAPTURE ----------
    if (noteBuffer !== null) {
      // Look for closing triple quote
      const closeIdx = raw.indexOf("'''");
      if (closeIdx >= 0) {
        const before = raw.slice(0, closeIdx);
        if (before.trim().length > 0) noteBuffer.push(before);
        const text = noteBuffer.join('\n').trim();
        if (noteTarget === 'table' && currentTable) {
          currentTable.functionalDefinition = text;
        } else if (noteTarget === 'project') {
          project = { ...(project ?? {}), note: text };
        }
        noteBuffer = null;
        noteTarget = null;
        // The remainder of the line after the closing quote is ignored (usually just `}`).
      } else {
        noteBuffer.push(raw);
      }
      continue;
    }

    // Skip empty and full-line comments
    if (!line || line.startsWith('//')) continue;

    // ---------- PROJECT BLOCK ----------
    if (!currentTable && !inProject) {
      const projMatch = line.match(/^Project\s+(\S+)?\s*\{/i);
      if (projMatch) {
        inProject = true;
        projectBraceDepth = 1;
        project = { ...(project ?? {}) };
        if (projMatch[1]) project.name = projMatch[1];
        continue;
      }
    }

    if (inProject) {
      if (line === '}') {
        projectBraceDepth--;
        if (projectBraceDepth === 0) inProject = false;
        continue;
      }

      // database_type: 'PostgreSQL'
      const engineMatch = line.match(/^database_type\s*:\s*['"]([^'"]+)['"]/i);
      if (engineMatch) {
        const engine = normalizeEngine(engineMatch[1]);
        if (engine) project = { ...(project ?? {}), engine };
        continue;
      }

      // Note — triple-quoted (multi-line) FIRST to avoid the single-line regex
      // greedily capturing the two leading quotes of a ''' opener.
      const noteOpen = line.match(/^Note\s*:\s*'''(.*)$/i);
      if (noteOpen) {
        const rest = noteOpen[1];
        const closeIdx = rest.indexOf("'''");
        if (closeIdx >= 0) {
          project = { ...(project ?? {}), note: rest.slice(0, closeIdx).trim() };
        } else {
          noteBuffer = rest.length > 0 ? [rest] : [];
          noteTarget = 'project';
        }
        continue;
      }
      // Note: 'single-line'
      const noteSingle = line.match(/^Note\s*:\s*['"]([^'"]*)['"]/i);
      if (noteSingle) {
        project = { ...(project ?? {}), note: noteSingle[1] };
        continue;
      }
      // ignore other project-level keys silently
      continue;
    }

    // ---------- TABLE DECLARATION ----------
    // Supports `Table users { ... }` and `Table sales.orders { ... }`
    const tableMatch = line.match(/^Table\s+(?:(\S+?)\.)?(\S+)\s*\{/i);
    if (tableMatch) {
      const [, schemaPart, namePart] = tableMatch;
      currentTable = {
        id: uuidv4(),
        schema: schemaPart || undefined,
        name: namePart,
        columns: [],
      };
      braceDepth = 1;
      continue;
    }

    // ---------- STANDALONE REF ----------
    const refMatch = line.match(/^Ref\s*:?\s*(\S+)\.(\S+)\s*([<>-])\s*(\S+)\.(\S+)/i);
    if (refMatch && !currentTable) {
      const [, srcTable, srcCol, relSymbol, tgtTable, tgtCol] = refMatch;
      relationships.push({
        id: uuidv4(),
        sourceTable: srcTable,
        sourceColumn: srcCol,
        targetTable: tgtTable,
        targetColumn: tgtCol,
        type: relSymbol === '-' ? 'one-to-one' : relSymbol === '<' ? 'many-to-many' : 'one-to-many',
      });
      continue;
    }

    // ---------- INSIDE TABLE BLOCK ----------
    if (currentTable && braceDepth > 0) {
      // Closing brace
      if (line === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          tables.push(currentTable);
          currentTable = null;
        }
        continue;
      }

      // Multi-line Note opener FIRST: Note: '''... OR Note { '''...
      const noteOpen = line.match(/^Note\s*[:{]\s*'''(.*)$/i);
      if (noteOpen) {
        const rest = noteOpen[1];
        const closeIdx = rest.indexOf("'''");
        if (closeIdx >= 0) {
          currentTable.functionalDefinition = rest.slice(0, closeIdx).trim();
        } else {
          noteBuffer = rest.length > 0 ? [rest] : [];
          noteTarget = 'table';
        }
        continue;
      }
      // Single-line Note
      const noteSingle = line.match(/^Note\s*:\s*['"]([^'"]*)['"]/i);
      if (noteSingle) {
        currentTable.functionalDefinition = noteSingle[1];
        continue;
      }
      // Note { 'single line' }
      const noteBlockSingle = line.match(/^Note\s*\{\s*['"]([^'"]*)['"]\s*\}?/i);
      if (noteBlockSingle) {
        currentTable.functionalDefinition = noteBlockSingle[1];
        continue;
      }

      // Indexes block (skip)
      if (line.match(/^indexes\s*\{/i)) {
        braceDepth++;
        continue;
      }
      if (braceDepth > 1) {
        if (line === '}') braceDepth--;
        continue;
      }

      // Column definition
      const colMatch = line.match(/^(\S+)\s+(\S+(?:\([^)]*\))?)\s*(?:\[([^\]]*)\])?\s*(?:\/\/\s*(.*))?$/);
      if (colMatch) {
        const [, name, dataType, settings, comment] = colMatch;
        const column: TableColumn = { id: uuidv4(), name, dataType };

        if (settings) {
          // Split on commas that are NOT inside quotes
          const parts: string[] = [];
          let buf = '';
          let inQuote: string | null = null;
          for (const ch of settings) {
            if (inQuote) {
              buf += ch;
              if (ch === inQuote) inQuote = null;
            } else if (ch === "'" || ch === '"') {
              inQuote = ch;
              buf += ch;
            } else if (ch === ',') {
              parts.push(buf.trim());
              buf = '';
            } else {
              buf += ch;
            }
          }
          if (buf.trim()) parts.push(buf.trim());

          for (const rawSetting of parts) {
            const setting = rawSetting.toLowerCase();
            if (setting === 'pk' || setting === 'primary key') {
              column.isPrimaryKey = true;
            } else if (setting === 'sk' || setting === 'surrogate key') {
              column.isSurrogateKey = true;
            } else if (setting === 'partition' || setting === 'partition key') {
              column.isPartitionKey = true;
            } else if (setting === 'not null') {
              column.isNullable = false;
            } else if (setting === 'null') {
              column.isNullable = true;
            } else if (setting === 'unique') {
              column.isUnique = true;
            } else if (setting === 'increment' || setting === 'auto_increment') {
              // informational
            } else if (setting.startsWith('default:')) {
              const val = rawSetting.slice(rawSetting.indexOf(':') + 1).trim();
              column.defaultValue = val.replace(/^['"]|['"]$/g, '');
            } else if (setting.startsWith('note:')) {
              const val = rawSetting.slice(rawSetting.indexOf(':') + 1).trim();
              column.functionalDefinition = val.replace(/^['"]|['"]$/g, '');
            } else if (setting.startsWith('ref:')) {
              const refStr = rawSetting.slice(rawSetting.indexOf(':') + 1).trim();
              const refParts = refStr.match(/([<>-])\s*(\S+)\.(\S+)/);
              if (refParts) {
                const [, relSymbol, tgtTable, tgtCol] = refParts;
                column.isForeignKey = true;
                column.foreignKeyRef = { table: tgtTable, column: tgtCol };
                relationships.push({
                  id: uuidv4(),
                  sourceTable: currentTable.name,
                  sourceColumn: name,
                  targetTable: tgtTable,
                  targetColumn: tgtCol,
                  type: relSymbol === '-' ? 'one-to-one' : relSymbol === '<' ? 'many-to-many' : 'one-to-many',
                });
              }
            }
          }
        }

        if (comment) {
          column.functionalDefinition = column.functionalDefinition || comment;
        }

        currentTable.columns.push(column);
      } else if (line !== '{') {
        errors.push({ line: lineNum, message: `Could not parse column definition: "${line}"` });
      }
    }
  }

  // Unclosed structures
  if (currentTable) {
    errors.push({ line: lines.length, message: `Unclosed table block: "${currentTable.name}"` });
  }
  if (inProject) {
    errors.push({ line: lines.length, message: 'Unclosed Project block' });
  }
  if (noteBuffer !== null) {
    errors.push({ line: lines.length, message: 'Unclosed multi-line Note block' });
  }

  // ---------- POST-PROCESS: resolve relationship column NAMES → column IDs ----------
  // During the line-by-line parse we don't always have all tables available
  // when a relationship is registered (e.g. an inline `ref: > other.col`
  // may point forward to a table that hasn't been seen yet, or a
  // standalone `Ref:` at the top of the file may forward-reference both
  // endpoints). Once the full set of tables is known we walk every
  // relationship and rewrite `sourceColumn` / `targetColumn` from the
  // DBML-level physical name to the canonical `TableColumn.id` so the
  // canvas edges bind to stable handles (see `src/lib/columnRef.ts`).
  //
  // If a column can't be resolved — e.g. cross-model reference to a
  // table that isn't in this DBML — we leave the name in place so the
  // user can still see the intent; the canvas will flag the orphan.
  const resolvedRelationships = relationships.map((r) => ({
    ...r,
    sourceColumn: findColumnId(tables, r.sourceTable, r.sourceColumn) ?? r.sourceColumn,
    targetColumn: findColumnId(tables, r.targetTable, r.targetColumn) ?? r.targetColumn,
  }));

  return { tables, relationships: resolvedRelationships, errors, project };
}

// ---------- GENERATOR ----------

export interface GenerateDBMLOptions {
  /**
   * When generating a global (multi-model) DBML document, the set of tables
   * belonging to _other_ models is provided here so that the generator can
   * emit an explanatory comment next to cross-model references instead of
   * silently assuming the target exists in the current table list.
   */
  knownTables?: Set<string>;
  /**
   * Optional Project block to emit at the top of the document. Useful to
   * surface the selected database engine in the generated code.
   */
  project?: {
    name?: string;
    engine?: DatabaseEngine;
    note?: string;
  };
}

// Reverse map engine → DBML `database_type` literal.
// Includes both backend-supported engines and the two legacy ids so a
// model loaded from older JSON still serializes back to valid DBML.
const ENGINE_TO_DBML: Record<DatabaseEngine, string> = {
  postgresql: 'PostgreSQL',
  databricks_sql: 'Databricks',
  sqlserver: 'SQL Server',
  mysql: 'MySQL',
  cosmosdb: 'CosmosDB',
  // Legacy aliases (read path; writes prefer the non-legacy ids above).
  oracle: 'Oracle',
  databricks: 'Databricks',
};

export function generateDBML(
  tables: TableModel[],
  relationships: Relationship[],
  options: GenerateDBMLOptions = {}
): string {
  const lines: string[] = [];
  const tableNames = new Set(tables.map((t) => t.name));

  // Project block
  if (options.project && (options.project.engine || options.project.note || options.project.name)) {
    const projName = options.project.name ?? 'data_model';
    lines.push(`Project ${projName} {`);
    if (options.project.engine) {
      lines.push(`  database_type: '${ENGINE_TO_DBML[options.project.engine]}'`);
    }
    if (options.project.note) {
      const note = options.project.note;
      if (note.includes('\n')) {
        lines.push(`  Note: '''`);
        for (const ln of note.split('\n')) lines.push(`  ${ln}`);
        lines.push(`  '''`);
      } else {
        lines.push(`  Note: '${note.replace(/'/g, "\\'")}'`);
      }
    }
    lines.push('}');
    lines.push('');
  }

  for (const table of tables) {
    const fq = table.schema ? `${table.schema}.${table.name}` : table.name;
    lines.push(`Table ${fq} {`);

    for (const col of table.columns) {
      const settings: string[] = [];
      if (col.isPrimaryKey) settings.push('pk');
      if (col.isSurrogateKey) settings.push('sk');
      if (col.isPartitionKey) settings.push('partition');
      if (col.isUnique) settings.push('unique');
      if (col.isNullable === false) settings.push('not null');
      if (col.defaultValue) settings.push(`default: '${col.defaultValue.replace(/'/g, "\\'")}'`);
      if (col.isForeignKey && col.foreignKeyRef) {
        settings.push(`ref: > ${col.foreignKeyRef.table}.${col.foreignKeyRef.column}`);
      }
      if (col.functionalDefinition && !col.functionalDefinition.includes('\n')) {
        settings.push(`note: '${col.functionalDefinition.replace(/'/g, "\\'")}'`);
      }

      const settingsStr = settings.length > 0 ? ` [${settings.join(', ')}]` : '';

      // Cross-model reference comment: if FK points outside current table set AND
      // caller advertised other known tables, annotate for clarity.
      let crossComment = '';
      if (
        col.isForeignKey &&
        col.foreignKeyRef &&
        !tableNames.has(col.foreignKeyRef.table) &&
        options.knownTables?.has(col.foreignKeyRef.table)
      ) {
        crossComment = ' // cross-model ref';
      }

      lines.push(`  ${col.name} ${col.dataType}${settingsStr}${crossComment}`);
    }

    if (table.functionalDefinition) {
      if (table.functionalDefinition.includes('\n')) {
        lines.push(`  Note: '''`);
        for (const ln of table.functionalDefinition.split('\n')) lines.push(`  ${ln}`);
        lines.push(`  '''`);
      } else {
        lines.push(`  Note: '${table.functionalDefinition.replace(/'/g, "\\'")}'`);
      }
    }

    lines.push('}');
    lines.push('');
  }

  // Standalone relationships not already expressed inline.
  //
  // Relationships now store `sourceColumn` / `targetColumn` as
  // `TableColumn.id` (post column-id migration). DBML, by contrast,
  // only speaks physical names, so we resolve both endpoints through
  // `resolveColumnName` before emitting. Duplicate-detection also
  // works on names so a rel that mirrors an inline FK is elided.
  const inlineFKs = new Set<string>();
  for (const table of tables) {
    for (const col of table.columns) {
      if (col.isForeignKey && col.foreignKeyRef) {
        inlineFKs.add(`${table.name}.${col.name}->${col.foreignKeyRef.table}.${col.foreignKeyRef.column}`);
      }
    }
  }

  for (const rel of relationships) {
    const srcColName = resolveColumnName(tables, rel.sourceTable, rel.sourceColumn);
    const tgtColName = resolveColumnName(tables, rel.targetTable, rel.targetColumn);
    // Orphan rels (column id no longer resolvable) are skipped silently —
    // the canvas already flags them visually.
    if (!srcColName || !tgtColName) continue;

    const key = `${rel.sourceTable}.${srcColName}->${rel.targetTable}.${tgtColName}`;
    if (inlineFKs.has(key)) continue;

    const symbol = rel.type === 'one-to-one' ? '-' : rel.type === 'many-to-many' ? '<' : '>';
    const crossHint =
      !tableNames.has(rel.sourceTable) || !tableNames.has(rel.targetTable)
        ? ' // cross-model'
        : '';
    lines.push(
      `Ref: ${rel.sourceTable}.${srcColName} ${symbol} ${rel.targetTable}.${tgtColName}${crossHint}`
    );
  }

  return lines.join('\n');
}
