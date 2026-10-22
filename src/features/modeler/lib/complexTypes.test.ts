import { describe, expect, it } from 'vitest';
import {
  collapseComplexType,
  composeComplexType,
  hasComplexContent,
  isComplexType,
  isComplexTypeStart,
  parseComplexType,
} from './complexTypes';

describe('collapseComplexType (colapso visual en el canvas)', () => {
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

describe('ViewNode — tipo largo colapsado + flag de tooltip', () => {
  // El seam que reusa ViewNode (igual que TableNode): un tipo complejo largo
  // (STRUCT origen o castType) se acorta para la fila y se marca para el
  // `title` con el tipo completo; el nodo nunca muestra el string crudo.
  it('un STRUCT largo se colapsa y queda marcado para el tooltip', () => {
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

describe('parseComplexType / composeComplexType (ComplexTypeBuilder)', () => {
  it('STRUCT: campos nombre:tipo, con anidados y DECIMAL(p,s) intactos', () => {
    const spec = parseComplexType('STRUCT<cod:INT,mto:DECIMAL(18,2),dir:STRUCT<calle:STRING>>');
    expect(spec).toEqual({
      kind: 'struct',
      fields: [
        { name: 'cod', type: 'INT' },
        { name: 'mto', type: 'DECIMAL(18,2)' },
        { name: 'dir', type: 'STRUCT<calle:STRING>' },
      ],
    });
  });

  it('ARRAY y MAP (la coma del MAP no corta el STRUCT anidado)', () => {
    expect(parseComplexType('ARRAY<STRUCT<a:INT,b:STRING>>'))
      .toEqual({ kind: 'array', element: 'STRUCT<a:INT,b:STRING>' });
    expect(parseComplexType('MAP<STRING,STRUCT<a:INT,b:INT>>'))
      .toEqual({ kind: 'map', key: 'STRING', value: 'STRUCT<a:INT,b:INT>' });
  });

  it('plantillas recién iniciadas (interior vacío) son editables', () => {
    expect(parseComplexType('STRUCT<>')).toEqual({ kind: 'struct', fields: [] });
    expect(parseComplexType('ARRAY<>')).toEqual({ kind: 'array', element: '' });
    expect(parseComplexType('MAP<>')).toEqual({ kind: 'map', key: '', value: '' });
  });

  it('rechaza lo que no es complejo bien formado', () => {
    expect(parseComplexType('VARCHAR(30)')).toBeNull();
    expect(parseComplexType('STRUCT<a:INT')).toBeNull();       // sin cierre
    expect(parseComplexType('STRUCT<a:INT>>')).toBeNull();     // desbalanceado
    expect(parseComplexType('MAP<STRING>')).toBeNull();        // MAP necesita 2 partes
  });

  it('round-trip estable: compose(parse(x)) == x canónico', () => {
    const canon = 'STRUCT<cod:INT,det:ARRAY<STRUCT<k:STRING,v:DECIMAL(18,2)>>>';
    const spec = parseComplexType(canon);
    expect(spec && composeComplexType(spec)).toBe(canon);
  });

  it('isComplexTypeStart decide cuándo mostrar el builder', () => {
    expect(isComplexTypeStart('STRUCT<>')).toBe(true);
    expect(isComplexTypeStart('  array <int>')).toBe(true);
    expect(isComplexTypeStart('VARCHAR(30)')).toBe(false);
    expect(isComplexTypeStart('FOO<bar>')).toBe(false);
  });
});

describe('hasComplexContent', () => {
  it('complejo con estructura vs genérico vacío', () => {
    expect(hasComplexContent('ARRAY<STRUCT<a:VARCHAR(30)>>')).toBe(true);
    expect(hasComplexContent('ARRAY<>')).toBe(false);
    expect(hasComplexContent('CHAR(18)')).toBe(false);
  });
});
