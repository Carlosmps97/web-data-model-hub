// Doc 74: orden único de columnas — helpers compartidos por canvas, panel e inspector.
import { describe, expect, it, vi } from 'vitest';
import { isPkFirst, moveId, orderColumns, persistReorder, pkFirstOrdinals, placeAtKeyBoundary, reorderPlan, sortByOrdinal } from './columnOrder';
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

// Doc 81 → doc 94: el ÚNICO orden = PK primero y, dentro de cada bloque, el
// `ordinal` (sin orden de llave aparte). Es lo que dibuja el canvas; lo
// comparten properties, inspector, panel de columna, vistas y DDL.
describe('orderColumns (doc 94 — PK primero, ordenadas por ordinal)', () => {
  // Caso del bug doc 81: la carga Excel dejó el ordinal en orden de hoja.
  const excel = [
    { id: 'party', ordinal: 0, isPrimaryKey: true },
    { id: 'rol', ordinal: 1, isPrimaryKey: true },
    { id: 'xd', ordinal: 2, isPrimaryKey: false },
    { id: 'evaluada', ordinal: 3, isPrimaryKey: true },
  ];

  it('pone los PK primero y el resto después, ambos por ordinal', () => {
    expect(orderColumns(excel).map((c) => c.id)).toEqual(['party', 'rol', 'evaluada', 'xd']);
  });

  it('coincide EXACTAMENTE con el orden que arma el canvas (pks + resto)', () => {
    const canvas = [...pkInKeyOrder(excel), ...sortByOrdinal(excel.filter((c) => !c.isPrimaryKey))];
    expect(orderColumns(excel).map((c) => c.id)).toEqual(canvas.map((c) => c.id));
  });

  it('entre PK manda el ordinal: no hay orden de llave aparte (un pkPosition viejo se ignora)', () => {
    const cols = [
      { id: 'p2', ordinal: 5, isPrimaryKey: true, pkPosition: 1 },
      { id: 'p1', ordinal: 9, isPrimaryKey: true, pkPosition: 0 },
      { id: 'n', ordinal: 0, isPrimaryKey: false },
    ];
    expect(orderColumns(cols).map((c) => c.id)).toEqual(['p2', 'p1', 'n']);
  });

  it('sin PK = puro ordinal; no muta la entrada', () => {
    const input = [{ id: 'b', ordinal: 1, isPrimaryKey: false }, { id: 'a', ordinal: 0, isPrimaryKey: false }];
    expect(orderColumns(input).map((c) => c.id)).toEqual(['a', 'b']);
    expect(input.map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('isPkFirst (doc 94 D3 — una PK nunca debajo de una no-PK)', () => {
  const cols = [
    { id: 'k1', ordinal: 0, isPrimaryKey: true }, { id: 'k2', ordinal: 1, isPrimaryKey: true },
    { id: 'a', ordinal: 2 }, { id: 'b', ordinal: 3 },
  ];
  it('acepta reordenar dentro de cada bloque', () => {
    expect(isPkFirst(cols, ['k2', 'k1', 'b', 'a'])).toBe(true);
  });
  it('rechaza una PK debajo de una no-PK (o una no-PK arriba de una PK)', () => {
    expect(isPkFirst(cols, ['k1', 'a', 'k2', 'b'])).toBe(false);
    expect(isPkFirst(cols, ['a', 'k1', 'k2', 'b'])).toBe(false);
  });
  it('ignora ids desconocidos', () => {
    expect(isPkFirst(cols, ['zzz', 'k1', 'k2', 'a', 'b'])).toBe(true);
  });
});

describe('placeAtKeyBoundary (doc 94 D2 — marcar/desmarcar PK re-ubica la columna)', () => {
  const cols = [
    { id: 'k1', ordinal: 0, isPrimaryKey: true }, { id: 'k2', ordinal: 1, isPrimaryKey: true },
    { id: 'a', ordinal: 2 }, { id: 'b', ordinal: 3 }, { id: 'c', ordinal: 4 },
  ];
  it('una columna que pasa a PK queda al FINAL del bloque de PK', () => {
    expect(placeAtKeyBoundary(cols, 'c')).toEqual(['k1', 'k2', 'c', 'a', 'b']);
  });
  it('una PK que deja de serlo queda PRIMERA entre las no-PK', () => {
    expect(placeAtKeyBoundary(cols, 'k1')).toEqual(['k2', 'k1', 'a', 'b', 'c']);
  });
  it('bug del owner: columna nueva (ordinal al final) marcada PK sube al bloque; datos viejos se normalizan', () => {
    const legacy = [
      { id: 'a', ordinal: 0 }, { id: 'k', ordinal: 1, isPrimaryKey: true },
      { id: 'n', ordinal: 2 }, { id: 'nueva', ordinal: 3 },
    ];
    expect(placeAtKeyBoundary(legacy, 'nueva')).toEqual(['k', 'nueva', 'a', 'n']);
  });
  it('id desconocido: el orden único tal cual', () => {
    expect(placeAtKeyBoundary(cols, 'zzz')).toEqual(['k1', 'k2', 'a', 'b', 'c']);
  });
});

describe('pkFirstOrdinals (doc 94 D2 — escrituras que cambian la llave dejan la tabla PK primero)', () => {
  const cols = [
    { id: 'k1', ordinal: 0, isPrimaryKey: true }, { id: 'k2', ordinal: 1, isPrimaryKey: true },
    { id: 'a', ordinal: 2 }, { id: 'b', ordinal: 3 }, { id: 'c', ordinal: 4 },
  ];
  const obj = (m: Map<string, number>) => Object.fromEntries(m);

  it('una columna que entra a la llave: al final del bloque PK; solo cambian las que se corren', () => {
    expect(obj(pkFirstOrdinals(cols, { toKey: ['c'] }))).toEqual({ c: 2, a: 3, b: 4 });
  });
  it('una PK que sale: primera entre las no-PK', () => {
    expect(obj(pkFirstOrdinals(cols, { fromKey: ['k1'] }))).toEqual({ k2: 0, k1: 1 });
  });
  it('columnas nuevas: las PK (en toKey) tras la última PK, las demás al final', () => {
    expect(obj(pkFirstOrdinals(cols, { toKey: ['n1'], add: [{ id: 'n1' }, { id: 'n2' }] })))
      .toEqual({ n1: 2, a: 3, b: 4, c: 5, n2: 6 });
  });
  it('varias entradas conservan el orden pedido (filas de una relación identificante)', () => {
    expect(obj(pkFirstOrdinals(cols, { toKey: ['b', 'new', 'a'], add: [{ id: 'new' }] })))
      .toEqual({ b: 2, new: 3, a: 4, c: 5 });
  });
  it('sin cambios de llave ni altas ⇒ normaliza solo lo desordenado', () => {
    expect(pkFirstOrdinals(cols, {}).size).toBe(0);
    const legacy = [{ id: 'a', ordinal: 0 }, { id: 'k', ordinal: 1, isPrimaryKey: true }];
    expect(obj(pkFirstOrdinals(legacy, {}))).toEqual({ k: 0, a: 1 });
  });
});
