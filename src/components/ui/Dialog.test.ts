// Dialog del design system sin DOM (hooks de mentira: ver reporting/components/fakeReact.testutil).
// Doc 105 (F6): abierto con el mouse, el foco quedaba en la página de atrás —
// Tab la recorría y la trampa del diálogo nunca actuaba (SheetTemplateEditor,
// ExportDdlModal, PublishModal, OpenModelModal, UploadModal, ModelPropertiesModal…).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFake, runEffects, walk, type El } from '../../features/reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../features/reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
import Dialog from './Dialog';
import { pushDialog, resetDialogStack } from './dialogStack';

type Key = { key: string; shiftKey?: boolean; preventDefault?: () => void };
let listeners: ((e: Key) => void)[] = [];
beforeEach(() => {
  resetDialogStack();
  listeners = [];
  vi.stubGlobal('window', {
    addEventListener: (_t: string, fn: (e: Key) => void) => { listeners.push(fn); },
    removeEventListener: (_t: string, fn: (e: Key) => void) => { listeners = listeners.filter((l) => l !== fn); },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

/** Renderiza el Dialog; `rerender` = el MISMO montado (mismas refs y efectos). */
function render(open: boolean, rerender = false) {
  resetFake(null, { keepRefs: rerender });
  return Dialog({ open, title: 'Sheet templates', onClose: vi.fn(), children: null as never });
}
const boxOf = (tree: unknown) => [...walk(tree)].find((e: El) => e.props.role === 'dialog')!;

describe('Dialog: el foco entra al abrirse (doc 105, F6)', () => {
  it('abierto con el mouse: la caja (tabIndex -1, sin outline) toma el foco; al cerrarse vuelve a quien lo abrió', () => {
    const opener = { isConnected: true, disabled: false, focus: vi.fn(), matches: () => false, closest: () => null };
    const doc: { activeElement: unknown; body: object } = { activeElement: opener, body: {} };
    vi.stubGlobal('document', doc);
    const el = boxOf(render(true));
    expect(el.props.tabIndex).toBe(-1);
    expect((el.props.style as { outline?: string }).outline).toBe('none');
    const box = { focus: vi.fn(() => { doc.activeElement = box; }), contains: (n: unknown) => n === box, matches: () => false };
    (el.props.ref as { current: unknown }).current = box;
    runEffects();
    expect(box.focus).toHaveBeenCalledTimes(1);
    doc.activeElement = doc.body;             // open=false desmonta la caja (portal) con el foco adentro
    render(false, true);
    runEffects();
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  it('con un control de adentro ya enfocado (autoFocus), no le quita el foco', () => {
    const input = { matches: () => false };
    vi.stubGlobal('document', { activeElement: input, body: {} });
    const el = boxOf(render(true));
    const box = { focus: vi.fn(), contains: (n: unknown) => n === input, matches: () => false };
    (el.props.ref as { current: unknown }).current = box;
    runEffects();
    expect(box.focus).not.toHaveBeenCalled();
  });
});

describe('Dialog: con un control autoFocus adentro, el foco igual vuelve a quien lo abrió (doc 105)', () => {
  it('quien abrió se captura en el render en que `open` pasa a true (antes del commit y del autoFocus)', () => {
    const doc: { activeElement: unknown; body: object } = { activeElement: null, body: {} };
    vi.stubGlobal('document', doc);
    render(false);                            // montado cerrado: `open` cambia después
    const opener = { isConnected: true, disabled: false, focus: vi.fn(), matches: () => false, closest: () => null };
    doc.activeElement = opener;
    const el = boxOf(render(true, true));     // se abre: el render todavía ve el foco en quien lo abrió
    const input = { matches: () => false };
    const box = { focus: vi.fn(), contains: (n: unknown) => n === input, matches: () => false };
    (el.props.ref as { current: unknown }).current = box;
    doc.activeElement = input;                // commit + autoFocus
    runEffects();
    expect(box.focus).not.toHaveBeenCalled();
    doc.activeElement = doc.body;             // open=false desmonta la caja con el foco adentro
    render(false, true);
    runEffects();
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });
});

// Doc 105 (R6): con el diálogo abierto el foco se perdía a <body> —el botón que
// lo tenía desapareció o pasó a busy (deshabilitado)— y Tab salía a la página.
describe('Dialog: el foco no se pierde con el diálogo abierto (doc 105, R6)', () => {
  function openWithFocusInside() {
    const doc: { activeElement: unknown; body: object } = { activeElement: null, body: {} };
    vi.stubGlobal('document', doc);
    const el = boxOf(render(true));
    const save = { matches: (sel: string) => sel === ':disabled' };      // un botón suyo, ya deshabilitado
    const box = { focus: vi.fn(), contains: (n: unknown) => n === box || n === save, matches: () => false };
    (el.props.ref as { current: unknown }).current = box;
    doc.activeElement = box;
    runEffects();
    box.focus.mockClear();
    return { doc, box, save };
  }

  it('(a) Tab con el foco en <body> lo retoma la caja — sólo si es el diálogo del tope', () => {
    const { doc, box } = openWithFocusInside();
    doc.activeElement = doc.body;                  // el botón que tenía el foco desapareció
    const tab = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };
    listeners.forEach((fn) => fn(tab));
    expect(tab.preventDefault).toHaveBeenCalled();
    expect(box.focus).toHaveBeenCalledTimes(1);
    pushDialog(Symbol('otro diálogo encima'));
    const tab2 = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };
    listeners.forEach((fn) => fn(tab2));
    expect(tab2.preventDefault).not.toHaveBeenCalled();
  });

  it('(c) tras un render con el foco en un botón suyo que pasó a busy, el foco vuelve a la caja', () => {
    const { doc, box, save } = openWithFocusInside();
    doc.activeElement = save;                      // «Save» se deshabilitó con el foco adentro
    render(true, true);
    runEffects();
    expect(box.focus).toHaveBeenCalledTimes(1);
  });
});
