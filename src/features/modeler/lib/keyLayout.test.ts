import { describe, expect, it } from 'vitest';
import type { CanonicalColumn } from '@/services/governance.service';
import { keyLayoutBulk } from './keyLayout';

const col = (id: string, ordinal: number, pk = false): CanonicalColumn => ({
  id, tableId: 't1', physicalName: id.toUpperCase(), logicalName: id, dataType: 'STRING',
  typeOverridden: false, ordinal, isPrimaryKey: pk, udpValues: { u: id },
});
const COLS = [col('k1', 0, true), col('k2', 1, true), col('a', 2), col('b', 3), col('c', 4)];
const payloads = (r: ReturnType<typeof keyLayoutBulk>) =>
  Object.fromEntries(r.changes.map((ch) => [ch.entityId, ch.payload as unknown as CanonicalColumn]));

describe('keyLayoutBulk (doc 94 D2)', () => {
  it('marcar PK: la columna sube al final del bloque PK y las corridas viajan en el MISMO lote', () => {
    const r = keyLayoutBulk(COLS, { c: { isPrimaryKey: true, isNullable: false } });
    const p = payloads(r);
    expect(Object.keys(p).sort()).toEqual(['a', 'b', 'c']);
    expect([p.c.ordinal, p.c.isPrimaryKey, p.c.isNullable, p.a.ordinal, p.b.ordinal]).toEqual([2, true, false, 3, 4]);
    expect(p.a.udpValues).toEqual({ u: 'a' });                    // doc completo
    expect(r.pres.map((c) => [c.id, c.ordinal])).toEqual([['a', 2], ['b', 3], ['c', 4]]);   // pre-imágenes para el Undo
  });

  it('desmarcar PK: queda primera entre las no-PK', () => {
    const p = payloads(keyLayoutBulk(COLS, { k1: { isPrimaryKey: false } }));
    expect([p.k1.ordinal, p.k1.isPrimaryKey, p.k2.ordinal]).toEqual([1, false, 0]);
  });

  it('varias entradas respetan el orden de los patches y cada columna viaja UNA sola vez', () => {
    const r = keyLayoutBulk(COLS, { b: { isPrimaryKey: true, isForeignKey: true }, a: { isPrimaryKey: true, isForeignKey: true } });
    const p = payloads(r);
    expect([p.b.ordinal, p.a.ordinal]).toEqual([2, 3]);
    expect(r.changes.map((ch) => ch.entityId).filter((id) => id === 'a')).toHaveLength(1);
  });

  it('patch sin cambio de llave: solo esa columna, sin corridas', () => {
    const r = keyLayoutBulk(COLS, { b: { description: 'x' } });
    expect(r.changes.map((ch) => ch.entityId)).toEqual(['b']);
    expect((r.changes[0].payload as unknown as CanonicalColumn).ordinal).toBe(3);
  });
});
