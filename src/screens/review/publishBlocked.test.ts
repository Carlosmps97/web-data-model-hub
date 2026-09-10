import { describe, expect, it } from 'vitest';
import { blockedTitle, groupBlockedItems, itemContext, itemWhere } from './publishBlocked';
import type { PublishBlockedDetail, PublishBlockedItem } from '@/types/versioning';

const fmt = (iso: string) => `D(${iso})`;
const userName = (id: string) => (id === 'admin' ? 'Admin' : id);

const table: PublishBlockedItem = {
  collection: 'canonical_tables', kind: 'table', entityId: 't9', name: 'AACARGATABLA01', schema: 'A_DB',
  where: 'production', message: 'Table AACARGATABLA01 already exists (schema A_DB)',
  existing: { id: 'tx', name: 'AACARGATABLA01', schema: 'A_DB', version: 'v2', owner: 'admin', publishedAt: '2026-09-10T02:20:00+00:00' },
};

describe('publishBlocked (doc 84 A1)', () => {
  it('el título es la cabecera del mensaje, sin la cola de ejemplos', () => {
    const d: PublishBlockedDetail = { code: 'duplicate_names', items: [table],
      message: 'Publish blocked: 1 table name already exists in production — Table X already exists | +2 more' };
    expect(blockedTitle(d)).toBe('Publish blocked: 1 table name already exists in production');
    expect(blockedTitle({ ...d, message: '' })).toBe('Publish blocked');
  });

  it('agrupa por tipo en orden fijo con label legible', () => {
    const col: PublishBlockedItem = { kind: 'column', name: 'ID', message: 'm', where: 'production' };
    const sch: PublishBlockedItem = { kind: 'schema', name: 'S', message: 'm', where: 'production' };
    const g = groupBlockedItems([sch, col, table]);
    expect(g.map((x) => [x.kind, x.label, x.items.length])).toEqual([
      ['table', 'Tables', 1], ['column', 'Columns', 1], ['schema', 'Schemas', 1],
    ]);
  });

  it('contexto: esquema de la tabla / tabla de la columna', () => {
    expect(itemContext(table)).toBe('schema A_DB');
    expect(itemContext({ kind: 'column', name: 'ID', tableName: 'M_CUENTA', message: 'm' })).toBe('in table M_CUENTA');
    expect(itemContext({ kind: 'schema', name: 'S', message: 'm' })).toBe('');
  });

  it('dónde choca: producción con versión/owner/fecha; repetido dentro del request', () => {
    expect(itemWhere(table, fmt, userName))
      .toBe('In production since v2, published by Admin on D(2026-09-10T02:20:00+00:00)');
    expect(itemWhere({ ...table, existing: { id: 'tx', name: 'AACARGATABLA01' } }, fmt, userName))
      .toBe('Already in production');
    expect(itemWhere({ kind: 'table', name: 'm_x', where: 'request', message: 'm', existing: { id: 't8', name: 'M_X' } }, fmt, userName))
      .toBe('Also created in this request as M_X');
    expect(itemWhere({ kind: 'change', message: 'payload inválido' }, fmt, userName)).toBe('payload inválido');
  });
});
