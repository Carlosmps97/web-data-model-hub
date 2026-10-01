// Data Standards → UDP sin DOM (hooks de mentira: ver
// reporting/components/fakeReact.testutil). Doc 105: «Save & apply» se
// habilitaba SIN cambios y registraba una versión vacía; además vaciar el
// default o la descripción no viajaba (el backend guarda sólo lo presente).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/http';
import type { StandardsSnapshot, UdpDefinition } from '../standards.service';
import { byText, nextStates, resetFake, runEffects, walk } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../standards.service', () => ({ applyStandards: vi.fn(async () => ({ label: 'v9' })) }));
import { toast } from 'sonner';
import { applyStandards } from '../standards.service';
import UdpDefsPage from './UdpDefsPage';

const DEF: UdpDefinition = {
  id: 'u1', name: 'Clasificacion', level: 'column', view: 'physical', dataType: 'list',
  defaultValue: 'No DAC', allowedValues: ['DAC', 'No DAC'], description: 'Nivel de sensibilidad',
};
const snapshot = { domains: [], dict: [], udp: [DEF], namingConfig: {} } as unknown as StandardsSnapshot;

let props: Parameters<typeof UdpDefsPage>[0];
function rerender() {
  const next = nextStates();
  resetFake((_init, i) => next[i], { keepRefs: true });
  const tree = UdpDefsPage(props);
  runEffects();
  return tree;
}
/** Monta la página (Attribute / Column · Physical) y abre la definición DEF. */
function openDef() {
  props = { projectId: 'p1', snapshot, canEdit: true, onApplied: vi.fn(async () => {}) };
  resetFake();
  let tree = UdpDefsPage(props);
  runEffects();
  tree = rerender();
  const row = [...walk(tree)].find((e) => e.type === 'tr' && typeof e.props.onClick === 'function')!;
  (row.props.onClick as () => void)();
  rerender();                                                 // corre el efecto que carga el formulario
  return rerender();
}
const saveBtn = (tree: unknown) => byText(tree, 'button', 'Save & apply');
/** El campo del bloque cuyo <label> DIRECTO dice `label`. */
const inputOf = (tree: unknown, label: string) => {
  const kids = (e: { props: Record<string, unknown> }) => [e.props.children].flat() as { type?: unknown; props?: Record<string, unknown> }[];
  const box = [...walk(tree)].find((e) => e.type === 'div' && kids(e).some((c) => c?.type === 'label' && c.props?.children === label))!;
  return [...walk(box.props.children)].find((c) => c.type === 'input' || c.type === 'textarea' || c.type === 'select')!;
};
const type = (el: { props: Record<string, unknown> }, value: string) => (el.props.onChange as (e: unknown) => void)({ target: { value } });

beforeEach(() => { vi.clearAllMocks(); });

describe('UDP: «Save & apply» sólo con un cambio real (doc 105)', () => {
  it('sin cambios queda deshabilitado, con «No changes to apply»', () => {
    const tree = openDef();
    expect(saveBtn(tree).props.disabled).toBe(true);
    expect(saveBtn(tree).props.title).toBe('No changes to apply');
  });

  it('con un cambio se habilita; vaciar la descripción guardada viaja como "" y la limpia', async () => {
    let tree = openDef();
    type(inputOf(tree, 'Description'), '');
    tree = rerender();
    expect(saveBtn(tree).props.disabled).toBe(false);
    await (saveBtn(tree).props.onClick as () => Promise<void>)();
    expect(vi.mocked(applyStandards).mock.calls[0][1].udpUpsert?.[0]).toMatchObject({ id: 'u1', description: '' });
  });

  it('si el backend igual responde «sin cambios», el aviso es neutro', async () => {
    let tree = openDef();
    type(inputOf(tree, 'Name'), 'Clasificación');
    tree = rerender();
    vi.mocked(applyStandards).mockRejectedValueOnce(new ApiError('There are no changes to apply.', 422));
    await (saveBtn(tree).props.onClick as () => Promise<void>)();
    expect(toast.info).toHaveBeenCalledWith('There are no changes to apply.');
    expect(toast.error).not.toHaveBeenCalled();
  });
});

// Doc 105 (ronda 5): el default de un UDP booleano se tipeaba como texto libre.
describe('UDP booleano: el default se elige true/false (doc 105, ronda 5)', () => {
  it('el Default de un Boolean es un select con true y false', () => {
    const BOOL: UdpDefinition = { ...DEF, id: 'u2', name: 'Sensible', dataType: 'boolean', defaultValue: '', allowedValues: [] };
    props = { projectId: 'p1', snapshot: { ...snapshot, udp: [BOOL] } as StandardsSnapshot, canEdit: true, onApplied: vi.fn(async () => {}) };
    resetFake();
    let tree = UdpDefsPage(props);
    runEffects();
    tree = rerender();
    const row = [...walk(tree)].find((e) => e.type === 'tr' && typeof e.props.onClick === 'function')!;
    (row.props.onClick as () => void)();
    rerender();
    tree = rerender();
    const def = inputOf(tree, 'Default');
    expect(def.type).toBe('select');
    expect([...walk(def.props.children)].filter((e) => e.type === 'option').map((o) => o.props.value)).toEqual(['', 'true', 'false']);
  });
});

// Doc 105 (ronda 5): el default de una lista que ya no está entre los valores
// permitidos se veía «—» (el select no tenía esa opción) pero se conservaba.
describe('UDP de lista: un default fuera de la lista se sigue viendo (doc 105, ronda 5)', () => {
  it('el select del Default muestra el valor guardado aunque ya no esté permitido', () => {
    const LIST: UdpDefinition = { ...DEF, id: 'u3', name: 'Nivel', defaultValue: 'Retirado', allowedValues: ['DAC', 'No DAC'] };
    props = { projectId: 'p1', snapshot: { ...snapshot, udp: [LIST] } as StandardsSnapshot, canEdit: true, onApplied: vi.fn(async () => {}) };
    resetFake();
    let tree = UdpDefsPage(props);
    runEffects();
    tree = rerender();
    const row = [...walk(tree)].find((e) => e.type === 'tr' && typeof e.props.onClick === 'function')!;
    (row.props.onClick as () => void)();
    rerender();
    tree = rerender();
    const def = inputOf(tree, 'Default');
    expect(def.props.value).toBe('Retirado');
    expect([...walk(def.props.children)].filter((e) => e.type === 'option').map((o) => o.props.value)).toEqual(['', 'DAC', 'No DAC', 'Retirado']);
  });
});
