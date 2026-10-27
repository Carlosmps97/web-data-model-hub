import { describe, expect, it } from 'vitest';
import { blockedTitle, groupBlockedItems, itemContext, itemLabel, itemWhere } from './publishBlocked';
import type { PublishBlockedDetail, PublishBlockedItem } from '@/types/versioning';

const fmt = (iso: string) => `D(${iso})`;
const userName = (id: string) => (id === 'admin' ? 'Admin' : id);

const table: PublishBlockedItem = {
  collection: 'canonical_tables', kind: 'table', entityId: 't9', name: 'AACARGATABLA01', schema: 'A_DB',
  where: 'production', message: 'Table AACARGATABLA01 already exists (schema A_DB)',
  existing: { id: 'tx', name: 'AACARGATABLA01', schema: 'A_DB', version: 'v2', owner: 'admin', publishedAt: '2026-09-10T02:20:00+00:00' },
};

describe('publishBlocked', () => {
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

  it('dónde choca: producción con versión/dueño/fecha; repetido dentro del request', () => {
    expect(itemWhere(table, fmt, userName))
      .toBe('In production since v2, published by Admin on D(2026-09-10T02:20:00+00:00)');
    expect(itemWhere({ ...table, existing: { id: 'tx', name: 'AACARGATABLA01' } }, fmt, userName))
      .toBe('Already in production');
    expect(itemWhere({ kind: 'table', name: 'm_x', where: 'request', message: 'm', existing: { id: 't8', name: 'M_X' } }, fmt, userName))
      .toBe('Also created in this request as M_X');
    expect(itemWhere({ kind: 'change', message: 'payload inválido' }, fmt, userName)).toBe('payload inválido');
  });
});

// El nombre de vista también es único en el proyecto: el publish bloqueado los
// lista en su propio grupo, con el esquema como las tablas.
describe('publishBlocked: vistas con nombre repetido', () => {
  const view: PublishBlockedItem = {
    collection: 'views', kind: 'view', entityId: 'v9', name: 'CLIENTE', schema: 'b_vu',
    where: 'production', message: 'View CLIENTE already exists (schema a_vu)',
    existing: { id: 'vx', name: 'CLIENTE', schema: 'a_vu', version: 'v4', owner: 'admin', publishedAt: '2026-10-10T10:00:00+00:00' },
  };

  it('grupo «Views» después de las tablas', () => {
    const col: PublishBlockedItem = { kind: 'column', name: 'ID', message: 'm', where: 'production' };
    expect(groupBlockedItems([col, view, table]).map((x) => [x.kind, x.label])).toEqual([
      ['table', 'Tables'], ['view', 'Views'], ['column', 'Columns'],
    ]);
  });

  it('contexto y dónde choca: el esquema de la vista y el de la que ya existe', () => {
    expect(itemContext(view)).toBe('schema b_vu');
    expect(itemWhere(view, fmt, userName))
      .toBe('In production since v4, published by Admin on D(2026-10-10T10:00:00+00:00) (schema a_vu)');
  });

  it('lo que otra versión borró se lista con su id y dice qué versión lo borró', () => {
    const deleted: PublishBlockedItem = {
      collection: 'views', kind: 'view', entityId: '6e4e218e', name: 'M_TRANSACCIONCASOCLIENTE', where: 'deleted',
      message: 'View M_TRANSACCIONCASOCLIENTE (6e4e218e) was deleted in production by v4 after this version was opened',
      existing: { version: 'v4', owner: 'admin', publishedAt: '2026-10-14T19:49:41+00:00' },
    };
    expect(itemLabel(deleted)).toBe('M_TRANSACCIONCASOCLIENTE (6e4e218e)');
    expect(itemWhere(deleted, fmt, userName))
      .toBe('Deleted in production by v4 (Admin) on D(2026-10-14T19:49:41+00:00) after this version was opened');
    expect(itemWhere({ ...deleted, existing: null }, fmt, userName)).toBe('Deleted in production after this version was opened');
    // Una columna borrada se ubica por su tabla; otros choques conservan su nombre solo.
    expect(itemContext({ ...deleted, kind: 'column', tableName: 'M_CUENTA' })).toBe('in table M_CUENTA');
    expect(itemLabel(table)).toBe('AACARGATABLA01');
    expect(groupBlockedItems([{ ...deleted, kind: 'relationship' }])[0].label).toBe('Relationships');
  });

  it('dice qué se borró cuando no es el objeto mismo: su tabla, su esquema o la columna de un par', () => {
    const col: PublishBlockedItem = {
      kind: 'column', entityId: 'c1', name: 'CODNUEVO', where: 'deleted', message: 'm', tableName: 'M_NUEVA',
      deletedParent: { kind: 'schema', id: 's1', name: 'STG' }, afterOpened: true,
      existing: { version: 'v7', owner: 'admin', publishedAt: '2026-10-21T10:00:00+00:00' },
    };
    expect(itemWhere(col, fmt, userName))
      .toBe('Schema STG deleted in production by v7 (Admin) on D(2026-10-21T10:00:00+00:00) after this version was opened');
    expect(itemWhere({ ...col, deletedParent: { kind: 'table', name: 'M_CUENTA' } }, fmt, userName))
      .toMatch(/^Table M_CUENTA deleted in production by v7/);
    const rel: PublishBlockedItem = { ...col, kind: 'relationship', deletedParent: { kind: 'column', id: 'c9', name: 'CODCLIENTE' } };
    expect(itemWhere(rel, fmt, userName)).toMatch(/^Column CODCLIENTE deleted in production by v7/);
    // Un esquema borrado antes de abrirse la versión: sin la coletilla.
    expect(itemWhere({ ...col, afterOpened: false, existing: null }, fmt, userName)).toBe('Schema STG deleted in production');
    expect(itemContext({ ...col, kind: 'table', schema: 'STG' })).toBe('schema STG');
  });
});
