// UdpAssign sin DOM (hooks de mentira: ver reporting/components/fakeReact.testutil).
// Doc 105 (ronda 4, 6d) — lo tipeado sin blur se guarda al desmontar (cerrar
// Properties). Si el panel se desmonta porque la sesión cambió — se abrió otra
// versión, o la revalidación la bajó a solo lectura —, ese flush escribía con la
// sesión NUEVA: en solo lectura fallaba y avisaba «read-only» encima del aviso
// de la revalidación. Ahora lo pendiente es de la sesión de la ÚLTIMA edición:
// si ya no es la vigente, se descarta.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextStates, resetFake, runEffects, unmount, walk } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
import { useSessionStore } from '@/store/useSessionStore';
import UdpAssign from './UdpAssign';

const DEFS = [{ id: 'u1', name: 'Owner', level: 'table', view: 'physical', dataType: 'text', allowedValues: [] }] as never[];
let props: Parameters<typeof UdpAssign>[0];

function rerender() {
  const next = nextStates();
  resetFake((_init, i) => next[i], { keepRefs: true });
  const tree = UdpAssign(props);
  runEffects();
  return tree;
}
/** Monta el panel con las defs ya cargadas (sin fetch) y tipea `v` sin salir del campo. */
function mountAndType(v: string) {
  props = { level: 'table', view: 'physical', values: {}, onChange: vi.fn(), defs: DEFS };
  resetFake();
  UdpAssign(props);
  runEffects();
  let tree = rerender();                                   // ya con las defs
  const input = () => [...walk(tree)].find((e) => e.type === 'input')!;
  (input().props.onChange as (e: unknown) => void)({ target: { value: v } });
  tree = rerender();                                       // el borrador en el estado
  return { input };
}

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
});

describe('UdpAssign: lo pendiente es de la sesión de la última edición (doc 105, ronda 4)', () => {
  it('al desmontar en la MISMA sesión, guarda lo tipeado (como siempre)', () => {
    mountAndType('Finanzas');
    unmount();
    expect(props.onChange).toHaveBeenCalledWith({ u1: 'Finanzas' });
  });

  it('la revalidación bajó la versión a solo lectura: el panel se cierra y NO escribe', () => {
    mountAndType('Finanzas');
    useSessionStore.setState({ openMode: 'readonly' });
    unmount();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('se abrió otra versión: tampoco escribe en ella', () => {
    mountAndType('Finanzas');
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    unmount();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('un blur que llega con la sesión ya cambiada (el campo se va) tampoco', () => {
    const { input } = mountAndType('Finanzas');
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    (input().props.onBlur as () => void)();
    expect(props.onChange).not.toHaveBeenCalled();
  });
});

// Doc 105 (ronda 5): un UDP booleano se tipeaba como texto libre («Sí», «yes»,
// «1»…): el Reporting lo normaliza al filtrar pero GROUP BY agrupaba por grafía.
describe('UDP booleano: se elige true/false, no se tipea (doc 105, ronda 5)', () => {
  const BOOL = [{ id: 'u2', name: 'Sensible', level: 'table', view: 'physical', dataType: 'boolean', allowedValues: [] }] as never[];
  function mountBool(values: Record<string, string>) {
    props = { level: 'table', view: 'physical', values, onChange: vi.fn(), defs: BOOL };
    resetFake();
    UdpAssign(props);
    runEffects();
    return rerender();
  }
  const optionsOf = (sel: { props: Record<string, unknown> }) =>
    [...walk(sel.props.children)].filter((e) => e.type === 'option').map((o) => o.props.value);

  it('un select con true y false (no un campo de texto); elegir guarda al instante', () => {
    const tree = mountBool({});
    expect([...walk(tree)].some((e) => e.type === 'input')).toBe(false);
    const sel = [...walk(tree)].find((e) => e.type === 'select')!;
    expect(optionsOf(sel)).toEqual(['', 'true', 'false']);
    (sel.props.onChange as (e: unknown) => void)({ target: { value: 'false' } });
    expect(props.onChange).toHaveBeenCalledWith({ u2: 'false' });
  });

  it('un valor legado («Sí») se sigue viendo, no se pierde en silencio', () => {
    const tree = mountBool({ u2: 'Sí' });
    const sel = [...walk(tree)].find((e) => e.type === 'select')!;
    expect(sel.props.value).toBe('Sí');
    expect(optionsOf(sel)).toEqual(['', 'true', 'false', 'Sí']);
  });
});

// Doc 105 (ronda 6): un número se guarda en su forma canónica («10.50» → «10.5»):
// el Reporting busca `= 10.5` por el literal y su forma canónica.
describe('UDP numérico: se guarda en su forma canónica (doc 105, ronda 6)', () => {
  it('al salir del campo', () => {
    const NUM = [{ id: 'u4', name: 'Peso', level: 'table', view: 'physical', dataType: 'number', allowedValues: [] }] as never[];
    props = { level: 'table', view: 'physical', values: {}, onChange: vi.fn(), defs: NUM };
    resetFake();
    UdpAssign(props);
    runEffects();
    let tree = rerender();
    const input = () => [...walk(tree)].find((e) => e.type === 'input')!;
    (input().props.onChange as (e: unknown) => void)({ target: { value: '10.50' } });
    tree = rerender();
    (input().props.onBlur as () => void)();
    expect(props.onChange).toHaveBeenCalledWith({ u4: '10.5' });
  });

  it('y al cerrar el panel sin salir del campo', () => {
    const NUM = [{ id: 'u4', name: 'Peso', level: 'table', view: 'physical', dataType: 'number', allowedValues: [] }] as never[];
    props = { level: 'table', view: 'physical', values: {}, onChange: vi.fn(), defs: NUM };
    resetFake();
    UdpAssign(props);
    runEffects();
    const tree = rerender();
    ([...walk(tree)].find((e) => e.type === 'input')!.props.onChange as (e: unknown) => void)({ target: { value: '1e3' } });
    rerender();
    unmount();
    expect(props.onChange).toHaveBeenCalledWith({ u4: '1000' });
  });
});
