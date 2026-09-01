// Doc 64 r2 — espejo front de `canonicalize_default_type` (back, doc 62):
// homologa el `defaultDataType` de un parent domain a la grafía canónica al
// CONSUMIRLO (la BD puede traer dominios legacy sin homologar).
import { describe, expect, it } from 'vitest';
import { canonicalDefaultType } from './typePick';

describe('canonicalDefaultType (doc 64 r2 — espejo del back doc 62)', () => {
  it('ARRAY/MAP/STRUCT "pelados" (o con <> vacío) → X<> — abre el builder', () => {
    expect(canonicalDefaultType('Array')).toBe('ARRAY<>');
    expect(canonicalDefaultType('map <>')).toBe('MAP<>');
    expect(canonicalDefaultType('STRUCT')).toBe('STRUCT<>');
  });

  it('simples del catálogo: case/espacios normalizados, argumentos compactos', () => {
    expect(canonicalDefaultType('decimal (22,4)')).toBe('DECIMAL(22,4)');
    expect(canonicalDefaultType('varchar2(10)')).toBe('VARCHAR2(10)');
    expect(canonicalDefaultType('string')).toBe('STRING');
    expect(canonicalDefaultType('  timestamp ')).toBe('TIMESTAMP');
  });

  it('sinónimos de dialecto → base del catálogo', () => {
    expect(canonicalDefaultType('BIG INTEGER')).toBe('BIGINT');
    expect(canonicalDefaultType('int')).toBe('INTEGER');
    expect(canonicalDefaultType('bool')).toBe('BOOLEAN');
    expect(canonicalDefaultType('double precision')).toBe('DOUBLE');
  });

  it('complejos con contenido: recompone canónico (interior del catálogo)', () => {
    expect(canonicalDefaultType('ARRAY< string >')).toBe('ARRAY<STRING>');
    expect(canonicalDefaultType('map<STRING, decimal(18,2)>')).toBe('MAP<STRING,DECIMAL(18,2)>');
    expect(canonicalDefaultType('struct<a: integer, b: varchar(5)>')).toBe('STRUCT<a:INTEGER,b:VARCHAR(5)>');
  });

  it('complejo con interior NO reconocible → verbatim entero (espejo exacto: sin aliases adentro)', () => {
    expect(canonicalDefaultType('ARRAY<int>')).toBe('ARRAY<int>');
    expect(canonicalDefaultType('STRUCT<a:INT')).toBe('STRUCT<a:INT');   // desbalanceado
  });

  it('lo canónico pasa intacto; lo desconocido queda VERBATIM; vacío → vacío', () => {
    expect(canonicalDefaultType('ARRAY<>')).toBe('ARRAY<>');
    expect(canonicalDefaultType('DECIMAL(18,6)')).toBe('DECIMAL(18,6)');
    expect(canonicalDefaultType('FOO_BAR')).toBe('FOO_BAR');
    expect(canonicalDefaultType('')).toBe('');
    expect(canonicalDefaultType(undefined)).toBe('');
  });
});
