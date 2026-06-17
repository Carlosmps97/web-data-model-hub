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
