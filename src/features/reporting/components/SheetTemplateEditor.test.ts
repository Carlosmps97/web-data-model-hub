// Editor de plantillas (doc 95 D11) sin DOM: se llama al componente como función
// con hooks de mentira (cada setter anota lo que recibe) y se disparan los
// handlers REALES del árbol de elementos que devuelve.
//
// Doc 105 (P3): los campos hacían `setDraft({ ...draft, X })` con el `draft` del
// ÚLTIMO render. Tras «New template» / «Duplicate» / elegir otra plantilla, el
// reinicio del borrador llegaba por un efecto (una actualización posterior): una
// tecla en esa ventana (CPU lenta) se encolaba DESPUÉS del reinicio como VALOR
// completo — revivía la plantilla anterior con su id y «Save changes» la pisaba.
// En la cola de React un valor reemplaza al estado y una función se aplica al
// último estado encolado: eso es lo que modela `settle`.
// Doc 105 (B6): «Next export:» se calculaba en el render del editor — los
// segundos quedaban congelados hasta la siguiente tecla.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SheetTemplate } from '../lib/sheetTemplates';
import { byText, fake, nextStates, resetFake, runEffects, textOf, unmount, walk } from './fakeReact.testutil';

vi.mock('react', async (orig) => (await import('./fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('@/features/standards/standards.service', () => ({ getUdpDefs: vi.fn(async () => []) }));
vi.mock('../sheetTemplates.service', () => ({
  createDefaultSheetTemplate: vi.fn(), createSheetTemplate: vi.fn(), deleteSheetTemplate: vi.fn(), updateSheetTemplate: vi.fn(),
}));
import SheetTemplateEditor, { NextExportName } from './SheetTemplateEditor';
import { updateSheetTemplate } from '../sheetTemplates.service';

type FilterDraft = { source: string; op: string; text: string };
type Draft = { id?: string; name: string; sheetName: string; description?: string | null; shared: boolean; fileName?: string | null; columns: { header: string; source: string }[]; filters: FilterDraft[] };
const tpl = (id: string, name: string): SheetTemplate => ({
  id, projectId: 'p1', origin: 'user', owner: 'ana', name, sheetName: `${name}_S`, description: `about ${name}`,
  shared: true, fileName: `${name}_{yyyy}`, columns: [{ header: 'TABLA', source: 'table.physicalName' }],
});
const ALFA = tpl('a', 'Alfa');
const BETA = tpl('b', 'Beta');
const draftOf = (t: SheetTemplate): Draft => ({
  id: t.id, name: t.name, sheetName: t.sheetName, description: t.description ?? '', shared: t.shared,
  fileName: t.fileName ?? '', columns: t.columns.map((c) => ({ ...c })),
  filters: (t.filters ?? []).map((f) => ({ source: f.source, op: f.op, text: f.op === 'isOneOf' ? (f.values ?? []).join(', ') : f.value ?? '' })),
});
/** Borrador vacío de «New template» (hecho a mano: no se importa del componente). */
const BLANK: Draft = { name: '', sheetName: '', description: '', shared: false, fileName: '', columns: [{ header: '', source: 'column.physicalName' }], filters: [] };
const isDraft = (v: unknown): v is Draft => !!v && typeof v === 'object' && 'columns' in v && 'sheetName' in v;

/** El <input> dentro del <label> cuyo texto empieza con `label`. */
const inputIn = (tree: unknown, label: string) => {
  const lbl = byText(tree, 'label', label);
  const input = [...walk(lbl.props.children)].find((el) => el.type === 'input');
  if (!input) throw new Error(`no input in «${label}»`);
  return input;
};

/** Renderiza el editor con el borrador `shown` en pantalla y devuelve el árbol y los setters. */
function render(shown: Draft, templates: SheetTemplate[] = [ALFA, BETA]) {
  resetFake((init) => (isDraft(init) ? shown : init));
  const tree = SheetTemplateEditor({
    projectId: 'p1', templates, me: 'ana', isAdmin: false, onClose: () => {}, onChanged: async () => {},
  });
  const draftState = fake.states.find((s) => isDraft(s.value));
  if (!draftState) throw new Error('draft state not found');
  return { tree, draftCalls: draftState.calls };
}
/** Estado final de la cola: `pending` (el reinicio que aún no se renderizó) y luego `update`. */
const settle = (pending: Draft, update: unknown): Draft =>
  (typeof update === 'function' ? (update as (d: Draft) => Draft)(pending) : update as Draft);

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { resetFake(); vi.useRealTimers(); });

describe('P3 · el borrador no revive la plantilla anterior', () => {
  it.each([
    ['Template name', { target: { value: 'x' } }, { name: 'x' }],
    ['Sheet name', { target: { value: 'x' } }, { sheetName: 'x' }],
    ['Description', { target: { value: 'x' } }, { description: 'x' }],
    ['File name', { target: { value: 'x' } }, { fileName: 'x' }],
    ['Share with everyone', { target: { checked: true } }, { shared: true }],
  ])('una tecla en «%s» con el reinicio a «New template» pendiente queda sobre el borrador nuevo', (label, event, patch) => {
    const { tree, draftCalls } = render(draftOf(ALFA));   // en pantalla aún Alfa; el reinicio no se renderizó
    (inputIn(tree, label).props.onChange as (e: unknown) => void)(event);
    expect(draftCalls).toHaveLength(1);
    const final = settle(BLANK, draftCalls[0]);
    expect(final).toEqual({ ...BLANK, ...patch });
    expect(final.id).toBeUndefined();   // sin el id de Alfa, «Create template» — no «Save changes» sobre Alfa
  });

  it('«New template» reinicia el borrador en el MISMO evento (sin ventana con Alfa en pantalla)', () => {
    const { tree, draftCalls } = render(draftOf(ALFA));
    (byText(tree, null, 'New template').props.onClick as () => void)();
    expect(draftCalls.map((u) => settle(draftOf(BETA), u))).toEqual([BLANK]);
  });

  it('«Duplicate» abre la copia en el MISMO evento', () => {
    const { tree, draftCalls } = render(draftOf(ALFA));
    (byText(tree, null, 'Duplicate').props.onClick as () => void)();
    expect(draftCalls.map((u) => settle(BLANK, u))).toEqual([{ ...draftOf(ALFA), id: undefined, name: 'Alfa (copy)', shared: false }]);
  });

  it('elegir otra plantilla de la lista la carga en el MISMO evento; la misma no pisa lo tecleado', () => {
    const { tree, draftCalls } = render(draftOf(ALFA));
    (byText(tree, 'button', 'Beta').props.onClick as () => void)();
    expect(draftCalls.map((u) => settle(BLANK, u))).toEqual([draftOf(BETA)]);

    const again = render({ ...draftOf(ALFA), name: 'Alfa editada' });
    (byText(again.tree, 'button', 'Alfa').props.onClick as () => void)();
    expect(again.draftCalls).toEqual([]);
  });
});

describe('B6 · «Next export:» con reloj propio', () => {
  it('el editor delega el nombre en <NextExportName> con el borrador en pantalla', () => {
    const shown = draftOf(ALFA);
    const { tree } = render(shown);
    const el = [...walk(tree)].find((e) => e.type === NextExportName);
    expect(el?.props.draft).toBe(shown);
  });

  it('avanza cada segundo y suelta el intervalo al desmontar', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 15, 30, 45));
    resetFake();
    const draft = { name: 'QA', fileName: 'QA_{HH}{mm}{ss}' };
    expect(textOf(NextExportName({ draft }))).toBe('QA_153045.xlsx');
    runEffects();
    vi.advanceTimersByTime(2000);
    expect((fake.states[0].calls as Date[]).map((d) => d.getSeconds())).toEqual([46, 47]);

    const next = nextStates();
    resetFake((_init, i) => next[i], { keepRefs: true });   // re-render del MISMO montaje con la hora nueva
    expect(textOf(NextExportName({ draft }))).toBe('QA_153047.xlsx');

    unmount();
    vi.advanceTimersByTime(5000);
    // Revisión R6: el intervalo soltado no anota nada — ni en el render vigente
    // ni como setter de otro montaje (antes una re-montada tragaba esos ticks).
    expect(fake.states[0].calls).toEqual([]);
    expect(fake.stale).toEqual([]);
  });
});

describe('filtros de la plantilla', () => {
  /** El <select> o <input> con ese aria-label. */
  const byLabel = (tree: unknown, label: string) => {
    const el = [...walk(tree)].find((e) => e.props?.['aria-label'] === label);
    if (!el) throw new Error(`no element «${label}»`);
    return el;
  };

  it('«Add filter» suma un filtro vacío sobre el ÚLTIMO borrador', () => {
    const { tree, draftCalls } = render(draftOf(ALFA));
    const button = [...walk(tree)].find((e) => textOf(e) === 'Add filter' && typeof e.props.onClick === 'function');
    (button?.props.onClick as () => void)();
    expect(settle(draftOf(ALFA), draftCalls[0]).filters).toEqual([{ source: 'column.physicalName', op: 'contains', text: '' }]);
  });

  it('elegir una bandera como dato deja «is marked»; volver a un dato de texto conserva «is not empty»', () => {
    const shown = { ...draftOf(ALFA), filters: [{ source: 'column.dataType', op: 'contains', text: 'X' }] };
    const { tree, draftCalls } = render(shown);
    (byLabel(tree, 'Filter data 1').props.onChange as (e: unknown) => void)({ target: { value: 'column.isPrimaryKey' } });
    const flagged = settle(shown, draftCalls[0]);
    expect(flagged.filters).toEqual([{ source: 'column.isPrimaryKey', op: 'isNotEmpty', text: 'X' }]);
    const back = render(flagged);
    (byLabel(back.tree, 'Filter data 1').props.onChange as (e: unknown) => void)({ target: { value: 'column.dataType' } });
    expect(settle(flagged, back.draftCalls[0]).filters[0].op).toBe('isNotEmpty');
  });

  it('una bandera no muestra caja de valor; «is one of» pide valores separados por comas', () => {
    const { tree } = render({ ...draftOf(ALFA), filters: [
      { source: 'column.isPrimaryKey', op: 'isNotEmpty', text: '' },
      { source: 'column.dataType', op: 'isOneOf', text: 'STRING' }] });
    expect([...walk(tree)].some((e) => e.props?.['aria-label'] === 'Filter value 1')).toBe(false);
    expect(byLabel(tree, 'Filter value 2').props.placeholder).toBe('e.g. STRING, VARCHAR');
  });

  it('un operador que no es de la lista del dato (guardado por API) se muestra tal cual, con su caja de valor', () => {
    const { tree } = render({ ...draftOf(ALFA), filters: [{ source: 'column.isPrimaryKey', op: 'is', text: 'X' }] });
    const select = byLabel(tree, 'Filter operator 1');
    const options = [...walk(select.props.children)].filter((e) => e.type === 'option').map((o) => o.props.value);
    expect(select.props.value).toBe('is');
    expect(options).toContain('is');
    expect(byLabel(tree, 'Filter value 1').props.value).toBe('X');
    // …con la etiqueta legible del operador, no su valor interno.
    const other = render({ ...draftOf(ALFA), filters: [{ source: 'column.isPrimaryKey', op: 'isNot', text: 'X' }] }).tree;
    const labels = [...walk(byLabel(other, 'Filter operator 1').props.children)].filter((e) => e.type === 'option')
      .map((o) => [o.props.value, o.props.children]);
    expect(labels).toEqual([['isNotEmpty', 'is marked'], ['isEmpty', 'is not marked'], ['isNot', 'is not']]);
  });

  it('guardar manda los filtros con la forma del backend', async () => {
    const shown = { ...draftOf(ALFA), filters: [
      { source: 'column.dataType', op: 'isOneOf', text: 'STRING, VARCHAR,' },
      { source: 'column.isPrimaryKey', op: 'isNotEmpty', text: '' },
      { source: 'table.schema', op: 'startsWith', text: ' ddv_ ' }] };
    const { tree } = render(shown);
    await (byText(tree, null, 'Save changes').props.onClick as () => Promise<void>)();
    expect(vi.mocked(updateSheetTemplate).mock.calls[0][2].filters).toEqual([
      { source: 'column.dataType', op: 'isOneOf', values: ['STRING', 'VARCHAR'] },
      { source: 'column.isPrimaryKey', op: 'isNotEmpty' },
      { source: 'table.schema', op: 'startsWith', value: 'ddv_' }]);
  });

  it('una plantilla guardada con filtros los abre como texto', () => {
    const conFiltros: SheetTemplate = { ...BETA, filters: [{ source: 'column.dataType', op: 'isOneOf', values: ['A', 'B'] }] };
    const { tree, draftCalls } = render(draftOf(ALFA), [ALFA, conFiltros]);
    (byText(tree, 'button', 'Beta').props.onClick as () => void)();
    expect(settle(BLANK, draftCalls[0]).filters).toEqual([{ source: 'column.dataType', op: 'isOneOf', text: 'A, B' }]);
  });
});
