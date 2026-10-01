// Modal legacy sin DOM (hooks de mentira: ver reporting/components/fakeReact.testutil).
// Doc 105: el Modal (New column, Relationship, Subcategory, Paste columns,
// Inherit from domain, usuarios y roles) no participaba de la pila de diálogos
// ni de la trampa de Tab que ya tenían Dialog/ConfirmDialog.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fake, resetFake, runEffects, walk, type El } from '../../features/reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../features/reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
import Modal from './Modal';
import { pushDialog, resetDialogStack } from './dialogStack';

type Key = { key: string; shiftKey?: boolean; preventDefault?: () => void; stopPropagation?: () => void };
let listeners: ((e: Key) => void)[] = [];
const press = (key: string) => [...listeners].forEach((fn) => fn({ key }));

beforeEach(() => {
  listeners = [];
  resetDialogStack();
  vi.stubGlobal('window', {
    addEventListener: (_t: string, fn: (e: Key) => void) => { listeners.push(fn); },
    removeEventListener: (_t: string, fn: (e: Key) => void) => { listeners = listeners.filter((l) => l !== fn); },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

/** Monta un Modal (render + efectos) y devuelve su árbol y su «desmontar». */
function mount(onClose: () => void, children: unknown = null) {
  resetFake();
  const tree = Modal({ title: 'T', onClose, children: children as never });
  const cleanups = runEffects();
  return { tree, unmount: () => cleanups.forEach((c) => c()) };
}

describe('Modal: ESC cierra sólo el del tope (doc 105)', () => {
  it('con «Inherit from domain» abierto sobre «New column», ESC cierra sólo el de arriba', () => {
    const closeEditor = vi.fn();
    const closeInherit = vi.fn();
    mount(closeEditor);                 // New column
    const top = mount(closeInherit);    // Inherit from domain, encima
    press('Escape');
    expect(closeInherit).toHaveBeenCalledTimes(1);
    expect(closeEditor).not.toHaveBeenCalled();
    top.unmount();                      // cerrado el de arriba, el siguiente ESC es del editor
    press('Escape');
    expect(closeEditor).toHaveBeenCalledTimes(1);
  });

  it('re-renderizar el de ABAJO (los callers pasan arrows nuevas) no le da el tope', () => {
    const closeEditor = vi.fn();
    const closeInherit = vi.fn();
    mount(closeEditor);
    const editor = { refs: fake.refs, ran: fake.ran };      // estado de hooks del editor
    mount(closeInherit);
    const inherit = { refs: fake.refs, ran: fake.ran };
    fake.refs = editor.refs;                                // re-render del editor con otra arrow
    fake.ran = editor.ran;
    resetFake(null, { keepRefs: true });
    const closeEditor2 = vi.fn();
    Modal({ title: 'T', onClose: closeEditor2, children: null as never });
    runEffects();
    fake.refs = inherit.refs;
    fake.ran = inherit.ran;
    press('Escape');
    expect(closeInherit).toHaveBeenCalledTimes(1);
    expect(closeEditor).not.toHaveBeenCalled();
    expect(closeEditor2).not.toHaveBeenCalled();
  });

  it('un Modal solo cierra con ESC; otras teclas no; desmontado ya no escucha', () => {
    const onClose = vi.fn();
    const m = mount(onClose);
    press('Enter');
    expect(onClose).not.toHaveBeenCalled();
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    m.unmount();
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Modal: Tab no sale del popup (doc 105, F6)', () => {
  it('Tab en el último control vuelve al primero; Shift+Tab en el primero va al último', () => {
    const { tree } = mount(vi.fn());
    const box = [...walk(tree)].find((el: El) => el.props.role === 'dialog')!;
    const onKeyDown = box.props.onKeyDown as ((e: Key) => void) | undefined;
    expect(onKeyDown).toBeTypeOf('function');
    const control = () => ({ focus: vi.fn(), matches: () => false, getClientRects: () => [1] });
    vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' }));
    const first = control();
    const last = control();
    (box.props.ref as { current: unknown }).current = { querySelectorAll: () => [first, last] };
    vi.stubGlobal('document', { activeElement: last });
    const preventDefault = vi.fn();
    onKeyDown!({ key: 'Tab', shiftKey: false, preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(first.focus).toHaveBeenCalled();
    vi.stubGlobal('document', { activeElement: first });
    onKeyDown!({ key: 'Tab', shiftKey: true, preventDefault: vi.fn() });
    expect(last.focus).toHaveBeenCalled();
  });

  it('el popup se anuncia con su título (nombre accesible del diálogo)', () => {
    const { tree } = mount(vi.fn());
    const box = [...walk(tree)].find((el: El) => el.props.role === 'dialog')!;
    expect(box.props['aria-label']).toBe('T');
  });
});

describe('Modal: el foco entra al popup al abrirse (doc 105, F6)', () => {
  it('abierto con el mouse, la caja (tabIndex -1, sin outline) toma el foco; al cerrarse vuelve a quien lo abrió', () => {
    const opener = { isConnected: true, disabled: false, focus: vi.fn(), matches: () => false, closest: () => null };
    const doc: { activeElement: unknown; body: object } = { activeElement: opener, body: {} };
    vi.stubGlobal('document', doc);
    resetFake();
    const tree = Modal({ title: 'New column', onClose: vi.fn(), children: null as never });
    const el = [...walk(tree)].find((e: El) => e.props.role === 'dialog')!;
    expect(el.props.tabIndex).toBe(-1);
    expect((el.props.style as { outline?: string } | undefined)?.outline).toBe('none');
    const box = { focus: vi.fn(() => { doc.activeElement = box; }), contains: (n: unknown) => n === box, matches: () => false };
    (el.props.ref as { current: unknown }).current = box;
    const cleanups = runEffects();
    expect(box.focus).toHaveBeenCalledTimes(1);
    doc.activeElement = doc.body;             // se desmontó con el foco adentro
    cleanups.forEach((c) => c());
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  it('con un control de adentro ya enfocado (autoFocus), no le quita el foco', () => {
    const input = { matches: () => false };
    vi.stubGlobal('document', { activeElement: input, body: {} });
    resetFake();
    const tree = Modal({ title: 'New column', onClose: vi.fn(), children: null as never });
    const el = [...walk(tree)].find((e: El) => e.props.role === 'dialog')!;
    const box = { focus: vi.fn(), contains: (n: unknown) => n === input, matches: () => false };
    (el.props.ref as { current: unknown }).current = box;
    runEffects();
    expect(box.focus).not.toHaveBeenCalled();
  });
});

describe('Modal: con un control autoFocus adentro, el foco igual vuelve a quien lo abrió (doc 105)', () => {
  it('quien abrió se captura en el PRIMER render (antes del commit y del autoFocus)', () => {
    const opener = { isConnected: true, disabled: false, focus: vi.fn(), matches: () => false, closest: () => null };
    const doc: { activeElement: unknown; body: object } = { activeElement: opener, body: {} };
    vi.stubGlobal('document', doc);
    resetFake();
    const tree = Modal({ title: 'New column', onClose: vi.fn(), children: null as never });   // render: foco en quien abrió
    const el = [...walk(tree)].find((e: El) => e.props.role === 'dialog')!;
    const input = { matches: () => false };
    const box = { focus: vi.fn(), contains: (n: unknown) => n === input, matches: () => false };
    (el.props.ref as { current: unknown }).current = box;
    doc.activeElement = input;                // commit: React aplica el autoFocus antes de los efectos
    const cleanups = runEffects();
    expect(box.focus).not.toHaveBeenCalled();
    doc.activeElement = doc.body;             // se desmontó con el foco adentro
    cleanups.forEach((c) => c());
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  it('StrictMode (dev): montaje → limpieza → montaje; al cerrarse igual vuelve a quien lo abrió', () => {
    const opener = { isConnected: true, disabled: false, focus: vi.fn(), matches: () => false, closest: () => null };
    const doc: { activeElement: unknown; body: object } = { activeElement: opener, body: {} };
    vi.stubGlobal('document', doc);
    resetFake();
    const tree = Modal({ title: 'New column', onClose: vi.fn(), children: null as never });
    const el = [...walk(tree)].find((e: El) => e.props.role === 'dialog')!;
    const box = { focus: vi.fn(() => { doc.activeElement = box; }), contains: (n: unknown) => n === box, matches: () => false };
    (el.props.ref as { current: unknown }).current = box;
    runEffects().forEach((c) => c());         // StrictMode: el primer montaje se limpia en el acto…
    fake.ran = [];
    const cleanups = runEffects();            // …y se vuelve a montar (el foco ya está en la caja)
    expect(opener.focus).not.toHaveBeenCalled();
    doc.activeElement = doc.body;
    cleanups.forEach((c) => c());
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });
});

// Doc 105 (R6): con el popup abierto el foco se perdía a <body> (SubcategoryPopup:
// «Remove» + confirmar se lleva la fila con el botón) y Tab salía a la página.
describe('Modal: el foco no se pierde con el popup abierto (doc 105, R6)', () => {
  function openWithFocusInside() {
    const doc: { activeElement: unknown; body: object } = { activeElement: null, body: {} };
    vi.stubGlobal('document', doc);
    resetFake();
    const tree = Modal({ title: 'Subcategory', onClose: vi.fn(), children: null as never });
    const el = [...walk(tree)].find((e: El) => e.props.role === 'dialog')!;
    const save = { matches: (sel: string) => sel === ':disabled' };
    const box = { focus: vi.fn(), contains: (n: unknown) => n === box || n === save, matches: () => false };
    (el.props.ref as { current: unknown }).current = box;
    doc.activeElement = box;
    runEffects();
    box.focus.mockClear();
    return { doc, box, save };
  }

  it('(a) Tab con el foco en <body> lo retoma la caja — sólo si es el popup del tope', () => {
    const { doc, box } = openWithFocusInside();
    doc.activeElement = doc.body;
    const tab = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };
    [...listeners].forEach((fn) => fn(tab));
    expect(tab.preventDefault).toHaveBeenCalled();
    expect(box.focus).toHaveBeenCalledTimes(1);
    pushDialog(Symbol('otro diálogo encima'));
    const tab2 = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };
    [...listeners].forEach((fn) => fn(tab2));
    expect(tab2.preventDefault).not.toHaveBeenCalled();
  });

  it('(c) tras un render con el foco en un botón suyo que pasó a busy, el foco vuelve a la caja', () => {
    const { doc, box, save } = openWithFocusInside();
    doc.activeElement = save;
    resetFake(null, { keepRefs: true });
    Modal({ title: 'Subcategory', onClose: vi.fn(), children: null as never });
    runEffects();
    expect(box.focus).toHaveBeenCalledTimes(1);
  });
});
