// Lookups & Functions sin DOM (hooks de mentira: ver
// reporting/components/fakeReact.testutil). Doc 105: «Save changes» se
// habilitaba SIN cambios y registraba una versión vacía.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/http';
import type { DdlRulesetConfig } from '../standards.service';
import { byText, nextStates, resetFake, runEffects, textOf, walk } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../ddlRules.service', () => ({ saveDdlConfig: vi.fn(async () => ({ label: 'v9' })) }));
vi.mock('../standards.service', () => ({
  getUdpDefs: vi.fn(async () => [{ id: 'u1', name: 'Clasificacion', level: 'column', dataType: 'list', allowedValues: ['DAC', 'No DAC'] }]),
}));
import { toast } from 'sonner';
import { saveDdlConfig } from '../ddlRules.service';
import DdlLookupsEditor from './DdlLookupsEditor';

const CONFIG: DdlRulesetConfig = {
  lookups: { nivel: { fromUdpId: 'u1', fromLevel: 'column', values: { DAC: 'sha2' }, default: null } },
  functions: [{ name: 'mask', params: ['col'], body: 'sha2({col}, 512)' }],
};
const tick = () => new Promise((r) => setTimeout(r, 0));

let props: Parameters<typeof DdlLookupsEditor>[0];
function rerender() {
  const next = nextStates();
  resetFake((_init, i) => next[i], { keepRefs: true });
  const tree = DdlLookupsEditor(props);
  runEffects();
  return tree;
}
async function open(config: DdlRulesetConfig = CONFIG) {
  props = { projectId: 'p1', config: structuredClone(config), canEdit: true, onClose: vi.fn(), onApplied: vi.fn(async () => {}) };
  resetFake();
  DdlLookupsEditor(props);
  runEffects();
  await tick();
  return rerender();
}
const saveBtn = (tree: unknown) => byText(tree, 'button', 'Save changes');
/** Input por su nombre accesible (fila «Emitted value for X» o «Default value (unmapped)»). */
const input = (tree: unknown, label: string) => {
  const hit = [...walk(tree)].find((e) => e.type === 'input' && e.props['aria-label'] === label);
  if (!hit) throw new Error(`no input «${label}»`);
  return hit;
};
const cell = (tree: unknown, value: string) => input(tree, `Emitted value for ${value}`);
const press = (tree: unknown, label: string) => {
  const hit = [...walk(tree)].find((e) => e.type === 'button' && e.props['aria-label'] === label);
  if (!hit) throw new Error(`no button «${label}»`);
  (hit.props.onClick as () => void)();
};
const type = (el: { props: Record<string, unknown> }, value: string) => (el.props.onChange as (e: unknown) => void)({ target: { value } });

beforeEach(() => { vi.clearAllMocks(); });

describe('Lookups & Functions: «Save changes» sólo con un cambio real (doc 105)', () => {
  it('sin cambios (o «nada» escrito sobre un valor sin mapear) queda deshabilitado, con «No changes to apply»', async () => {
    let tree = await open();
    expect(saveBtn(tree).props.disabled).toBe(true);
    expect(saveBtn(tree).props.title).toBe('No changes to apply');
    type(cell(tree, 'No DAC'), '');                           // sin default: null ≡ sin mapear
    tree = rerender();
    expect(saveBtn(tree).props.disabled).toBe(true);
  });

  it('con un cambio se habilita; si el backend igual responde «sin cambios», el aviso es neutro', async () => {
    let tree = await open();
    type(input(tree, 'Default value (unmapped)'), 'N/A');
    tree = rerender();
    expect(saveBtn(tree).props.disabled).toBe(false);

    vi.mocked(saveDdlConfig).mockRejectedValueOnce(new ApiError('There are no changes to apply.', 422));
    await (saveBtn(tree).props.onClick as () => Promise<void>)();
    expect(toast.info).toHaveBeenCalledWith('There are no changes to apply.');
    expect(toast.error).not.toHaveBeenCalled();
  });
});

// Doc 105: con un default, «nada» (null = no emitir) y «sin mapear» (emite el
// default) se veían iguales —input vacío con «— nothing»— y sólo se llegaba a
// «nada» tipeando y borrando; a «sin mapear» no se volvía nunca.
describe('Lookups: con default, «nada» y «sin mapear» se distinguen y se eligen a propósito (doc 105)', () => {
  const PAIS: DdlRulesetConfig = {
    lookups: { pais: { fromUdpId: 'u1', fromLevel: 'column', values: { DAC: null }, default: 'PE' } },
    functions: [],
  };

  it('la fila sin mapear dice que emite el default; la mapeada a «nada», que no se emite', async () => {
    const tree = await open(PAIS);
    expect(cell(tree, 'No DAC').props.placeholder).toBe('— default (PE)');
    expect(cell(tree, 'DAC').props.placeholder).toBe('— nothing (not emitted)');
    expect(input(tree, 'Default value (unmapped)').props.placeholder).toBe('— nothing (not emitted)');
  });

  it('«Emit nothing» la pasa a null (cambio real) y «Unmap» la vuelve a sin mapear (lo guardado: sin cambio)', async () => {
    let tree = await open(PAIS);
    press(tree, 'Emit nothing for No DAC (instead of the default)');
    tree = rerender();
    expect(cell(tree, 'No DAC').props.placeholder).toBe('— nothing (not emitted)');
    expect(saveBtn(tree).props.disabled).toBe(false);
    press(tree, 'Unmap No DAC — emit the default (PE)');
    tree = rerender();
    expect(cell(tree, 'No DAC').props.placeholder).toBe('— default (PE)');
    expect(saveBtn(tree).props.disabled).toBe(true);
    press(tree, 'Unmap DAC — emit the default (PE)');           // la guardada en «nada» vuelve al default
    tree = rerender();
    expect(cell(tree, 'DAC').props.placeholder).toBe('— default (PE)');
    expect(saveBtn(tree).props.disabled).toBe(false);
  });

  it('tipear y borrar una celda la vuelve a «sin mapear» (emite el default), no a «nothing» (doc 105, R6)', async () => {
    let tree = await open(PAIS);
    type(cell(tree, 'No DAC'), 'X');
    tree = rerender();
    type(cell(tree, 'No DAC'), '');
    tree = rerender();
    expect(cell(tree, 'No DAC').props.placeholder).toBe('— default (PE)');
    expect(saveBtn(tree).props.disabled).toBe(true);            // lo guardado: sin cambio
  });

  it('sin default no se ofrece «Emit nothing» (ya no emite nada); un valor mapeado sí se puede des-mapear', async () => {
    const tree = await open();                                    // nivel: default null, DAC → 'sha2'
    const labels = [...walk(tree)].filter((e) => e.type === 'button').map((e) => String(e.props['aria-label'] ?? ''));
    expect(labels.some((l) => l.startsWith('Emit nothing'))).toBe(false);
    expect(labels).toContain('Unmap DAC');
  });
});

// Doc 105 (R11): vaciar la celda de un valor «stale» (ya no está en la lista del
// UDP) le borraba la clave y la fila desaparecía mientras se editaba — el foco
// caía a <body>. Las claves stale del config inicial siguen visibles hasta guardar.
describe('Lookups: un valor stale vaciado sigue en la tabla hasta guardar (doc 105, R11)', () => {
  it('vaciar su celda la des-mapea pero la fila (y el foco en su input) sigue ahí', async () => {
    const STALE: DdlRulesetConfig = {
      lookups: { pais: { fromUdpId: 'u1', fromLevel: 'column', values: { Legacy: 'X' }, default: 'PE' } }, functions: [],
    };
    let tree = await open(STALE);
    expect(cell(tree, 'Legacy').props.value).toBe('X');
    type(cell(tree, 'Legacy'), '');
    tree = rerender();
    expect(cell(tree, 'Legacy').props.placeholder).toBe('— default (PE)');   // sin mapear, pero visible
    expect(saveBtn(tree).props.disabled).toBe(false);                         // y es un cambio real
  });
});

// Doc 105 (R14): las claves stale del config inicial se buscaban sólo por el
// NOMBRE del lookup — uno nuevo creado con el nombre de uno borrado heredaba sus filas.
describe('Lookups: un lookup nuevo con el nombre de uno borrado no hereda sus filas stale (doc 105, R14)', () => {
  it('borrar «nivel» y crear otro «nivel»: sólo los valores del UDP', async () => {
    const GHOST: DdlRulesetConfig = {
      lookups: { nivel: { fromUdpId: 'u1', fromLevel: 'column', values: { LEGACY_1: 'x', LEGACY_2: 'y' }, default: null } }, functions: [],
    };
    const rowsOf = (tree: unknown) => [...walk(tree)]
      .filter((e) => e.type === 'input' && String(e.props['aria-label'] ?? '').startsWith('Emitted value for '))
      .map((e) => String(e.props['aria-label']).slice('Emitted value for '.length));
    let tree = await open(GHOST);
    expect(rowsOf(tree)).toEqual(['DAC', 'No DAC', 'LEGACY_1', 'LEGACY_2']);
    ([...walk(tree)].find((e) => e.type === 'button' && e.props.title === 'Delete lookup')!.props.onClick as () => void)();
    tree = rerender();
    vi.stubGlobal('window', { prompt: () => 'nivel' });
    ([...walk(tree)].find((e) => e.type === 'button' && textOf(e).trim() === 'New lookup')!.props.onClick as () => void)();
    vi.unstubAllGlobals();
    tree = rerender();
    expect(rowsOf(tree)).toEqual(['DAC', 'No DAC']);
  });
});
