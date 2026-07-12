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
