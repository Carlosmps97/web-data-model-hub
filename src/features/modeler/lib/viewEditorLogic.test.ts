// Lógica pura del ViewEditor multi-fuente (F3): claves de grilla, serialización
// de sources y (doc 91 D7) todas las columnas de las fuentes en modo
// User-Defined SQL.
import { describe, expect, it } from 'vitest';
import { colKey, splitColKey, serializeSources, allSourceColumns, type ColCfg } from './viewEditorLogic';

describe('viewEditorLogic — grilla multi-fuente (F3)', () => {
  const cfg: Record<string, ColCfg> = {
    't1::ID': { included: true, output: 'ID', expression: '', castType: '', description: 'Business key' },
    't1::NOMBRE': { included: true, output: 'nombre_up', expression: 'UPPER(t1.NOMBRE)', castType: '', description: '' },
    't2::SALDO': { included: true, output: 'saldo_txt', expression: '', castType: 'STRING', description: '  ' },
    't2::MONEDA': { included: false, output: 'MONEDA', expression: '', castType: '', description: '' },
  };
  const order = ['t1::ID', 't1::NOMBRE', 't2::SALDO', 't2::MONEDA', 't9::FANTASMA'];
  const valid = new Set(['t1::ID', 't1::NOMBRE', 't2::SALDO', 't2::MONEDA']);

  it('colKey/splitColKey hacen round-trip', () => {
    expect(splitColKey(colKey('t1', 'ID'))).toEqual({ tableId: 't1', column: 'ID' });
  });

  it('serializa solo columnas incluidas Y válidas, en orden, con tableId', () => {
    const out = serializeSources(order, cfg, valid);
    expect(out.map((s) => s.column)).toEqual(['ID', 'NOMBRE', 'SALDO']);
    expect(out[0]).toEqual({ column: 'ID', tableId: 't1', outputAlias: undefined, expression: undefined, castType: undefined, description: 'Business key' });
  });

  it('alias solo si difiere de la columna; expression y castType solo si no vacíos', () => {
    const out = serializeSources(order, cfg, valid);
    expect(out[1].outputAlias).toBe('nombre_up');
    expect(out[1].expression).toBe('UPPER(t1.NOMBRE)');
    expect(out[2].castType).toBe('STRING');
    expect(out[2].outputAlias).toBe('saldo_txt');
  });

  it('description (F5): se serializa con texto, se omite si vacía/whitespace', () => {
    const out = serializeSources(order, cfg, valid);
    expect(out[0].description).toBe('Business key');   // t1::ID
    expect(out[2].description).toBeUndefined();          // t2::SALDO = '  ' → trim → undefined
  });
});

describe('allSourceColumns (doc 91 D7 — User-Defined SQL ⇒ todas las columnas de las fuentes)', () => {
  const cols = new Map([
    ['t1', [{ physicalName: 'ID' }, { physicalName: 'NOMBRE' }]],
    ['t2', [{ physicalName: 'SALDO' }]],
  ]);

  it('lista todas las columnas de cada fuente, en orden de fuentes y orden físico, planas', () => {
    expect(allSourceColumns(['t2', 't1'], cols)).toEqual([
      { column: 'SALDO', tableId: 't2' },
      { column: 'ID', tableId: 't1' },
      { column: 'NOMBRE', tableId: 't1' },
    ]);
  });

  it('fuente sin columnas a mano (fuera del canvas): conserva las entradas previas de esa tabla', () => {
    const prev = [{ column: 'X', tableId: 't9', outputAlias: 'x_alias' }, { column: 'ID', tableId: 't1', outputAlias: 'viejo' }];
    expect(allSourceColumns(['t1', 't9'], cols, prev)).toEqual([
      { column: 'ID', tableId: 't1' }, { column: 'NOMBRE', tableId: 't1' },
      { column: 'X', tableId: 't9', outputAlias: 'x_alias' },
    ]);
  });

  it('sin fuentes ⇒ vacío', () => {
    expect(allSourceColumns([], cols)).toEqual([]);
  });
});
