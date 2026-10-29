// Mientras corre un Undo o un Redo no empieza ninguna edición (doc 133 §5): el
// teclado y el puntero no llegan a la página, desde el mismo cambio de `busy`
// (sin esperar a que se pinte la capa). Pasan los atajos del navegador que no
// editan. Con un botón del mouse apretado (un arrastre en curso, que grabaría al
// soltar), los atajos del historial no hacen nada.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUndoStore } from '@/store/useUndoStore';
import { heldKey, notePointer, pointerHeld, watchHistoryWait } from './historyWait';

type Listener = (e: Event) => void;
/** Una ventana de mentira: los listeners en el orden en que se registraron, con
 *  su fase. `dispatch` es un evento de la ventana (o que le llega burbujeando);
 *  `dispatchCapture`, uno de un elemento que no burbujea (blur): solo lo ven los
 *  de captura. `stopImmediatePropagation` corta a los que siguen. */
function fakeWindow() {
  const listeners: { t: string; fn: Listener; capture: boolean; o: unknown }[] = [];
  const isCapture = (o: unknown) => o === true || (typeof o === 'object' && o !== null && !!(o as { capture?: boolean }).capture);
  const run = (t: string, e: unknown, onlyCapture: boolean) => {
    for (const l of [...listeners]) {
      if (l.t !== t || (onlyCapture && !l.capture)) continue;
      l.fn(e as Event);
      if ((e as { stopped?: boolean }).stopped) return;
    }
  };
  return {
    addEventListener: (t: string, fn: Listener, o?: unknown) => { listeners.push({ t, fn, capture: isCapture(o), o }); },
    removeEventListener: (t: string, fn: Listener, o?: unknown) => {
      const i = listeners.findIndex((l) => l.t === t && l.fn === fn && l.capture === isCapture(o));
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatch: (t: string, e: unknown) => run(t, e, false),
    dispatchCapture: (t: string, e: unknown) => run(t, e, true),
    count: () => listeners.length,
    optionsOf: (t: string) => listeners.filter((l) => l.t === t).map((l) => l.o),
  };
}
const ev = (type: string, over: Record<string, unknown> = {}) => {
  const e = { type, key: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, buttons: 0, pointerId: 1,
    stopped: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(() => { e.stopped = true; }), ...over };
  return e;
};
const blocked = (e: ReturnType<typeof ev>) => e.preventDefault.mock.calls.length > 0 && e.stopImmediatePropagation.mock.calls.length > 0;

describe('pantalla en espera durante un Undo o un Redo', () => {
  let stop: () => void = () => undefined;
  beforeEach(() => { useUndoStore.setState({ busy: false, running: null }); });
  afterEach(() => { stop(); useUndoStore.setState({ busy: false, running: null }); });

  it('mientras corre, el teclado y el puntero no llegan a la página; al terminar, vuelven', () => {
    const win = fakeWindow();
    stop = watchHistoryWait(win);
    const before = ev('keydown', { key: 'Delete' });
    win.dispatch('keydown', before);
    expect(blocked(before)).toBe(false);
    useUndoStore.setState({ busy: true, running: 'undo' });
    for (const [type, over] of [
      ['keydown', { key: 'Delete' }], ['keydown', { key: 'a' }], ['keydown', { key: 'Tab' }], ['keydown', { key: 'Enter' }],
      ['pointerdown', {}], ['mousedown', {}], ['click', {}], ['dblclick', {}], ['auxclick', {}],
      ['contextmenu', {}], ['dragstart', {}], ['drop', {}], ['paste', {}], ['cut', {}], ['beforeinput', {}],
    ] as const) {
      const e = ev(type, over);
      win.dispatch(type, e);
      expect(blocked(e), `${type} ${JSON.stringify(over)}`).toBe(true);
    }
    useUndoStore.setState({ busy: false, running: null });
    const after = ev('click');
    win.dispatch('click', after);
    expect(blocked(after)).toBe(false);
  });

  it('si ya corre un paso al empezar a vigilar, bloquea desde el primer momento', () => {
    useUndoStore.setState({ busy: true, running: 'undo' });
    const win = fakeWindow();
    stop = watchHistoryWait(win);
    const e = ev('click');
    win.dispatch('click', e);
    expect(blocked(e)).toBe(true);
  });

  it('al soltarse (la capa se desmonta) no queda nada enganchado', () => {
    const win = fakeWindow();
    const base = win.count();
    stop = watchHistoryWait(win);
    useUndoStore.setState({ busy: true, running: 'redo' });
    stop();
    stop = () => undefined;
    expect(win.count()).toBe(base);
    const e = ev('keydown', { key: 'a' });
    win.dispatch('keydown', e);
    expect(blocked(e)).toBe(false);
  });

  it('un toque no frena el scroll (listener pasivo): durante el paso solo corta a los que siguen', () => {
    const win = fakeWindow();
    stop = watchHistoryWait(win);
    expect(win.optionsOf('touchstart')).toEqual([{ capture: true, passive: true }]);
    const d3 = vi.fn();
    win.addEventListener('touchstart', d3, true);           // p. ej. el arrastre de d3 en el canvas
    useUndoStore.setState({ busy: true, running: 'undo' });
    const touch = ev('touchstart');
    win.dispatch('touchstart', touch);
    expect([touch.preventDefault.mock.calls.length, touch.stopImmediatePropagation.mock.calls.length, d3.mock.calls.length]).toEqual([0, 1, 0]);
    useUndoStore.setState({ busy: false, running: null });
    win.dispatch('touchstart', ev('touchstart'));
    expect(d3).toHaveBeenCalledTimes(1);
  });

  it('se registra al vigilar, antes que los widgets: lo que estos escuchan en captura no corre durante el paso', () => {
    const win = fakeWindow();
    stop = watchHistoryWait(win);
    const closeMenu = vi.fn();
    win.addEventListener('mousedown', closeMenu, true);   // p. ej. el menú contextual: se cierra con un clic afuera
    useUndoStore.setState({ busy: true, running: 'undo' });
    win.dispatch('mousedown', ev('mousedown'));
    expect(closeMenu).not.toHaveBeenCalled();
    useUndoStore.setState({ busy: false, running: null });
    win.dispatch('mousedown', ev('mousedown'));
    expect(closeMenu).toHaveBeenCalledTimes(1);
  });

  it('lo que dispara el código (un clic sintético que baja un archivo) no se bloquea', () => {
    const win = fakeWindow();
    stop = watchHistoryWait(win);
    useUndoStore.setState({ busy: true, running: 'undo' });
    const download = ev('click', { isTrusted: false });
    win.dispatch('click', download);
    expect(blocked(download)).toBe(false);
  });

  it.each([
    ['⌘Z', { key: 'z', metaKey: true }], ['Ctrl+Y', { key: 'y', ctrlKey: true }], ['⇧⌘Z', { key: 'Z', metaKey: true, shiftKey: true }],
    ['⌘V', { key: 'v', metaKey: true }], ['Ctrl+X', { key: 'x', ctrlKey: true }], ['⌘K', { key: 'k', metaKey: true }],
    ['⌘Enter', { key: 'Enter', metaKey: true }], ['⌘Backspace', { key: 'Backspace', metaKey: true }],
    ['Ctrl+H (borra en un campo en Mac)', { key: 'h', ctrlKey: true }], ['Supr', { key: 'Delete' }], ['flecha', { key: 'ArrowLeft' }],
    ['Esc', { key: 'Escape' }], ['espacio', { key: ' ' }], ['Alt+letra', { key: 'ø', altKey: true }],
  ])('%s se queda', (_l, over) => { expect(heldKey(ev('keydown', over) as never)).toBe(true); });

  it.each([
    ['⌘R', { key: 'r', metaKey: true }], ['Ctrl+R', { key: 'r', ctrlKey: true }], ['F5', { key: 'F5' }], ['⌘W', { key: 'w', metaKey: true }],
    ['⌘T', { key: 't', metaKey: true }], ['⌘L', { key: 'l', metaKey: true }], ['⌘C', { key: 'c', metaKey: true }],
    ['⌘+', { key: '+', metaKey: true }], ['⌘-', { key: '-', metaKey: true }], ['⌘0', { key: '0', metaKey: true }],
    ['⌘1', { key: '1', metaKey: true }], ['Ctrl+Tab', { key: 'Tab', ctrlKey: true }], ['⌘F', { key: 'f', metaKey: true }],
    ['F12', { key: 'F12' }],
  ])('%s pasa (atajo del navegador)', (_l, over) => { expect(heldKey(ev('keydown', over) as never)).toBe(false); });
});

describe('botón del mouse apretado', () => {
  afterEach(() => { notePointer({ type: 'pointerup', buttons: 0 }); });

  it('apretado hasta soltarlo, cancelarlo, abrir el menú contextual o perder la ventana', () => {
    expect(pointerHeld()).toBe(false);
    notePointer({ type: 'pointerdown', buttons: 1 });
    expect(pointerHeld()).toBe(true);
    notePointer({ type: 'pointermove', buttons: 1 });
    expect(pointerHeld()).toBe(true);
    notePointer({ type: 'pointerup', buttons: 0 });
    expect(pointerHeld()).toBe(false);
    for (const type of ['pointercancel', 'contextmenu', 'blur']) {
      notePointer({ type: 'pointerdown', buttons: 1 });
      notePointer({ type });
      expect(pointerHeld(), type).toBe(false);
    }
  });

  it('un movimiento sin botón lo suelta (el pointerup cayó fuera de la ventana)', () => {
    notePointer({ type: 'pointerdown', buttons: 1 });
    notePointer({ type: 'pointermove', buttons: 0 });
    expect(pointerHeld()).toBe(false);
  });

  it('lo sigue la ventana vigilada', () => {
    const win = fakeWindow();
    const stop = watchHistoryWait(win);
    win.dispatch('pointerdown', ev('pointerdown', { buttons: 1 }));
    expect(pointerHeld()).toBe(true);
    win.dispatch('pointerup', ev('pointerup', { buttons: 0 }));
    expect(pointerHeld()).toBe(false);
    win.dispatch('pointerdown', ev('pointerdown', { buttons: 1 }));
    win.dispatch('dragend', ev('dragend'));
    expect(pointerHeld()).toBe(false);
    stop();
  });

  it('el blur de un campo (al apretar sobre un nodo enfocable) no lo suelta; el de la ventana, sí', () => {
    const win = fakeWindow();
    const stop = watchHistoryWait(win);
    win.dispatch('pointerdown', ev('pointerdown', { buttons: 1 }));
    win.dispatchCapture('blur', ev('blur'));
    expect(pointerHeld()).toBe(true);
    win.dispatch('blur', ev('blur'));
    expect(pointerHeld()).toBe(false);
    stop();
  });

  it('con dos punteros, soltar o cancelar uno no suelta el otro', () => {
    notePointer({ type: 'pointerdown', buttons: 1, pointerId: 1 });
    notePointer({ type: 'pointerdown', buttons: 1, pointerId: 2 });
    notePointer({ type: 'pointerup', buttons: 0, pointerId: 2 });
    expect(pointerHeld()).toBe(true);
    notePointer({ type: 'pointerdown', buttons: 1, pointerId: 3 });
    notePointer({ type: 'pointercancel', pointerId: 3 });
    expect(pointerHeld()).toBe(true);
    notePointer({ type: 'pointerup', buttons: 0, pointerId: 1 });
    expect(pointerHeld()).toBe(false);
  });

  it('terminar un arrastre nativo (dragend o drop) lo suelta aunque falte el pointerup', () => {
    for (const type of ['dragend', 'drop']) {
      notePointer({ type: 'pointerdown', buttons: 1, pointerId: 1 });
      notePointer({ type });
      expect(pointerHeld(), type).toBe(false);
    }
  });
});
