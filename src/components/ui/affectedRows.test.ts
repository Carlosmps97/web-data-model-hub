import { describe, expect, it } from 'vitest';
import { countLabel, filterRows, invisibleChars, mergePage, showInvisible } from './affectedRows';

describe('mergePage (final review #9: paginado del servidor)', () => {
  it('la primera página reemplaza; la siguiente se agrega donde termina lo cargado', () => {
    expect(mergePage(['x'], ['a', 'b'], 0)).toEqual(['a', 'b']);
    expect(mergePage(['a', 'b'], ['c', 'd'], 2)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('una respuesta repetida del mismo offset no duplica filas (dos scrolls antes del re-render)', () => {
    const once = mergePage(['a', 'b'], ['c', 'd'], 2);
    expect(mergePage(once, ['c', 'd'], 2)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('una página fuera de orden se descarta', () => {
    expect(mergePage(['a', 'b'], ['z'], 5)).toEqual(['a', 'b']);
  });
});

describe('caracteres invisibles (doc 95 D3/D4)', () => {
  it('marca el U+00A0 del final para que se vea', () => {
    expect(showInvisible('HM_JERARQUIAFUNCIONALCRE\u00a0')).toBe('HM_JERARQUIAFUNCIONALCRE⍽');
    expect(showInvisible('SIN_RAROS')).toBe('SIN_RAROS');
    expect(showInvisible(null)).toBe('');
  });
  it('nombra cada invisible una sola vez', () => {
    expect(invisibleChars('A\u00a0B\u00a0\u200b')).toEqual(['U+00A0 no-break space', 'U+200B zero-width space']);
    expect(invisibleChars('NORMAL')).toEqual([]);
  });
});

describe('filterRows', () => {
  const rows = [{ t: 'CLIENTE', c: 'CODCLI' }, { t: 'Aplicación', c: 'CODAPP' }];
  it('busca «contiene» sin mayúsculas ni tildes en los campos dados', () => {
    expect(filterRows(rows, 'aplicacion', (r) => [r.t, r.c])).toEqual([rows[1]]);
    expect(filterRows(rows, 'cod', (r) => [r.c])).toEqual(rows);
    expect(filterRows(rows, '  ', (r) => [r.t])).toBe(rows);
  });
});

describe('countLabel', () => {
  it('dice cuántas se ven de cuántas', () => {
    expect(countLabel(200, 17756)).toBe('Showing 200 of 17,756');
    expect(countLabel(19, 19)).toBe('19 rows');
    expect(countLabel(1, 1)).toBe('1 row');
  });
});
