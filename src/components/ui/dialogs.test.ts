// Host global de diálogos sin DOM (hooks simulados: ver reporting/components/fakeReact.testutil).
// El prompt con `action` pasa a busy y deshabilita el input y los dos botones: el foco
// queda en la caja para que no caiga a <body> y Tab no salga a la página de atrás
// (igual que en ConfirmDialog). Al cerrarse, el foco vuelve a quien lo abrió.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, fake, resetFake, runEffects, walk, type El } from '../../features/reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../features/reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
/** zustand sin React: el hook lee el estado vigente (el host se llama como función). */
const stores = vi.hoisted(() => [] as { setState: (patch: object) => void }[]);
vi.mock('zustand', () => ({
  create: (init: (set: (patch: unknown) => void, get: () => unknown) => object) => {
    let state: Record<string, unknown> = {};
    const get = () => state;
    const set = (patch: unknown) => {
      state = { ...state, ...(typeof patch === 'function' ? (patch as (s: unknown) => object)(state) : patch as object) };
    };
    state = init(set, get) as Record<string, unknown>;
    const api = Object.assign((pick: (s: unknown) => unknown) => pick(state), { getState: get, setState: set });
    stores.push(api);
    return api;
  },
}));
import { DialogHost, promptDialog } from './dialogs';
import { isTopDialog, pushDialog, resetDialogStack } from './dialogStack';

beforeEach(() => {
  vi.useFakeTimers();
  stores.forEach((s) => s.setState({ queue: [] }));
  vi.stubGlobal('window', {
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (t: number) => clearTimeout(t),
  });
  vi.stubGlobal('document', { activeElement: null, body: {} });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/** El prompt que muestra el host: el host devuelve <PromptHostView/> y se invoca a mano. */
function renderPrompt() {
  resetFake();
  const host = DialogHost() as unknown as El;
  const tree = (host.type as (props: unknown) => unknown)(host.props);
  return { tree, box: [...walk(tree)].find((e: El) => e.props.role === 'dialog')! };
}
const setRef = (el: El, current: unknown) => { (el.props.ref as { current: unknown }).current = current; };

describe('promptDialog: el foco no sale del diálogo', () => {
  it('con action, al aceptar la caja (tabIndex -1, sin outline) toma el foco antes de pasar a busy', () => {
    void promptDialog({ title: 'New changeset', label: 'Title', action: () => new Promise(() => undefined) });
    const { tree, box } = renderPrompt();
    expect(box.props.tabIndex).toBe(-1);
    expect((box.props.style as { outline?: string }).outline).toBe('none');
    let busyAtFocus: unknown[] | null = null;                 // `busy` es el 2.º useState del prompt
    setRef(box, { focus: vi.fn(() => { busyAtFocus = [...fake.states[1].calls]; }) });
    (byText(tree, 'button', 'OK').props.onClick as () => void)();
    expect(busyAtFocus).toEqual([]);                          // al tomar el foco, sin ocupar…
    expect(fake.states[1].calls).toEqual([true]);             // …y después sí
  });

  it('el foco inicial sigue en el input; al cerrarse vuelve a quien abrió el prompt', () => {
    const opener = { isConnected: true, disabled: false, focus: vi.fn(), matches: () => false, closest: () => null };
    const doc: { activeElement: unknown; body: object } = { activeElement: opener, body: {} };
    vi.stubGlobal('document', doc);
    void promptDialog({ title: 'New changeset' });
    const { tree, box } = renderPrompt();                     // primer render: el foco es de quien lo abrió
    const fakeBox = { focus: vi.fn(() => { doc.activeElement = fakeBox; }), contains: (n: unknown) => n === fakeBox, matches: () => false };
    setRef(box, fakeBox);
    const inputFocus = vi.fn();
    setRef([...walk(tree)].find((e: El) => e.type === 'input')!, { focus: inputFocus });
    const cleanups = runEffects();
    expect(fakeBox.focus).toHaveBeenCalledTimes(1);           // entra a la caja al abrirse…
    vi.advanceTimersByTime(30);
    expect(inputFocus).toHaveBeenCalledTimes(1);              // …y a los 30 ms, al input
    doc.activeElement = doc.body;                             // se desmontó con el foco adentro
    cleanups.forEach((c) => c());
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });
});

describe('promptDialog: pila de diálogos y nombres accesibles', () => {
  it('abierto es el tope y Tab con el foco en <body> vuelve a su caja', () => {
    resetDialogStack();
    const below = Symbol('Modal de abajo');
    pushDialog(below);
    const listeners: ((e: unknown) => void)[] = [];
    vi.stubGlobal('window', {
      addEventListener: (_t: string, fn: (e: unknown) => void) => { listeners.push(fn); }, removeEventListener: vi.fn(),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (t: number) => clearTimeout(t),
    });
    const doc: { activeElement: unknown; body: object; querySelectorAll: () => unknown[] } = { activeElement: null, body: {}, querySelectorAll: () => [] };
    vi.stubGlobal('document', doc);
    void promptDialog({ title: 'New changeset' });
    const { box } = renderPrompt();
    const fakeBox = { focus: vi.fn(), contains: (n: unknown) => n === fakeBox, matches: () => false };
    setRef(box, fakeBox);
    doc.activeElement = fakeBox;
    const cleanups = runEffects();
    expect(isTopDialog(below)).toBe(false);
    doc.activeElement = doc.body;
    const tab = { key: 'Tab', shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    listeners.forEach((fn) => fn(tab));
    expect(tab.preventDefault).toHaveBeenCalled();
    expect(fakeBox.focus).toHaveBeenCalledTimes(1);
    cleanups.forEach((c) => c());
    expect(isTopDialog(below)).toBe(true);
  });

  it('la caja se nombra con su título y el <label> apunta al input (sin label, el input toma el título)', () => {
    void promptDialog({ title: 'New changeset', label: 'Title' });
    const { tree, box } = renderPrompt();
    const find = (type: string) => [...walk(tree)].find((e: El) => e.type === type)!;
    expect(find('h3').props.id).toBeTruthy();
    expect(box.props['aria-labelledby']).toBe(find('h3').props.id);
    expect(find('input').props.id).toBeTruthy();
    expect(find('label').props.htmlFor).toBe(find('input').props.id);
    stores.forEach((st) => st.setState({ queue: [] }));
    void promptDialog({ title: 'Rename canvas' });
    const bare = renderPrompt().tree;
    const h3 = [...walk(bare)].find((e: El) => e.type === 'h3')!;
    const input = [...walk(bare)].find((e: El) => e.type === 'input')!;
    expect(input.props['aria-labelledby']).toBe(h3.props.id);
  });
});

// El Enter que acepta el prompt (sin `action`) lo cierra en su keydown; sin
// preventDefault, el keypress de ese Enter «clicaría» al botón que lo abrió y
// aparecería un segundo prompt.
describe('promptDialog: el Enter que acepta no llega a quien lo abrió', () => {
  it('Enter en el input: preventDefault (no hay keypress que active al botón de atrás) y resuelve', async () => {
    const done = promptDialog({ title: 'New changeset', label: 'Title', initial: 'Sprint 12' });
    const { tree } = renderPrompt();
    const input = [...walk(tree)].find((e: El) => e.type === 'input')!;
    const enter = { key: 'Enter', preventDefault: vi.fn() };
    (input.props.onKeyDown as (e: unknown) => void)(enter);
    expect(enter.preventDefault).toHaveBeenCalled();
    await expect(done).resolves.toBe('Sprint 12');
  });
});
