// Menú de clic derecho del canvas: en una fila (las columnas seleccionadas) o en
// la tabla. Copy es lectura y vale siempre; Paste se ve siempre y, sin nada
// copiado o sin edición, queda deshabilitado con el motivo; quitar y borrar
// exigen edición. Los textos van con los sustantivos de la faceta.
import { describe, expect, it } from 'vitest';
import { facetNouns } from '@/lib/facets';
import { GROUP_MAX, canvasMenuItems, type CanvasMenuItem } from './canvasMenu';

const keys = { copy: '⌘C', paste: '⌘V' };
const physical = facetNouns('physical');
const logical = facetNouns('logical');
const shown = (items: CanvasMenuItem[]) => items.map((x) => [x.label, x.enabled]);

describe('menú de una fila', () => {
  it('en edición sin nada copiado: Copy · Paste deshabilitado · Delete', () => {
    const items = canvasMenuItems({ target: 'row', selCount: 1, clipboard: { kind: 'none' }, canEdit: true, nouns: physical, keys });
    expect(shown(items)).toEqual([['Copy column', true], ['Paste', false], ['Delete column…', true]]);
    expect(items.map((x) => x.action)).toEqual(['copy-columns', 'paste', 'delete-columns']);
    expect(items[1].hint).toBe('Nothing copied');
    expect(items[2]).toMatchObject({ danger: true, separatorBefore: true, hint: undefined });
    expect(items.map((x) => x.shortcut)).toEqual(['⌘C', '⌘V', undefined]);
  });

  it('con 3 seleccionadas y 2 columnas copiadas', () => {
    expect(shown(canvasMenuItems({ target: 'row', selCount: 3, clipboard: { kind: 'columns', count: 2 }, canEdit: true, nouns: physical, keys })))
      .toEqual([['Copy 3 columns', true], ['Paste 2 columns', true], ['Delete 3 columns…', true]]);
    expect(canvasMenuItems({ target: 'row', selCount: 1, clipboard: { kind: 'columns', count: 1 }, canEdit: true, nouns: physical, keys })[1].label)
      .toBe('Paste 1 column');
  });

  it('con una tabla copiada, Paste la pega (también desde una fila)', () => {
    const paste = canvasMenuItems({ target: 'row', selCount: 1, clipboard: { kind: 'table', name: 'CLIENTE' }, canEdit: true, nouns: physical, keys })[1];
    expect(paste).toMatchObject({ action: 'paste', label: 'Paste table CLIENTE…', enabled: true, hint: undefined });
  });

  it('solo lectura: Copy sí; Paste y Delete deshabilitados con el motivo', () => {
    const items = canvasMenuItems({ target: 'row', selCount: 2, clipboard: { kind: 'columns', count: 2 }, canEdit: false, nouns: physical, keys });
    expect(shown(items)).toEqual([['Copy 2 columns', true], ['Paste 2 columns', false], ['Delete 2 columns…', false]]);
    expect(items[1].hint).toBe('Open the model in edit mode to paste');
    expect(items[2].hint).toBe('Open the model in edit mode to delete');
  });
});

describe('menú de la tabla', () => {
  it('en edición: Copy table · Paste · Remove from this canvas · Delete table…', () => {
    const items = canvasMenuItems({ target: 'table', selCount: 0, clipboard: { kind: 'none' }, canEdit: true, nouns: physical, keys });
    expect(shown(items)).toEqual([['Copy table', true], ['Paste', false], ['Remove from this canvas', true], ['Delete table…', true]]);
    expect(items.map((x) => x.action)).toEqual(['copy-table', 'paste', 'remove-table', 'delete-table']);
    expect(items.map((x) => !!x.separatorBefore)).toEqual([false, false, true, false]);
    expect(items.map((x) => !!x.danger)).toEqual([false, false, false, true]);
  });

  it('solo lectura: Copy table sí; el resto deshabilitado con el motivo', () => {
    const items = canvasMenuItems({ target: 'table', selCount: 0, clipboard: { kind: 'table', name: 'CLIENTE' }, canEdit: false, nouns: physical, keys });
    expect(shown(items)).toEqual([['Copy table', true], ['Paste table CLIENTE…', false], ['Remove from this canvas', false], ['Delete table…', false]]);
    expect(items.slice(1).map((x) => x.hint)).toEqual([
      'Open the model in edit mode to paste', 'Open the model in edit mode to change this canvas', 'Open the model in edit mode to delete',
    ]);
  });
});

describe('en el modelo lógico', () => {
  it('entity / attribute', () => {
    expect(shown(canvasMenuItems({ target: 'row', selCount: 2, clipboard: { kind: 'columns', count: 1 }, canEdit: true, nouns: logical, keys })))
      .toEqual([['Copy 2 attributes', true], ['Paste 1 attribute', true], ['Delete 2 attributes…', true]]);
    expect(shown(canvasMenuItems({ target: 'table', selCount: 0, clipboard: { kind: 'table', name: 'Cliente' }, canEdit: true, nouns: logical, keys })))
      .toEqual([['Copy entity', true], ['Paste entity Cliente…', true], ['Remove from this canvas', true], ['Delete entity…', true]]);
  });
});

// Menú de un grupo de tablas (doc 134 §3.5): Copy · Paste · Remove · Delete de N,
// con el tope de GROUP_MAX para copiar y borrar; un grupo copiado en otro
// proyecto no se pega aquí.
describe('menú de un grupo de tablas', () => {
  it('en edición: Copy N · Paste · Remove N from this canvas · Delete N…', () => {
    const items = canvasMenuItems({ target: 'group', selCount: 0, groupCount: 5, clipboard: { kind: 'none' }, canEdit: true, nouns: physical, keys });
    expect(shown(items)).toEqual([['Copy 5 tables', true], ['Paste', false], ['Remove 5 tables from this canvas', true], ['Delete 5 tables…', true]]);
    expect(items.map((x) => x.action)).toEqual(['copy-tables', 'paste', 'remove-tables', 'delete-tables']);
    expect(items.map((x) => !!x.separatorBefore)).toEqual([false, false, true, false]);
    expect(items.map((x) => !!x.danger)).toEqual([false, false, false, true]);
    expect(items[0].shortcut).toBe('⌘C');
  });

  it('en el modelo lógico, con sus sustantivos', () => {
    expect(shown(canvasMenuItems({ target: 'group', selCount: 0, groupCount: 2, clipboard: { kind: 'none' }, canEdit: true, nouns: logical, keys })))
      .toEqual([['Copy 2 entities', true], ['Paste', false], ['Remove 2 entities from this canvas', true], ['Delete 2 entities…', true]]);
  });

  it('solo lectura: copiar sí; quitar y borrar no', () => {
    const items = canvasMenuItems({ target: 'group', selCount: 0, groupCount: 2, clipboard: { kind: 'none' }, canEdit: false, nouns: physical, keys });
    expect(shown(items)).toEqual([['Copy 2 tables', true], ['Paste', false], ['Remove 2 tables from this canvas', false], ['Delete 2 tables…', false]]);
  });

  it(`${GROUP_MAX} justas todavía se copian y se borran`, () => {
    const items = canvasMenuItems({ target: 'group', selCount: 0, groupCount: GROUP_MAX, clipboard: { kind: 'none' }, canEdit: true, nouns: physical, keys });
    expect(items.map((x) => x.enabled)).toEqual([true, false, true, true]);
  });

  it(`más de ${GROUP_MAX}: copiar y borrar en gris con el motivo; quitar del canvas sigue`, () => {
    const items = canvasMenuItems({ target: 'group', selCount: 0, groupCount: GROUP_MAX + 1, clipboard: { kind: 'none' }, canEdit: true, nouns: physical, keys });
    expect(items.map((x) => x.enabled)).toEqual([false, false, true, false]);
    expect(items[0].hint).toBe(`Select up to ${GROUP_MAX} tables at a time`);
    expect(items[3].hint).toBe(`Select up to ${GROUP_MAX} tables at a time`);
  });

  it('con un grupo copiado, Paste dice cuántas; de otro proyecto, en gris con el motivo', () => {
    const here = canvasMenuItems({ target: 'table', selCount: 0, clipboard: { kind: 'tables', count: 3, foreign: false }, canEdit: true, nouns: physical, keys })[1];
    expect(here).toMatchObject({ label: 'Paste 3 tables…', enabled: true, hint: undefined });
    const away = canvasMenuItems({ target: 'group', selCount: 0, groupCount: 2, clipboard: { kind: 'tables', count: 3, foreign: true }, canEdit: true, nouns: physical, keys })[1];
    expect(away).toMatchObject({ label: 'Paste 3 tables…', enabled: false,
      hint: 'A group of tables can only be pasted in its own project. Across projects, paste one table at a time.' });
  });
});
