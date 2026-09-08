// Doc 74: orden único de columnas — helpers compartidos por canvas, panel e inspector.
import { describe, expect, it, vi } from 'vitest';
import { moveId, persistReorder, reorderPlan, sortByOrdinal } from './columnOrder';

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
