// Lógica pura del ViewEditor multi-fuente: claves de grilla, serialización de
// sources y el cuerpo del guardado — la estructura manda y la User-Defined SQL
// viaja como texto informativo.
import { describe, expect, it } from 'vitest';
import { colKey, duplicateOutputNames, splitColKey, serializeSources, viewSaveBody, type ColCfg } from './viewEditorLogic';

describe('viewEditorLogic — grilla multi-fuente', () => {
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

  it('serializa solo columnas incluidas y válidas, en orden, con tableId', () => {
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

  it('description: se serializa con texto, se omite si vacía/whitespace', () => {
    const out = serializeSources(order, cfg, valid);
    expect(out[0].description).toBe('Business key');   // t1::ID
    expect(out[2].description).toBeUndefined();          // t2::SALDO = '  ' → trim → undefined
  });
});

describe('viewSaveBody', () => {
  const base = { name: ' V ', schema: '', sourceIds: ['t1', 't2'], sources: [{ column: 'ID', tableId: 't1' }],
    showOnCanvas: true, sql: 'CREATE VIEW …', description: '  ', sqlText: '', udpValues: { u: 'x' } };
  it('las columnas vienen del builder aunque haya query personalizada', () => {
    const b = viewSaveBody({ ...base, sqlText: '  SELECT * FROM a JOIN b  ' });
    expect(b.sources).toEqual(base.sources);
    expect(b.customSql).toBe('SELECT * FROM a JOIN b');
    expect(b).toMatchObject({ name: 'V', schema: undefined, tableId: 't1', sourceTableIds: ['t1', 't2'], description: undefined, udpValues: { u: 'x' } });
  });
  it('query vacía ⇒ se quita', () => {
    expect(viewSaveBody(base).customSql).toBeUndefined();
  });
});

describe('duplicateOutputNames (el DDL sería inválido con alias repetidos)', () => {
  it('la misma columna de dos fuentes sin alias se repite', () => {
    expect(duplicateOutputNames([{ column: 'CODMES', tableId: 't1' }, { column: 'CODMES', tableId: 't2' }])).toEqual(['CODMES']);
  });
  it('un alias lo resuelve; la comparación no distingue mayúsculas', () => {
    expect(duplicateOutputNames([{ column: 'CODMES', tableId: 't1' }, { column: 'CODMES', tableId: 't2', outputAlias: 'CODMES_CTA' }])).toEqual([]);
    expect(duplicateOutputNames([{ column: 'Codmes', tableId: 't1' }, { column: 'X', tableId: 't2', outputAlias: 'CODMES' }])).toEqual(['Codmes']);
  });
  it('las expresiones sin alias no cuentan (su alias va dentro del texto)', () => {
    expect(duplicateOutputNames([{ expression: 'UPPER(t1.A) AS A' }, { expression: 'UPPER(t2.A) AS A' }])).toEqual([]);
  });
});
