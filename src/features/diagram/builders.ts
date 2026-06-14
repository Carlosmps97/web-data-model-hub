// Table construction helpers — ported from `data.js`:
//   - genDBML / parseDBML  (DBML round-trip; Apply replaces the canvas)
//   - tableFromSources     (FromSQL: derive a table by inheriting columns)

import { v4 as uuidv4 } from 'uuid';
import type { Table, TableColumn, Relationship } from '@/types/model';

interface ColOpts {
  pk?: boolean; fk?: boolean; sk?: boolean; pt?: boolean; nn?: boolean;
  ref?: { table: string; column: string } | null;
  def?: string; logicalName?: string;
}

export function col(id: string, name: string, dataType: string, opts: ColOpts = {}): TableColumn {
  return {
    id, name, dataType,
    logicalName: opts.logicalName ?? '',
    isPrimaryKey: !!opts.pk,
    isForeignKey: !!opts.fk,
    isSurrogateKey: !!opts.sk,
    isPartitionKey: !!opts.pt,
    isNullable: opts.nn ? false : true,
    functionalDefinition: opts.def ?? '',
    foreignKeyRef: opts.ref ?? undefined,
  };
}

const uid = () => 'id' + Math.random().toString(36).slice(2, 9);

// ── DBML ─────────────────────────────────────────────────────────────────────

export function genDBML(tables: Table[]): string {
  let out = '';
  tables.forEach((t) => {
    out += `Table ${t.name} {\n`;
    t.columns.forEach((c) => {
      const flags: string[] = [];
      if (c.isPrimaryKey) flags.push('pk');
      if (c.isNullable === false) flags.push('not null');
      if (c.isForeignKey && c.foreignKeyRef) flags.push(`ref: > ${c.foreignKeyRef.table}.${c.foreignKeyRef.column}`);
      out += `  ${c.name} ${c.dataType}${flags.length ? ' [' + flags.join(', ') + ']' : ''}\n`;
    });
    if (t.functionalDefinition) out += `  Note: '${t.functionalDefinition}'\n`;
    out += '}\n\n';
  });
  return out.trim();
}

export function parseDBML(text: string): { tables: Table[]; relationships: Relationship[] } {
  const tables: Table[] = [];
  const relationships: Relationship[] = [];
  text.split(/Table\s+/i).slice(1).forEach((b) => {
    const nm = (b.match(/^([\w.]+)/) ?? [])[1];
    if (!nm) return;
    const body = (b.match(/\{([\s\S]*?)\}/) ?? [])[1] ?? '';
    const schema = nm.includes('.') ? nm.split('.')[0] : 'public';
    const name = nm.includes('.') ? nm.split('.')[1] : nm;
    const columns: TableColumn[] = [];
    body.split('\n').forEach((raw) => {
      const line = raw.trim();
      if (!line || /^note:/i.test(line)) return;
      const m = line.match(/^([\w]+)\s+([\w()0-9,]+)\s*(\[(.*)\])?/);
      if (!m) return;
      const flags = m[4] ?? '';
      const refM = flags.match(/ref:\s*[<>-]\s*([\w]+)\.([\w]+)/i);
      columns.push(col(`${name}.${m[1]}`, m[1], m[2], {
        pk: /pk|primary key/i.test(flags),
        fk: !!refM,
        nn: /not null/i.test(flags),
        ref: refM ? { table: refM[1], column: refM[2] } : null,
      }));
      if (refM) {
        relationships.push({
          id: uid(),
          source: { table: name, column: `${name}.${m[1]}` },
          target: { table: refM[1], column: `${refM[1]}.${refM[2]}` },
          cardinality: '1:N',
        });
      }
    });
    tables.push({
      id: name, name, logicalName: name, schema,
      layer: undefined, domain: undefined, subdomain: '',
      color: '#4f46e5', functionalDefinition: '', columns, views: [],
    });
  });
  return { tables, relationships };
}

// ── FromSQL ──────────────────────────────────────────────────────────────────

export interface FromSourcesMeta {
  name: string;
  logicalName?: string;
  schema: string;
  layer?: string;
  domain?: string;
  subdomain?: string;
  color?: string;
  def?: string;
  link?: boolean;
}

/** Build a new table by inheriting the picked columns from up to 2 source
 *  tables. When `meta.link`, adds a FK relationship to each parent's PK. */
export function tableFromSources(
  sources: Table[],
  pickedIds: Set<string>,
  meta: FromSourcesMeta,
): { table: Table; rels: Relationship[] } {
  const seen = new Set<string>();
  const columns: TableColumn[] = [];
  sources.forEach((t) => t.columns.forEach((c) => {
    if (!pickedIds.has(c.id) || seen.has(c.name)) return;
    seen.add(c.name);
    columns.push(col(`${meta.name}.${c.name}`, c.name, c.dataType, {
      pk: c.isPrimaryKey, fk: c.isForeignKey, sk: c.isSurrogateKey, pt: c.isPartitionKey,
      nn: c.isNullable === false, ref: c.foreignKeyRef ?? null,
      def: c.functionalDefinition, logicalName: c.logicalName,
    }));
  }));

  const table: Table = {
    id: meta.name, name: meta.name, logicalName: meta.logicalName ?? meta.name, schema: meta.schema,
    layer: meta.layer || undefined, domain: meta.domain || undefined, subdomain: meta.subdomain ?? '',
    color: meta.color ?? '#4f46e5',
    functionalDefinition: meta.def ?? `Derivada de ${sources.map((s) => s.name).join(' + ')}.`,
    columns, views: [],
  };

  const rels: Relationship[] = [];
  if (meta.link) {
    sources.forEach((s) => {
      const pk = s.columns.find((c) => c.isPrimaryKey);
      const inh = pk && columns.find((c) => c.name === pk.name);
      if (pk && inh) {
        rels.push({ id: uuidv4(), source: { table: meta.name, column: inh.id }, target: { table: s.id, column: pk.id }, cardinality: '1:N' });
      }
    });
  }
  return { table, rels };
}
