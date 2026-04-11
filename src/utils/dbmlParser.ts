// DBML (Database Markup Language) Parser
// Parses DBML-like syntax into TableModel[] and Relationship[] structures
// Supports: Table definitions, column settings [pk, fk, not null, unique, default, ref], Notes, Ref declarations

import { v4 as uuidv4 } from 'uuid';
import type { TableModel, TableColumn, Relationship } from '@/types/model';

export interface DBMLParseResult {
  tables: TableModel[];
  relationships: Relationship[];
  errors: DBMLError[];
}

export interface DBMLError {
  line: number;
  message: string;
}

export function parseDBML(input: string): DBMLParseResult {
  const lines = input.split('\n');
  const tables: TableModel[] = [];
  const relationships: Relationship[] = [];
  const errors: DBMLError[] = [];

  let currentTable: TableModel | null = null;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i];
    const line = raw.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('//')) continue;

    // --- Table declaration ---
    const tableMatch = line.match(/^Table\s+(\S+)\s*\{/i);
    if (tableMatch) {
      currentTable = {
        id: uuidv4(),
        name: tableMatch[1],
        columns: [],
        position: { x: tables.length * 320, y: 50 },
      };
      braceDepth = 1;
      continue;
    }

    // --- Standalone Ref declaration ---
    const refMatch = line.match(/^Ref\s*:\s*(\S+)\.(\S+)\s*([<>-])\s*(\S+)\.(\S+)/i);
    if (refMatch) {
      const [, srcTable, srcCol, relSymbol, tgtTable, tgtCol] = refMatch;
      let relType: Relationship['type'] = 'one-to-many';
      if (relSymbol === '-') relType = 'one-to-one';
      else if (relSymbol === '<') relType = 'many-to-many';

      relationships.push({
        id: uuidv4(),
        sourceTable: srcTable,
        sourceColumn: srcCol,
        targetTable: tgtTable,
        targetColumn: tgtCol,
        type: relType,
      });
      continue;
    }

    // --- Inside a table block ---
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

      // Table Note
      const noteMatch = line.match(/^Note\s*:\s*['"](.+)['"]/i);
      if (noteMatch) {
        currentTable.functionalDefinition = noteMatch[1];
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
        const column: TableColumn = {
          name,
          dataType,
        };

        if (settings) {
          const settingsList = settings.split(',').map((s) => s.trim().toLowerCase());

          for (const setting of settingsList) {
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
              // stored as-is in type info
            } else if (setting === 'increment' || setting === 'auto_increment') {
              // informational
            } else if (setting.startsWith('default:')) {
              column.defaultValue = setting.replace('default:', '').trim().replace(/['"]/g, '');
            } else if (setting.startsWith('note:')) {
              column.functionalDefinition = setting.replace('note:', '').trim().replace(/['"]/g, '');
            } else if (setting.startsWith('ref:')) {
              const refStr = setting.replace('ref:', '').trim();
              const refParts = refStr.match(/([<>-])\s*(\S+)\.(\S+)/);
              if (refParts) {
                const [, relSymbol, tgtTable, tgtCol] = refParts;
                column.isForeignKey = true;
                column.foreignKeyRef = { table: tgtTable, column: tgtCol };

                let relType: Relationship['type'] = 'one-to-many';
                if (relSymbol === '-') relType = 'one-to-one';
                else if (relSymbol === '<') relType = 'many-to-many';

                relationships.push({
                  id: uuidv4(),
                  sourceTable: currentTable.name,
                  sourceColumn: name,
                  targetTable: tgtTable,
                  targetColumn: tgtCol,
                  type: relType,
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

  // Check for unclosed table
  if (currentTable) {
    errors.push({ line: lines.length, message: `Unclosed table block: "${currentTable.name}"` });
  }

  return { tables, relationships, errors };
}

// Generate DBML from tables and relationships
export function generateDBML(tables: TableModel[], relationships: Relationship[]): string {
  const lines: string[] = [];

  for (const table of tables) {
    lines.push(`Table ${table.name} {`);

    for (const col of table.columns) {
      const settings: string[] = [];
      if (col.isPrimaryKey) settings.push('pk');
      if (col.isSurrogateKey) settings.push('sk');
      if (col.isPartitionKey) settings.push('partition');
      if (col.isNullable === false) settings.push('not null');
      if (col.defaultValue) settings.push(`default: '${col.defaultValue}'`);
      if (col.isForeignKey && col.foreignKeyRef) {
        settings.push(`ref: > ${col.foreignKeyRef.table}.${col.foreignKeyRef.column}`);
      }
      if (col.functionalDefinition) {
        settings.push(`note: '${col.functionalDefinition}'`);
      }

      const settingsStr = settings.length > 0 ? ` [${settings.join(', ')}]` : '';
      lines.push(`  ${col.name} ${col.dataType}${settingsStr}`);
    }

    if (table.functionalDefinition) {
      lines.push(`  Note: '${table.functionalDefinition}'`);
    }

    lines.push('}');
    lines.push('');
  }

  // Standalone relationships not already defined inline
  const inlineFKs = new Set<string>();
  for (const table of tables) {
    for (const col of table.columns) {
      if (col.isForeignKey && col.foreignKeyRef) {
        inlineFKs.add(`${table.name}.${col.name}->${col.foreignKeyRef.table}.${col.foreignKeyRef.column}`);
      }
    }
  }

  for (const rel of relationships) {
    const key = `${rel.sourceTable}.${rel.sourceColumn}->${rel.targetTable}.${rel.targetColumn}`;
    if (!inlineFKs.has(key)) {
      const symbol = rel.type === 'one-to-one' ? '-' : rel.type === 'many-to-many' ? '<' : '>';
      lines.push(`Ref: ${rel.sourceTable}.${rel.sourceColumn} ${symbol} ${rel.targetTable}.${rel.targetColumn}`);
    }
  }

  return lines.join('\n');
}
