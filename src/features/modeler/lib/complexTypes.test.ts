import { describe, expect, it } from 'vitest';
import { collapseComplexType, isComplexType } from './complexTypes';

describe('collapseComplexType (F4 #6 — colapso visual en el canvas)', () => {
  it('deja los tipos simples tal cual', () => {
    expect(collapseComplexType('string')).toBe('string');
    expect(collapseComplexType('DECIMAL(38,18)')).toBe('DECIMAL(38,18)');
  });

  it('colapsa STRUCT/ARRAY/MAP a su cabecera + <…>', () => {
    expect(collapseComplexType('STRUCT<nombre:STRING,edad:INT>')).toBe('STRUCT<…>');
    expect(collapseComplexType('ARRAY<STRUCT<a:INT>>')).toBe('ARRAY<…>');
    expect(collapseComplexType('MAP<STRING,STRING>')).toBe('MAP<…>');
  });

  it('normaliza la cabecera a mayúsculas y tolera espacios', () => {
    expect(collapseComplexType('  struct <a:int> ')).toBe('STRUCT<…>');
  });

  it('tolera string vacío', () => {
    expect(collapseComplexType('')).toBe('');
  });
});

describe('isComplexType', () => {
  it('detecta tipo complejo por presencia de <', () => {
    expect(isComplexType('MAP<STRING,INT>')).toBe(true);
    expect(isComplexType('varchar')).toBe(false);
  });
});

describe('ViewNode — tipo largo colapsado + flag de tooltip (A3, F4 #6)', () => {
  // El seam que reusa ViewNode (igual que TableNode): un tipo complejo largo
  // (STRUCT origen o castType) se acorta para la fila Y se marca para el
  // `title` con el tipo completo — el nodo nunca muestra el string crudo.
  it('un STRUCT largo se colapsa Y queda flaggeado para el tooltip', () => {
    const t = 'STRUCT<nombre:STRING,edad:INT,direccion:STRUCT<calle:STRING,ciudad:STRING>>';
    expect(collapseComplexType(t)).toBe('STRUCT<…>');
    expect(collapseComplexType(t).length).toBeLessThan(t.length);
    expect(isComplexType(t)).toBe(true);
  });

  it('un tipo simple no se toca ni pide tooltip', () => {
    expect(collapseComplexType('DECIMAL(38,18)')).toBe('DECIMAL(38,18)');
    expect(isComplexType('DECIMAL(38,18)')).toBe(false);
  });
});
