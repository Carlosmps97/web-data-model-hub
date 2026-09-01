// Lógica pura del ViewEditor multi-fuente (F3): claves de grilla, serialización
// de sources y regla de persistencia del joinOverride.
import { describe, expect, it } from 'vitest';
import { colKey, splitColKey, serializeSources, resolveJoinOverride, inferNameJoin, type ColCfg } from './viewEditorLogic';

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

  it('resolveJoinOverride: persiste solo si difiere de la inferida (derivación viva)', () => {
    expect(resolveJoinOverride('t1.ID = t2.CLIENTE_ID', 't1.ID = t2.CLIENTE_ID')).toBeUndefined();
    expect(resolveJoinOverride('   ', 'x = y')).toBeUndefined();
    expect(resolveJoinOverride('t1.ID = t2.X', 't1.ID = t2.CLIENTE_ID')).toBe('t1.ID = t2.X');
  });
});

describe('inferNameJoin (doc 64 §4a — sugerencia por columnas homónimas)', () => {
  const COLS = [
    { tableId: 't1', physicalName: 'ID_CLIENTE', isPrimaryKey: true },
    { tableId: 't1', physicalName: 'NOMBRE' },
    { tableId: 't2', physicalName: 'ID_CLIENTE' },
    { tableId: 't2', physicalName: 'SALDO' },
  ];

  it('sin relación modelada, sugiere igualdad por homónimas priorizando PK', () => {
    expect(inferNameJoin(['t1', 't2'], [], COLS)).toBe('t1.ID_CLIENTE = t2.ID_CLIENTE');
  });

  it('fuente CONECTADA por relación no aporta sugerencia (la cubre inferJoin)', () => {
    const rels = [{ parentTableId: 't1', childTableId: 't2' }];
    expect(inferNameJoin(['t1', 't2'], rels, COLS)).toBe('');
  });

  it('sin PK homónimas usa TODAS las homónimas; sin homónimas, nada', () => {
    const cols = [
      { tableId: 't1', physicalName: 'COD' }, { tableId: 't1', physicalName: 'FECHA' },
      { tableId: 't2', physicalName: 'COD' }, { tableId: 't2', physicalName: 'FECHA' },
      { tableId: 't3', physicalName: 'OTRA' },
    ];
    expect(inferNameJoin(['t1', 't2'], [], cols)).toBe('t1.COD = t2.COD AND t1.FECHA = t2.FECHA');
    expect(inferNameJoin(['t1', 't3'], [], cols)).toBe('');
  });

  it('match case-insensitive emitiendo cada lado con SU casing', () => {
    const cols = [
      { tableId: 't1', physicalName: 'id_cliente' },
      { tableId: 't2', physicalName: 'ID_CLIENTE' },
    ];
    expect(inferNameJoin(['t1', 't2'], [], cols)).toBe('t1.id_cliente = t2.ID_CLIENTE');
  });

  it('una sola fuente ⇒ vacío; columnas de tablas ajenas se ignoran', () => {
    expect(inferNameJoin(['t1'], [], COLS)).toBe('');
    const noisy = [...COLS, { tableId: 'tX', physicalName: 'ID_CLIENTE' }];
    expect(inferNameJoin(['t1', 't2'], [], noisy)).toBe('t1.ID_CLIENTE = t2.ID_CLIENTE');
  });
});
