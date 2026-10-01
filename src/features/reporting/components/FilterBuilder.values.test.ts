// Editor de valor de una condición `between` (doc 105, revisión ronda 4), con
// los hooks de mentira (ValueEditor usa useState/useEffect): cada entrada arma
// el par [desde, hasta] — con una sola entrada el backend respondía siempre 400.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Condition, FieldDef, WhereGroup } from '../query.service';
import { resetFake, walk } from './fakeReact.testutil';

vi.mock('react', async (orig) => (await import('./fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('../query.service', async (orig) => ({ ...(await orig<object>()), getFacets: vi.fn(async () => []) }));
import FilterBuilder from './FilterBuilder';

const NUM: FieldDef = {
  key: 'ordinal', label: 'Ordinal', type: 'number', ops: ['eq', 'between'], sortable: true, groupable: false,
  indexed: true, enumValues: null, udp: false, hydrated: false,
};
/** Las dos entradas del `between` de la primera condición, con su onChange real. */
function betweenInputs(cond: Condition, onChange = vi.fn()) {
  resetFake();
  const tree = FilterBuilder({ projectId: 'p1', group: { op: 'and', conditions: [cond] }, catalog: [NUM], from: 'columns', onChange });
  const rowEl = [...walk(tree)].find((e) => typeof e.type === 'function' && 'cond' in e.props)!;
  const row = (rowEl.type as (p: unknown) => unknown)(rowEl.props);
  const editorEl = [...walk(row)].find((e) => typeof e.type === 'function' && 'fd' in e.props)!;
  const editor = (editorEl.type as (p: unknown) => unknown)(editorEl.props);
  const inputs = [...walk(editor)].filter((e) => e.type === 'input');
  return { inputs, onChange };
}
const type = (el: { props: Record<string, unknown> }, value: string) => (el.props.onChange as (e: unknown) => void)({ target: { value } });
const sent = (onChange: ReturnType<typeof vi.fn>) => (onChange.mock.calls.at(-1)![0] as WhereGroup).conditions[0] as Condition;

beforeEach(() => { vi.clearAllMocks(); });

describe('between: cada entrada arma [desde, hasta]', () => {
  it('«from» y «to» cambian su punta del par', () => {
    let { inputs, onChange } = betweenInputs({ field: 'ordinal', op: 'between', value: ['1', ''] });
    expect(inputs.map((i) => i.props['aria-label'])).toEqual(['From', 'To']);
    type(inputs[1], '9');
    expect(sent(onChange)).toEqual({ field: 'ordinal', op: 'between', value: ['1', '9'] });

    ({ inputs, onChange } = betweenInputs({ field: 'ordinal', op: 'between' }));
    type(inputs[0], '3');
    expect(sent(onChange).value).toEqual(['3', '']);
  });
});
