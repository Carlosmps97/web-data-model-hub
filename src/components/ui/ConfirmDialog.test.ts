// ConfirmDialog sin DOM (hooks de mentira: ver reporting/components/fakeReact.testutil).
// Doc 105 (F6): ocupado (busy) deshabilita sus dos botones — el foco caía a
// <body> y Tab iba a la página de atrás mientras la acción seguía en curso.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, resetFake, runEffects, textOf, walk, type El } from '../../features/reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../features/reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
import ConfirmDialog from './ConfirmDialog';
import { isTopDialog, pushDialog, resetDialogStack } from './dialogStack';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (t: number) => clearTimeout(t),
  });
  vi.stubGlobal('document', { activeElement: null, body: {} });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function render(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  resetFake();
  const tree = ConfirmDialog({
    open: true, title: 'Delete version v3', message: 'Sure?', confirmLabel: 'Delete version',
    onConfirm: vi.fn(), onCancel: vi.fn(), ...props,
  });
  return { tree, box: [...walk(tree)].find((e: El) => e.props.role === 'dialog')! };
}
const setRef = (el: El, current: unknown) => { (el.props.ref as { current: unknown }).current = current; };

describe('ConfirmDialog ocupado: el foco no sale del diálogo (doc 105, F6)', () => {
  it('al confirmar, la caja (tabIndex -1, sin outline) toma el foco ANTES de pasar a busy', () => {
    const calls: string[] = [];
    const { tree, box } = render({ onConfirm: vi.fn(() => { calls.push('onConfirm → busy'); }) });
    expect(box.props.tabIndex).toBe(-1);
    expect((box.props.style as { outline?: string }).outline).toBe('none');
    setRef(box, { focus: vi.fn(() => { calls.push('focus box'); }) });
    (byText(tree, 'button', 'Delete version').props.onClick as () => void)();
    expect(calls).toEqual(['focus box', 'onConfirm → busy']);
  });

  it('el foco inicial sigue en su botón: confirm por defecto, cancel en lo irreversible', () => {
    for (const initialFocus of ['confirm', 'cancel'] as const) {
      const { tree } = render({ initialFocus });
      const focus = { confirm: vi.fn(), cancel: vi.fn() };
      setRef(byText(tree, 'button', 'Delete version'), { focus: focus.confirm });
      setRef(byText(tree, 'button', 'Cancel'), { focus: focus.cancel });
      const cleanups = runEffects();
      vi.advanceTimersByTime(30);
      expect(focus[initialFocus]).toHaveBeenCalledTimes(1);
      expect(focus[initialFocus === 'confirm' ? 'cancel' : 'confirm']).not.toHaveBeenCalled();
      cleanups.forEach((c) => c());
    }
  });
});

// Doc 105 (F6): al cerrarse, el confirm no devolvía el foco: sobre un Dialog o
// un Modal lo dejaba en <body> y Tab escapaba a la página de atrás.
describe('ConfirmDialog: al cerrarse, el foco vuelve a quien lo abrió (doc 105, F6)', () => {
  const opener = () => ({ isConnected: true, disabled: false, focus: vi.fn(), matches: () => false, closest: () => null });

  it('montado abierto (confirmDialog / DialogHost): entra a la caja y, al cerrarse, vuelve a quien lo abrió', () => {
    const btn = opener();
    const doc: { activeElement: unknown; body: object } = { activeElement: btn, body: {} };
    vi.stubGlobal('document', doc);
    const { box } = render();                          // primer render: el foco es de quien lo abrió
    const fakeBox = { focus: vi.fn(() => { doc.activeElement = fakeBox; }), contains: (n: unknown) => n === fakeBox, matches: () => false };
    setRef(box, fakeBox);
    const cleanups = runEffects();
    expect(fakeBox.focus).toHaveBeenCalledTimes(1);   // sin esperar los 30 ms del botón
    doc.activeElement = doc.body;                      // se desmontó con el foco adentro
    cleanups.forEach((c) => c());
    expect(btn.focus).toHaveBeenCalledTimes(1);
  });

  it('montado cerrado y abierto después (ProfileManagerModal): al pasar a open=false también vuelve', () => {
    const btn = opener();
    const doc: { activeElement: unknown; body: object } = { activeElement: null, body: {} };
    vi.stubGlobal('document', doc);
    const props = {
      title: 'Delete upload profile', message: 'Sure?', confirmLabel: 'Delete', onConfirm: vi.fn(), onCancel: vi.fn(),
    };
    resetFake();
    ConfirmDialog({ ...props, open: false });
    runEffects();
    doc.activeElement = btn;                           // el usuario pulsa «Delete» en la tabla
    resetFake(null, { keepRefs: true });
    const tree = ConfirmDialog({ ...props, open: true });
    const fakeBox = { focus: vi.fn(() => { doc.activeElement = fakeBox; }), contains: (n: unknown) => n === fakeBox, matches: () => false };
    setRef([...walk(tree)].find((e: El) => e.props.role === 'dialog')!, fakeBox);
    runEffects();
    doc.activeElement = doc.body;
    resetFake(null, { keepRefs: true });
    ConfirmDialog({ ...props, open: false });          // Cancel
    runEffects();
    expect(btn.focus).toHaveBeenCalledTimes(1);
  });
});

// Doc 105 (R6): el confirm no estaba en la pila de diálogos — un Tab con el foco
// perdido no lo retomaba nadie (el Dialog de abajo se creía el tope).
describe('ConfirmDialog en la pila de diálogos (doc 105, R6)', () => {
  it('abierto es el tope (el Dialog de abajo deja de serlo) y Tab con el foco en <body> vuelve a su caja', () => {
    resetDialogStack();
    const below = Symbol('Dialog de abajo');
    pushDialog(below);
    const listeners: ((e: unknown) => void)[] = [];
    vi.stubGlobal('window', {
      addEventListener: (_t: string, fn: (e: unknown) => void) => { listeners.push(fn); }, removeEventListener: vi.fn(),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (t: number) => clearTimeout(t),
    });
    const doc: { activeElement: unknown; body: object; querySelectorAll: () => unknown[] } = { activeElement: null, body: {}, querySelectorAll: () => [] };
    vi.stubGlobal('document', doc);
    const { box } = render();
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
});

// Doc 105 (R11): el mensaje no era la descripción accesible del confirm (el lector
// sólo decía el título) y el id del título era fijo — dos confirms a la vez (el
// inline de un Dialog y el del DialogHost) compartían «confirm-dialog-title».
describe('ConfirmDialog: nombre y descripción accesibles (doc 105, R11)', () => {
  it('la caja se nombra con su título y se describe con su mensaje, con ids propios', () => {
    const { tree, box } = render({ message: 'The column CODIGO will be deleted.' });
    const h3 = [...walk(tree)].find((e: El) => e.type === 'h3')!;
    expect(h3.props.id).toBeTruthy();
    expect(h3.props.id).not.toBe('confirm-dialog-title');
    expect(box.props['aria-labelledby']).toBe(h3.props.id);
    expect(box.props['aria-describedby']).toBeTruthy();
    const described = [...walk(tree)].find((e: El) => e.props.id === box.props['aria-describedby'])!;
    expect(textOf(described)).toBe('The column CODIGO will be deleted.');
  });
});
