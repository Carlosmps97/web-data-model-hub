// Doc 74: orden único de columnas — helpers compartidos por canvas, panel e inspector.
import { describe, expect, it, vi } from 'vitest';
import { moveId, orderColumns, persistReorder, reorderPlan, sortByOrdinal } from './columnOrder';
import { pkInKeyOrder } from './keyOrder';

const cols = [
  { id: 'a', ordinal: 0 },
  { id: 'b', ordinal: 1 },
  { id: 'c', ordinal: 2 },
];

describe('columnOrder', () => {
  it('sortByOrdinal ordena por ordinal, es estable y no muta', () => {
    const input = [{ id: 'x', ordinal: 2 }, { id: 'y', ordinal: 0 }, { id: 'z', ordinal: 2 }, { id: 'w', ordinal: 1 }];
    expect(sortByOrdinal(input).map((c) => c.id)).toEqual(['y', 'w', 'x', 'z']);
    expect(input.map((c) => c.id)).toEqual(['x', 'y', 'z', 'w']);
  });

  it('reorderPlan: sólo las columnas cuya posición cambia', () => {
    expect(reorderPlan(cols, ['a', 'b', 'c'])).toEqual([]);
    expect(reorderPlan(cols, ['b', 'a', 'c']).map((s) => [s.c.id, s.idx])).toEqual([['b', 0], ['a', 1]]);
    expect(reorderPlan(cols, ['zzz', 'a']).map((s) => [s.c.id, s.idx])).toEqual([['a', 1]]);
  });

  it('moveId mueve dentro del rango y no muta la entrada', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveId(ids, 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveId(ids, 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveId(ids, 'a', -1)).toBe(ids);
    expect(moveId(ids, 'c', 1)).toBe(ids);
    expect(moveId(ids, 'x', 1)).toBe(ids);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('persistReorder guarda en tandas', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const plan = Array.from({ length: 7 }, (_, i) => ({ c: { id: String(i) }, idx: i }));
    await persistReorder(plan, save, 3);
    expect(save).toHaveBeenCalledTimes(7);
    expect(save.mock.calls[6]).toEqual([{ id: '6' }, 6]);
  });
});

// Doc 81: el ÚNICO orden de display = bloque PK (orden de llave) + resto por
// ordinal. Es exactamente lo que el canvas ya hace; se unifica para que el
// properties, el inspector y el panel de columna no diverjan del canvas.
describe('orderColumns (doc 81 — PK primero, canónico y compartido)', () => {
  // Caso del bug reportado: la carga Excel dejó el ordinal en orden de hoja
  // (PK, PK, no-PK, PK). El canvas agrupaba los PK arriba; el properties no.
  const excel = [
    { id: 'party', ordinal: 0, isPrimaryKey: true, pkPosition: 0 },
    { id: 'rol', ordinal: 1, isPrimaryKey: true, pkPosition: 1 },
    { id: 'xd', ordinal: 2, isPrimaryKey: false },
    { id: 'evaluada', ordinal: 3, isPrimaryKey: true, pkPosition: 2 },
  ];

  it('pone los PK primero (en orden de llave) y el resto por ordinal', () => {
    expect(orderColumns(excel).map((c) => c.id)).toEqual(['party', 'rol', 'evaluada', 'xd']);
  });

  it('coincide EXACTAMENTE con el orden que arma el canvas (pks + resto)', () => {
    // Réplica de TableNode: pkInKeyOrder(cols) seguido de las no-PK por ordinal.
    const canvas = [...pkInKeyOrder(excel), ...sortByOrdinal(excel.filter((c) => !c.isPrimaryKey))];
    expect(orderColumns(excel).map((c) => c.id)).toEqual(canvas.map((c) => c.id));
  });

  it('el bloque PK sigue pkPosition, no el ordinal', () => {
    const cols = [
      { id: 'p2', ordinal: 5, isPrimaryKey: true, pkPosition: 1 },
      { id: 'p1', ordinal: 9, isPrimaryKey: true, pkPosition: 0 },
      { id: 'n', ordinal: 0, isPrimaryKey: false },
    ];
    expect(orderColumns(cols).map((c) => c.id)).toEqual(['p1', 'p2', 'n']);
  });

  it('sin PK = puro ordinal; no muta la entrada', () => {
    const input = [{ id: 'b', ordinal: 1, isPrimaryKey: false }, { id: 'a', ordinal: 0, isPrimaryKey: false }];
    expect(orderColumns(input).map((c) => c.id)).toEqual(['a', 'b']);
    expect(input.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('PK marcada a mano (sin pkPosition) cae al ordinal, después de las explícitas', () => {
    const cols = [
      { id: 'manual', ordinal: 1, isPrimaryKey: true },
      { id: 'explicit', ordinal: 4, isPrimaryKey: true, pkPosition: 0 },
      { id: 'n', ordinal: 0, isPrimaryKey: false },
    ];
    expect(orderColumns(cols).map((c) => c.id)).toEqual(['explicit', 'manual', 'n']);
  });
});
