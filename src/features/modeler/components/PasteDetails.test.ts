// El detalle del pegado sin DOM (hooks simulados: ver
// features/reporting/components/fakeReact.testutil): 10 columnas por página con
// «cargar más», buscador «contiene», selector Lógico | Físico y checks por grupo.
import { describe, expect, it, vi } from 'vitest';
import { byText, fake, resetFake, textOf, walk, type El } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
import type { CanonicalColumn } from '@/services/governance.service';
import { ALL_COPY, reviewPaste, type PasteTarget } from '../lib/pasteReview';
import PasteDetails, { PASTE_PAGE, PasteChecks, visibleColumns } from './PasteDetails';

const TARGET: PasteTarget = {
  udpDefs: [{ id: 'u', name: 'Particion', level: 'column', view: 'physical', dataType: 'list', allowedValues: [] }],
  domains: [], themes: [], schemas: [], naming: null,
};
const cols: CanonicalColumn[] = Array.from({ length: 25 }, (_, i) => ({
  id: `c${i}`, tableId: 't', physicalName: `COL_${i}`, logicalName: `Atributo ${i}`, dataType: 'STRING',
  typeOverridden: false, ordinal: i, ...(i === 3 ? { udpValues: { u: 'Si' } } : {}),
}));
const review = reviewPaste({ cols, source: TARGET, target: TARGET, sameProject: true, options: ALL_COPY });
const items = (tree: unknown) => [...walk(tree)].filter((e) => String(e.props.className ?? '').startsWith('wk-paste-item'));

function render(states: { q?: string; shown?: number } = {}, facet: 'logical' | 'physical' = 'physical') {
  const onOptions = vi.fn();
  resetFake((init, i) => (i === 0 && states.q !== undefined ? states.q : i === 1 && states.shown !== undefined ? states.shown : init));
  const tree = PasteDetails({ review, options: ALL_COPY, onOptions, facet, onFacet: vi.fn() });
  return { tree, onOptions };
}

describe('visibleColumns', () => {
  it('busca «contiene» en el lógico o el físico, sin mayúsculas, y corta en la página', () => {
    expect(visibleColumns(review.columns, '', PASTE_PAGE)).toMatchObject({ matched: 25 });
    expect(visibleColumns(review.columns, '', PASTE_PAGE).rows).toHaveLength(10);
    expect(visibleColumns(review.columns, 'col_1', 50).rows.map((r) => r.physicalName))
      .toEqual(['COL_1', 'COL_10', 'COL_11', 'COL_12', 'COL_13', 'COL_14', 'COL_15', 'COL_16', 'COL_17', 'COL_18', 'COL_19']);
    expect(visibleColumns(review.columns, 'ATRIBUTO 2', 50).matched).toBe(6);   // 2 y 20–24
  });
});

describe('PasteDetails', () => {
  it('muestra 10 columnas y «cargar más» suma 10', () => {
    const { tree } = render();
    expect(items(tree)).toHaveLength(10);
    const more = byText(tree, 'button', 'Load 10 more');
    expect(textOf(more)).toBe('Load 10 more · 10 of 25');
    (more.props.onClick as () => void)();
    expect(fake.states[1].calls).toEqual([20]);
  });

  it('la última página carga solo lo que falta', () => {
    expect(textOf(byText(render({ shown: 20 }).tree, 'button', 'Load'))).toBe('Load 5 more · 20 of 25');
    expect(() => byText(render({ shown: 30 }).tree, 'button', 'Load')).toThrow();
  });

  it('el buscador filtra, vuelve a la primera página y Enter no hace nada (no pega)', () => {
    const { tree } = render({ q: 'atributo 2' });
    expect(items(tree)).toHaveLength(6);
    const input = [...walk(tree)].find((e: El) => e.type === 'input' && e.props['aria-label'] === 'Search columns')!;
    expect(input.props.onKeyDown).toBeUndefined();
    (input.props.onChange as (e: unknown) => void)({ target: { value: 'col' } });
    expect(fake.states[0].calls).toEqual(['col']);
    expect(fake.states[1].calls).toEqual([PASTE_PAGE]);
  });

  it('el selector de faceta cambia los nombres de la lista', () => {
    expect(textOf(items(render({}, 'logical').tree)[0])).toContain('Atributo 0');
    expect(textOf(items(render({}, 'physical').tree)[0])).toContain('COL_0');
  });

  it('las filas reflejan los checks: sin UDPs físicos, la columna no muestra su UDP', () => {
    const off = reviewPaste({ cols, source: TARGET, target: TARGET, sameProject: true, options: { ...ALL_COPY, physicalUdps: false } });
    resetFake();
    const tree = PasteDetails({ review: off, options: { ...ALL_COPY, physicalUdps: false }, onOptions: vi.fn(), facet: 'physical', onFacet: vi.fn() });
    expect(textOf(items(tree)[3])).not.toContain('UDP');
    expect(textOf(items(render().tree)[3])).toContain('1 UDP');
  });

  it('una fila omitida (pegar columnas) no muestra lo que no viaja', () => {
    const skipped = reviewPaste({ cols, source: TARGET, target: TARGET, sameProject: true, options: ALL_COPY, skip: new Set(['c3']) });
    resetFake();
    const tree = PasteDetails({ review: skipped, options: ALL_COPY, onOptions: vi.fn(), facet: 'physical', onFacet: vi.fn() });
    expect(String(items(tree)[3].props.className)).toContain('blocked');
    expect(textOf(items(tree)[3])).not.toContain('UDP');
  });

  it('una tabla sin columnas dice «No columns.»', () => {
    const empty = reviewPaste({ cols: [], source: TARGET, target: TARGET, sameProject: true, options: ALL_COPY });
    resetFake();
    const tree = PasteDetails({ review: empty, options: ALL_COPY, onOptions: vi.fn(), facet: 'physical', onFacet: vi.fn() });
    expect([...walk(tree)].some((e) => e.props.className === 'wk-paste-empty' && textOf(e) === 'No columns.')).toBe(true);
  });

  it('los checks son por grupo y avisan el cambio', () => {
    const { tree, onOptions } = render();
    const logical = [...walk(tree)].find((e) => String(e.props.label ?? '').startsWith('Logical UDPs'))!;
    expect(logical.props.label).toBe('Logical UDPs (0)');
    expect([...walk(tree)].find((e) => String(e.props.label ?? '').startsWith('Physical UDPs'))!.props.label).toBe('Physical UDPs (1)');
    (logical.props.onChange as (v: boolean) => void)(false);
    expect(onOptions).toHaveBeenCalledWith({ ...ALL_COPY, logicalUdps: false });
  });
});

// Pegar un grupo (doc 134 §3.7): los checks van una sola vez arriba
// (`PasteChecks`) y el detalle de cada tabla, sin ellos.
describe('checks del pegado', () => {
  it('PasteDetails sin checks no los dibuja', () => {
    resetFake();
    const tree = PasteDetails({ review, options: ALL_COPY, onOptions: vi.fn(), facet: 'physical', onFacet: vi.fn(), checks: false });
    expect([...walk(tree)].some((e) => e.props.className === 'wk-paste-checks')).toBe(false);
  });
  it('PasteChecks: los tres checks con sus conteos y cada uno cambia su opción', () => {
    const onOptions = vi.fn();
    const tree = PasteChecks({ counts: { logicalUdps: 2, physicalUdps: 5, domains: 1 }, options: ALL_COPY, onOptions });
    const inputs = [...walk(tree)].filter((e) => e.type === 'Check' || (typeof e.type === 'function' && (e.type as { name?: string }).name === 'Check'));
    expect(inputs.map((e) => e.props.label)).toEqual(['Logical UDPs (2)', 'Physical UDPs (5)', 'Parent domains (1)']);
    (inputs[1].props.onChange as (v: boolean) => void)(false);
    expect(onOptions).toHaveBeenCalledWith({ ...ALL_COPY, physicalUdps: false });
    expect(textOf(tree)).toContain('Relationships and views are not.');
  });
});
