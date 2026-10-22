// «Save and leave» del aviso de cambios sin guardar: si el guardado falla, el
// aviso «Couldn't save — you're still on the canvas» incluye el motivo
// (`failureText`), para que el usuario sepa qué pasó antes de elegir entre
// «Cancel» y «Leave without saving».
// Sin DOM: hooks simulados (ver reporting/components/fakeReact.testutil).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextStates, resetFake, runEffects, textOf, walk } from '../../features/reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../features/reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ Link: 'a', useLocation: () => ({ pathname: '/model' }), useNavigate: () => navigate }));
const session = { openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' };
vi.mock('@/store/useSessionStore', () => ({
  useSessionStore: Object.assign((sel: (s: unknown) => unknown) => sel(session), { getState: () => session, subscribe: () => () => {} }),
}));
const auth = { user: { username: 'ana', permissions: {} } };
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: Object.assign((sel: (s: unknown) => unknown) => sel(auth), { getState: () => auth, subscribe: () => () => {} }),
}));
const saveAll = vi.fn();
const mstate = { dirty: true, saveAll, clearDirty: vi.fn() };
vi.mock('@/store/useModelerStore', async (orig) => {
  const actual = await orig<typeof import('@/store/useModelerStore')>();
  return { ...actual, useModelerStore: Object.assign((sel: (s: unknown) => unknown) => sel(mstate), { getState: () => mstate }) };
});

import { toast } from 'sonner';
import { ApiError } from '@/services/http';
import TopNav from './TopNav';

const tick = () => new Promise((r) => setTimeout(r, 0));
const ticks = async (n = 4) => { for (let i = 0; i < n; i++) await tick(); };
/** El aviso de cambios sin guardar abierto (leaveTo = '/', useState #1) y su «Save and leave». */
function saveAndLeave() {
  resetFake((init, i) => (i === 1 ? '/' : init));
  const b = [...walk(TopNav())].find((el) => typeof el.props.onClick === 'function' && textOf(el).includes('Save and leave'));
  if (!b) throw new Error('no «Save and leave»');
  return b.props.onClick as () => void;
}

beforeEach(() => { vi.clearAllMocks(); saveAll.mockReset(); });

describe('«Save and leave»', () => {
  it('si el guardado falla, el aviso dice por qué — y no sale', async () => {
    saveAll.mockRejectedValueOnce(new ApiError('Internal server error', 500, null, '/api/subject-areas/sa1/layout?changesetId=cs1'));
    saveAndLeave()();
    await ticks();
    expect(navigate).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls.map((c) => c[0])).toEqual(["Couldn't save — you're still on the canvas: Internal server error."]);
  });

  it('sin motivo legible, muestra el aviso base', async () => {
    saveAll.mockRejectedValueOnce(new Error(''));
    saveAndLeave()();
    await ticks();
    expect(vi.mocked(toast.error).mock.calls.map((c) => c[0])).toEqual(["Couldn't save — you're still on the canvas"]);
  });

  it('si guarda, sale', async () => {
    saveAll.mockResolvedValueOnce(undefined);
    saveAndLeave()();
    await ticks();
    expect(navigate).toHaveBeenCalledWith('/');
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('aviso de cambios sin guardar por encima de los popups del canvas', () => {
  it('va en la capa de confirmaciones, por encima de los popups del canvas que dejan la barra clicable', () => {
    // Con un popup del canvas abierto (Model properties, New table…) el TopNav
    // sigue clicable: el aviso va en la capa `--top`, por encima del popup; si
    // quedara detrás, la pantalla parecería trabada.
    resetFake((init, i) => (i === 1 ? '/' : init));
    const isScrim = (el: { props: { className?: unknown } }) => /\bdmh-backdrop\b/.test(String(el.props.className ?? ''));
    const tree = TopNav();
    const scrim = [...walk(tree)].find(isScrim);
    expect(String(scrim?.props.className)).toMatch(/\bdmh-backdrop--top\b/);
    // Y fuera del <header>: la barra tiene su propio z-index (40), que encerraría
    // al aviso por debajo de los popups aunque tuviera la capa alta.
    const header = [...walk(tree)].find((el) => el.type === 'header');
    expect(header).toBeTruthy();
    expect([...walk(header!.props.children)].some(isScrim)).toBe(false);
  });
});

describe('aviso de cambios sin guardar: foco y Escape', () => {
  it('se lleva el foco y Escape lo cierra a él (quedarse), sin llegar al popup del canvas de atrás', () => {
    const listeners: { type: string; fn: (e: unknown) => void; capture: unknown }[] = [];
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: (e: unknown) => void, capture: unknown) => { listeners.push({ type, fn, capture }); },
      removeEventListener: vi.fn(),
    });
    try {
      resetFake((init, i) => (i === 1 ? '/' : init));
      const tree = TopNav();
      const cancel = [...walk(tree)].find((el) => el.type === 'button' && textOf(el) === 'Cancel')!;
      const focus = vi.fn();
      (cancel.props.ref as { current: unknown }).current = { focus };
      runEffects();
      expect(focus).toHaveBeenCalledTimes(1);
      const esc = listeners.find((l) => l.type === 'keydown');
      expect(esc?.capture).toBe(true);                       // antes que el listener del popup de atrás
      const ev = { key: 'Escape', preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
      esc!.fn(ev);
      expect(ev.stopImmediatePropagation).toHaveBeenCalled();
      expect(nextStates()[1]).toBeNull();                    // leaveTo = null: se queda en el canvas
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
