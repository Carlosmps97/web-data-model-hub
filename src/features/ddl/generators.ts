// DDL generators — ported from `data.js` (genDDL / genViewDDL).
// Views are SQL projections embedded in their table; `includeViews` appends a
// `CREATE VIEW` per role view.

import type { Table, View } from '@/types/model';

/** `CREATE VIEW schema.name AS SELECT <exprs> FROM schema.table [WHERE …];` */
export function genViewDDL(table: Table, v: View): string {
  const full = `${table.schema}.${table.name}`;
  const cols = (v.select ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const conds = (v.where ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  let out = `CREATE VIEW ${table.schema}.${v.name} AS\nSELECT\n  ${cols.join(',\n  ') || '*'}\nFROM ${full}`;
  if (conds.length) out += `\nWHERE ${conds.join('\n  AND ')}`;
  return out + ';';
}

export interface GenDDLOptions {
  name?: string;
  engineLabel?: string;
  includeViews?: boolean;
}

export function genDDL(tables: Table[], opts: GenDDLOptions = {}): string {
  let out = `-- ${opts.name ?? 'model'} · ${opts.engineLabel ?? ''}\n\n`;
  tables.forEach((t) => {
    const full = `${t.schema}.${t.name}`;
    out += `CREATE TABLE ${full} (\n`;
    const lines = t.columns.map((c) => {
      let l = `  ${c.name} ${c.dataType.toUpperCase()}`;
      if (c.isNullable === false) l += ' NOT NULL';
      return l;
    });
    const pks = t.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
    if (pks.length) lines.push(`  PRIMARY KEY (${pks.join(', ')})`);
    out += lines.join(',\n') + '\n);\n';
    t.columns
      .filter((c) => c.isForeignKey && c.foreignKeyRef)
      .forEach((c) => {
        out += `ALTER TABLE ${full} ADD FOREIGN KEY (${c.name}) REFERENCES ${c.foreignKeyRef!.table}(${c.foreignKeyRef!.column});\n`;
      });
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
