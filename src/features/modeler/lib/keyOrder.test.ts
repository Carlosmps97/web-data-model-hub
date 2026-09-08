import { describe, expect, it } from 'vitest';
import type { CanonicalColumn } from '@/services/governance.service';
import { nextPkPosition, pkInKeyOrder, reorderKey, sortByKeyOrder } from './keyOrder';

const col = (id: string, ordinal: number, pk: boolean, pkPosition?: number | null): CanonicalColumn => ({
  id, tableId: 't1', physicalName: id.toUpperCase(), logicalName: id,
  dataType: 'STRING', typeOverridden: false, ordinal,
  isPrimaryKey: pk, pkPosition,
});

describe('sortByKeyOrder / pkInKeyOrder', () => {
  it('ordena por pkPosition, no por ordinal (caso CODMES líder de llave)', () => {
    const cols = [col('producto', 0, true, 1), col('codmes', 5, true, 0), col('x', 2, false)];
    expect(pkInKeyOrder(cols).map((c) => c.id)).toEqual(['codmes', 'producto']);
  });

  it('PKs sin posición (a mano) caen al orden físico, DESPUÉS de las explícitas', () => {
    const cols = [col('manual', 1, true, null), col('kb', 4, true, 1), col('ka', 6, true, 0)];
    expect(sortByKeyOrder(cols.filter((c) => c.isPrimaryKey)).map((c) => c.id))
      .toEqual(['ka', 'kb', 'manual']);
  });

  it('tabla 100% a mano (todas sin posición) = orden físico puro', () => {
    const cols = [col('b', 3, true), col('a', 1, true)];
    expect(pkInKeyOrder(cols).map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('nextPkPosition (entrar a la llave)', () => {
  it('con orden explícito → al FINAL de la llave', () => {
    const cols = [col('k0', 0, true, 0), col('k1', 1, true, 1), col('nueva', 2, false)];
    expect(nextPkPosition(cols, 'nueva')).toBe(2);
  });
  it('sin orden explícito → null (rige la regla simple del físico)', () => {
    const cols = [col('k0', 0, true), col('k1', 1, true)];
    expect(nextPkPosition(cols)).toBeNull();
  });
  it('excluye a la columna que está entrando (idempotente en re-marcados)', () => {
    const cols = [col('k0', 0, true, 0), col('re', 1, true, 5)];
    expect(nextPkPosition(cols, 're')).toBe(1);
  });
});

describe('reorderKey', () => {
  it('sube una PK y normaliza 0..k-1 (incluye las que estaban sin posición)', () => {
    const cols = [col('k0', 0, true, 0), col('k1', 1, true, 1), col('manual', 2, true, null)];
    expect(reorderKey(cols, 'manual', -1)).toEqual([
      { id: 'k0', pkPosition: 0 }, { id: 'manual', pkPosition: 1 }, { id: 'k1', pkPosition: 2 },
    ]);
  });
  it('movimientos fuera de rango no hacen nada', () => {
    const cols = [col('k0', 0, true, 0), col('k1', 1, true, 1)];
    expect(reorderKey(cols, 'k0', -1)).toEqual([]);
    expect(reorderKey(cols, 'k1', 1)).toEqual([]);
    expect(reorderKey(cols, 'zzz', 1)).toEqual([]);
  });
});
