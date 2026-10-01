// Filtros del Builder (doc 105, revisión ronda 4). FilterBuilder y ConditionRow
// no usan hooks: se llaman como funciones y se disparan sus handlers reales; el
// markup (con el editor de valor) sale con renderToStaticMarkup.
// - Una condición booleana mostraba «true» pero viajaba SIN value → el backend
//   filtraba `{campo: null}` y salían 0 filas.
// - `between` se armaba con UNA sola entrada → siempre 400 («needs [min, max]»).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Condition, FieldDef, WhereGroup } from '../query.service';
import { byText, walk } from './fakeReact.testutil';
import FilterBuilder from './FilterBuilder';

const field = (key: string, over: Partial<FieldDef> = {}): FieldDef => ({
  key, label: key, type: 'string', ops: ['eq'], sortable: true, groupable: true, indexed: true,
  enumValues: null, udp: false, hydrated: false, ...over,
});
const BOOL = field('isPrimaryKey', { type: 'boolean', ops: ['eq', 'ne', 'exists'] });
const NUM = field('ordinal', { type: 'number', ops: ['eq', 'between', 'gt'] });
const group = (...conditions: Condition[]): WhereGroup => ({ op: 'and', conditions });
const render = (g: WhereGroup, onChange = vi.fn()) =>
  ({ tree: FilterBuilder({ projectId: 'p1', group: g, catalog: [BOOL, NUM], from: 'columns', onChange }), onChange });
/** La fila de la condición `i`, ya «renderizada» (ConditionRow es una función pura de props). */
const row = (tree: unknown, i = 0) => {
  const el = [...walk(tree)].filter((e) => typeof e.type === 'function' && 'cond' in e.props)[i];
  return (el.type as (p: unknown) => unknown)(el.props);
};
const lastCondition = (onChange: ReturnType<typeof vi.fn>) => (onChange.mock.calls.at(-1)![0] as WhereGroup).conditions[0];

describe('condición booleana: viaja el valor que muestra el combo', () => {
  it('«+ Condition» con un campo booleano nace con value true', () => {
    const { tree, onChange } = render(group());
    (byText(tree, 'button', 'Condition').props.onClick as () => void)();
    expect(lastCondition(onChange)).toEqual({ field: 'isPrimaryKey', op: 'eq', value: true });
  });

  it('cambiar a un campo booleano, o de operador en uno, también', () => {
    const { tree, onChange } = render(group({ field: 'ordinal', op: 'eq', value: '3' }));
    const [fieldSel] = [...walk(row(tree))].filter((e) => e.type === 'select');
    (fieldSel.props.onChange as (e: unknown) => void)({ target: { value: 'isPrimaryKey' } });
    expect(lastCondition(onChange)).toEqual({ field: 'isPrimaryKey', op: 'eq', value: true });

    const b = render(group({ field: 'isPrimaryKey', op: 'exists' }));
    const [, opSel] = [...walk(row(b.tree))].filter((e) => e.type === 'select');
    (opSel.props.onChange as (e: unknown) => void)({ target: { value: 'eq' } });
    expect(lastCondition(b.onChange)).toEqual({ field: 'isPrimaryKey', op: 'eq', value: true });
  });
});

describe('between: desde y hasta', () => {
  it('dos entradas con su valor y su nombre accesible', () => {
    const html = renderToStaticMarkup(
      <FilterBuilder projectId="p1" group={group({ field: 'ordinal', op: 'between', value: ['1', '9'] })}
        catalog={[BOOL, NUM]} from="columns" onChange={() => {}} />,
    );
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toContain('value="1"');
    expect(inputs[0]).toContain('aria-label="From"');
    expect(inputs[1]).toContain('value="9"');
    expect(inputs[1]).toContain('aria-label="To"');
  });
});

describe('texto del valor en inglés (doc 105, ronda 5)', () => {
  it('el campo de texto libre dice «value», no «valor»', () => {
    const TEXT = field('physicalName', { ops: ['eq'] });
    const html = renderToStaticMarkup(
      <FilterBuilder projectId="p1" group={group({ field: 'physicalName', op: 'eq', value: '' })}
        catalog={[TEXT]} from="columns" onChange={() => {}} />,
    );
    expect(html).toContain('placeholder="value"');
    expect(html).not.toContain('placeholder="valor"');
  });
});
