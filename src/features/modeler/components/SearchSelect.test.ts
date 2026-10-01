// SearchSelect sin DOM (hooks de mentira: ver features/reporting/components/fakeReact.testutil).
// Doc 105 (R6): elegir (Enter / clic) o ESC con el menú abierto hacían `blur()`
// del input — DENTRO de un Dialog/Modal el foco quedaba en <body> y Tab salía a
// la página de atrás. Y «+ Create schema…» hacía `blur()` ANTES de abrir su
// diálogo: el diálogo nuevo recordaba <body> como quien lo abrió y, al
// cerrarse, el foco se perdía.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextStates, resetFake, runEffects, walk, type El } from '../../reporting/components/fakeReact.testutil';

vi.mock('react', async (orig) => (await import('../../reporting/components/fakeReact.testutil')).fakeReact(await orig<object>()));
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
import SearchSelect from './SearchSelect';
import { focusInto } from '@/components/ui/focusTrap';

type Props = Parameters<typeof SearchSelect>[0];
let props: Props;
/** Input de mentira: `closest('[aria-modal="true"]')` dice si está dentro de un diálogo. */
let fakeInput: { blur: ReturnType<typeof vi.fn>; closest: (sel: string) => unknown; getBoundingClientRect: () => object };

function render(rerender = false) {
  const next = rerender ? nextStates() : null;
  resetFake(next ? (_init, i) => next[i] : null, { keepRefs: rerender });
  const tree = SearchSelect(props);
  const el = inputOf(tree);
  (el.props.ref as { current: unknown }).current = fakeInput;
  runEffects();
  return tree;
}
const inputOf = (tree: unknown) => [...walk(tree)].find((e: El) => e.type === 'input')!;
const key = (tree: unknown, k: string) =>
  (inputOf(tree).props.onKeyDown as (e: unknown) => void)({ key: k, preventDefault: vi.fn(), stopPropagation: vi.fn() });
const focus = (tree: unknown, relatedTarget: unknown) =>
  (inputOf(tree).props.onFocus as (e: unknown) => void)({ relatedTarget, currentTarget: fakeInput });
/** Un diálogo que se abre con el foco en el combo y, al cerrarse, se lo devuelve
 *  con el mecanismo REAL (`focusInto`): el `focus()` del input dispara su onFocus. */
function nestedDialogCloses(tree: unknown) {
  const doc: { activeElement: unknown; body: object; querySelectorAll: () => unknown[] } = { activeElement: null, body: {}, querySelectorAll: () => [] };
  vi.stubGlobal('document', doc);
  const onFocus = inputOf(tree).props.onFocus as (e: unknown) => void;
  const combo = Object.assign(fakeInput, {
    isConnected: true, matches: () => false,
    focus: vi.fn(() => { doc.activeElement = combo; onFocus({ currentTarget: combo, relatedTarget: null }); }),
  });
  const box = { focus: vi.fn(() => { doc.activeElement = box; }), contains: (n: unknown) => n === box, matches: () => false };
  doc.activeElement = combo;
  const restore = focusInto(box as never);          // se abre: recuerda al combo
  doc.activeElement = doc.body;                     // ESC: se desmonta con el foco adentro
  restore();                                        // le devuelve el foco al combo
  expect(combo.focus).toHaveBeenCalledTimes(1);
}
/** Abre el menú como lo hace el usuario al entrar con Tab (foco desde otro control). */
function openMenu() {
  let tree = render();
  focus(tree, { from: 'otro control' });
  tree = render(true);
  expect(inputOf(tree).props['aria-expanded']).toBe(true);
  return tree;
}

beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), innerHeight: 800, innerWidth: 1200 });
  vi.stubGlobal('document', { body: {} });            // el menú va por portal a document.body
  props = {
    options: [{ value: 'a', label: 'alpha' }, { value: 'b', label: 'beta' }],
    valueLabel: 'alpha', onPick: vi.fn(), ariaLabel: 'Domain',
  };
});
afterEach(() => { vi.unstubAllGlobals(); });

const inside = (dialog: boolean) => {
  fakeInput = {
    blur: vi.fn(),
    closest: (sel: string) => (dialog && sel === '[aria-modal="true"]' ? { role: 'dialog' } : null),
    getBoundingClientRect: () => ({ left: 10, top: 10, bottom: 40, width: 200 }),
  };
};

describe('SearchSelect dentro de un diálogo: elegir o ESC no sacan el foco del input (doc 105, R6)', () => {
  it('Enter elige y cierra el menú SIN blur (el foco queda en el input, adentro del diálogo)', () => {
    inside(true);
    let tree = openMenu();
    key(tree, 'Enter');
    expect(props.onPick).toHaveBeenCalledWith('a');
    expect(fakeInput.blur).not.toHaveBeenCalled();
    tree = render(true);
    expect(inputOf(tree).props['aria-expanded']).toBe(false);
  });

  it('ESC con el menú abierto lo cierra SIN blur; ↓ con el menú cerrado lo vuelve a abrir', () => {
    inside(true);
    let tree = openMenu();
    key(tree, 'Escape');
    expect(fakeInput.blur).not.toHaveBeenCalled();
    tree = render(true);
    expect(inputOf(tree).props['aria-expanded']).toBe(false);
    key(tree, 'ArrowDown');                         // con el foco en el input, el teclado lo reabre
    tree = render(true);
    expect(inputOf(tree).props['aria-expanded']).toBe(true);
  });

  it('fuera de un diálogo nada cambia: elegir y ESC siguen soltando el foco', () => {
    inside(false);
    let tree = openMenu();
    key(tree, 'Enter');
    expect(fakeInput.blur).toHaveBeenCalledTimes(1);
    tree = openMenu();
    key(tree, 'Escape');
    expect(fakeInput.blur).toHaveBeenCalledTimes(2);
  });
});

describe('SearchSelect: el foco que devuelve un diálogo al cerrarse no reabre el menú (doc 105)', () => {
  it('elegir abre un diálogo anidado («Inherit from domain»); al cerrarlo, el combo recibe el foco SIN menú', () => {
    inside(true);
    let tree = openMenu();
    key(tree, 'Enter');                             // elige: el padre abre «Inherit from domain»
    tree = render(true);
    nestedDialogCloses(tree);
    tree = render(true);
    expect(inputOf(tree).props['aria-expanded']).toBe(false);   // el siguiente ESC cierra el diálogo de afuera
    focus(tree, { from: 'otro control' });          // un foco del usuario (Tab desde otro control) sí lo abre
    tree = render(true);
    expect(inputOf(tree).props['aria-expanded']).toBe(true);
  });
});

describe('SearchSelect: la acción del pie («+ Create schema…») (doc 105, R6)', () => {
  it('corre SIN blur previo (el diálogo que abre sabe quién lo abrió) y el foco que vuelve no reabre el menú', () => {
    inside(true);
    const onRun = vi.fn();
    props = { ...props, action: { label: (q) => `+ Create schema "${q}"`, onRun } };
    let tree = openMenu();
    (inputOf(tree).props.onChange as (e: unknown) => void)({ target: { value: 'stg_x' } });
    tree = render(true);                            // sin coincidencias: la acción queda resaltada
    key(tree, 'Enter');
    expect(onRun).toHaveBeenCalledWith('stg_x');
    expect(fakeInput.blur).not.toHaveBeenCalled();
    tree = render(true);
    nestedDialogCloses(tree);                       // «New schema» se cierra y le devuelve el foco
    tree = render(true);
    expect(inputOf(tree).props['aria-expanded']).toBe(false);
    focus(tree, { from: 'otro control' });          // más tarde, el usuario vuelve con Tab: se abre
    tree = render(true);
    expect(inputOf(tree).props['aria-expanded']).toBe(true);
  });

  it('fuera de un diálogo la acción tampoco hace blur antes de abrir el suyo', () => {
    inside(false);
    const onRun = vi.fn();
    props = { ...props, action: { label: () => '+ Create schema…', onRun } };
    let tree = openMenu();
    key(tree, 'ArrowDown'); tree = render(true);
    key(tree, 'ArrowDown'); tree = render(true);   // alpha → beta → la acción
    key(tree, 'Enter');
    expect(onRun).toHaveBeenCalledWith('');
    expect(fakeInput.blur).not.toHaveBeenCalled();
  });
});

// Doc 105 (R11): con el foco en el input y el menú cerrado (tras elegir en un
// diálogo, o tras la acción del pie), lo tipeado se perdía — el input mostraba
// el valor elegido y sólo ↓/↑ reabrían el menú.
describe('SearchSelect con el foco y el menú cerrado: tipear abre el menú y busca (doc 105, R11)', () => {
  const press = (tree: unknown, e: Record<string, unknown>) => {
    const ev = { preventDefault: vi.fn(), stopPropagation: vi.fn(), ...e };
    (inputOf(tree).props.onKeyDown as (x: unknown) => void)(ev);
    return ev;
  };
  function pickedInDialog() {
    inside(true);
    let tree = openMenu();
    key(tree, 'Enter');                             // elige UDV: menú cerrado, foco en el input
    tree = render(true);
    expect(inputOf(tree).props['aria-expanded']).toBe(false);
    return tree;
  }

  it('una letra abre el menú SIN preventDefault: el navegador la escribe en la búsqueda', () => {
    let tree = pickedInDialog();
    const ev = press(tree, { key: 'S' });
    expect(ev.preventDefault).not.toHaveBeenCalled();
    tree = render(true);
    expect(inputOf(tree).props['aria-expanded']).toBe(true);
    expect(inputOf(tree).props.value).toBe('');     // ya muestra la búsqueda: ahí cae la «S»
    (inputOf(tree).props.onChange as (x: unknown) => void)({ target: { value: 'S' } });
    tree = render(true);
    expect(inputOf(tree).props.value).toBe('S');
  });

  it('Backspace y Delete también lo abren; un atajo con ⌘/Ctrl, no', () => {
    for (const k of ['Backspace', 'Delete']) {
      let tree = pickedInDialog();
      press(tree, { key: k });
      tree = render(true);
      expect(inputOf(tree).props['aria-expanded']).toBe(true);
    }
    for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
      let tree = pickedInDialog();
      press(tree, { key: 'z', ...mod });
      tree = render(true);
      expect(inputOf(tree).props['aria-expanded']).toBe(false);
    }
  });

  it('fuera de un diálogo, tras la acción del pie (el foco quedó en el input): tipear lo abre', () => {
    inside(false);
    props = { ...props, action: { label: () => '+ Create schema…', onRun: vi.fn() } };
    let tree = openMenu();
    key(tree, 'ArrowDown'); tree = render(true);
    key(tree, 'ArrowDown'); tree = render(true);
    key(tree, 'Enter');                             // la acción: menú cerrado, foco en el input
    tree = render(true);
    press(tree, { key: 'x' });
    tree = render(true);
    expect(inputOf(tree).props['aria-expanded']).toBe(true);
  });
});

// Doc 105 (R14): con el menú cerrado, lo que NO entra por un keydown imprimible
// —pegar, IME/teclas muertas, dictado, AltGr— se perdía (el input mostraba el
// valor elegido y el menú no se abría).
describe('SearchSelect con el menú cerrado: pegar, IME, dictado y AltGr también abren (doc 105, R14)', () => {
  function pickedInDialog() {
    inside(true);
    let tree = openMenu();
    key(tree, 'Enter');
    tree = render(true);
    expect(inputOf(tree).props['aria-expanded']).toBe(false);
    return tree;
  }
  const fire = (tree: unknown, prop: string, e: Record<string, unknown> = {}) =>
    (inputOf(tree).props[prop] as (x: unknown) => void)({ preventDefault: vi.fn(), stopPropagation: vi.fn(), ...e });

  it('pegar, el inicio de una composición (IME / tecla muerta) y el texto dictado abren el menú', () => {
    for (const prop of ['onPaste', 'onCompositionStart', 'onBeforeInput']) {
      let tree = pickedInDialog();
      fire(tree, prop);
      tree = render(true);
      expect(inputOf(tree).props['aria-expanded']).toBe(true);
    }
  });

  it('AltGr (Ctrl+Alt en Windows) escribe: abre; un atajo con Ctrl+Alt sin AltGr, no', () => {
    let tree = pickedInDialog();
    fire(tree, 'onKeyDown', { key: '@', ctrlKey: true, altKey: true, getModifierState: (m: string) => m === 'AltGraph' });
    tree = render(true);
    expect(inputOf(tree).props['aria-expanded']).toBe(true);
    tree = pickedInDialog();
    fire(tree, 'onKeyDown', { key: 'k', ctrlKey: true, altKey: true, getModifierState: () => false });
    tree = render(true);
    expect(inputOf(tree).props['aria-expanded']).toBe(false);
  });
});
