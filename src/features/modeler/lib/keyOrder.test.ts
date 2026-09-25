import { describe, expect, it } from 'vitest';
import { pkInKeyOrder } from './keyOrder';

// Doc 94 D1: ya no hay orden de llave aparte — la llave sigue el `ordinal`.
describe('pkInKeyOrder', () => {
  it('solo las PK, por ordinal', () => {
    const cols = [
      { id: 'producto', ordinal: 0, isPrimaryKey: true },
      { id: 'x', ordinal: 2, isPrimaryKey: false },
      { id: 'codmes', ordinal: 5, isPrimaryKey: true },
    ];
    expect(pkInKeyOrder(cols).map((c) => c.id)).toEqual(['producto', 'codmes']);
  });

  it('un pkPosition que quedó en datos viejos NO manda', () => {
    const cols = [
      { id: 'b', ordinal: 3, isPrimaryKey: true, pkPosition: 0 },
      { id: 'a', ordinal: 1, isPrimaryKey: true, pkPosition: 1 },
    ];
    expect(pkInKeyOrder(cols).map((c) => c.id)).toEqual(['a', 'b']);
  });
});
