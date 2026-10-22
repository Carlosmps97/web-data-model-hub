import { describe, expect, it } from 'vitest';
import type { BulkChange } from '@/services/governance.service';
import { invertBulk, preKey } from './undoInvert';

const up = (collection: string, entityId: string, payload: Record<string, unknown>): BulkChange =>
  ({ collection, entityId, op: 'upsert', payload });
const del = (collection: string, entityId: string): BulkChange =>
  ({ collection, entityId, op: 'delete' });

describe('invertBulk', () => {
  it('upsert de entidad nueva → delete; con pre-imagen → re-upsert del pre', () => {
    const pre = new Map([[preKey('canonical_columns', 'c1'), { id: 'c1', physicalName: 'VIEJO' }]]);
    const inv = invertBulk([
      up('canonical_columns', 'c1', { id: 'c1', physicalName: 'NUEVO' }),   // existente modificada
      up('canonical_columns', 'c9', { id: 'c9', physicalName: 'CREADA' }),  // creada
    ], pre);
    expect(inv).toEqual([
      del('canonical_columns', 'c9'),
      up('canonical_columns', 'c1', { id: 'c1', physicalName: 'VIEJO' }),
    ]);
  });

  it('delete con pre-imagen → re-upsert; sin pre-imagen se omite', () => {
    const pre = new Map([[preKey('relationships', 'r1'), { id: 'r1', pairs: [] }]]);
    const inv = invertBulk([del('relationships', 'r1'), del('views', 'v1')], pre);
    expect(inv).toEqual([up('relationships', 'r1', { id: 'r1', pairs: [] })]);
  });

  it('invierte el orden (lo último aplicado se deshace primero)', () => {
    const inv = invertBulk([
      up('canonical_columns', 'c9', { id: 'c9' }),
      up('relationships', 'r9', { id: 'r9' }),
    ], new Map());
    expect(inv.map((c) => c.entityId)).toEqual(['r9', 'c9']);
  });
});
