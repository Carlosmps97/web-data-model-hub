import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeElementNow, focusInto, isFocusReturn, keepFocusIn, modalOpen, noteKey, recoverTab, tabTarget, trapTab,
} from './focusTrap';

/** Tab no sale de un diálogo (Version tools, confirmaciones, Dialog del sistema
 *  de diseño). */
describe('tabTarget', () => {
  const [box, a, b, c] = ['box', 'a', 'b', 'c'];
  it('Tab en el último vuelve al primero; en el medio sigue el navegador', () => {
    expect(tabTarget([a, b, c], c, box, false)).toBe(a);
    expect(tabTarget([a, b, c], b, box, false)).toBeNull();
  });
  it('Shift+Tab en el primero (o con el foco en el propio diálogo) va al último', () => {
    expect(tabTarget([a, b, c], a, box, true)).toBe(c);
    expect(tabTarget([a, b, c], box, box, true)).toBe(c);
  });
  it('sin controles habilitados, el Tab no sale', () => {
    expect(tabTarget([], box, box, false)).toBe('stay');
  });
});

/** DOM simulado: solo lo que usan estas funciones. `modals` = las cajas
 *  `[aria-modal="true"]` que siguen en pantalla (en orden de documento). */
function dom() {
  const doc: { activeElement: unknown; body: object; modals: unknown[]; querySelectorAll: () => unknown[] } = {
    activeElement: null, body: { tag: 'BODY' }, modals: [], querySelectorAll: () => doc.modals,
  };
  vi.stubGlobal('document', doc);
  type Opts = { inside?: unknown[]; disabled?: boolean; connected?: boolean; dialog?: unknown };
  const node = ({ inside = [], disabled = false, connected = true, dialog = null }: Opts = {}) => {
    const n = {
      isConnected: connected, disabled,
      focus: vi.fn(() => { doc.activeElement = n; }),
      contains: (x: unknown) => x === n || inside.includes(x),
      matches: (sel: string) => sel === ':disabled' && n.disabled,
      // `closest('[aria-modal="true"]')`: la caja del diálogo que lo contiene (aunque haya salido de la pantalla).
      closest: (sel: string) => (sel === '[aria-modal="true"]' ? dialog : null),
      getClientRects: () => (n.isConnected ? [1] : []),
    };
    return n;
  };
  return { doc, node };
}

/** Un Dialog/Modal abierto con el mouse toma el foco: si quedara en la página de
 *  atrás, Tab la recorrería y la trampa nunca actuaría. */
describe('focusInto', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('abierto con el mouse (el foco afuera): la caja toma el foco; al cerrarse con él adentro, vuelve a quien lo abrió', () => {
    const { doc, node } = dom();
    const opener = node();
    const box = node();
    doc.activeElement = opener;
    const restore = focusInto(box as never);
    expect(box.focus).toHaveBeenCalledTimes(1);
    doc.activeElement = doc.body;                   // la caja se desmontó con el foco adentro
    restore();
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  it('StrictMode (dev) corre el efecto dos veces: el segundo ve el foco ya adentro y recuerda a quien abrió', () => {
    const { doc, node } = dom();
    const opener = node();
    const box = node();
    doc.activeElement = opener;
    focusInto(box as never)();                      // montaje + limpieza simulada: el foco sigue en la caja
    expect(opener.focus).not.toHaveBeenCalled();
    const restore = focusInto(box as never);        // re-montaje: el foco ya está adentro
    expect(box.focus).toHaveBeenCalledTimes(1);
    doc.activeElement = doc.body;                   // cierre real
    restore();
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  it('con quien abrió capturado en el render (antes del autoFocus de un control): al cerrarse vuelve a él', () => {
    const { doc, node } = dom();
    const opener = node();
    const input = node();
    const box = node({ inside: [input] });
    doc.activeElement = input;                      // en el commit React ya le dio el foco al autoFocus
    const restore = focusInto(box as never, opener as never);
    expect(box.focus).not.toHaveBeenCalled();       // no se lo quita
    doc.activeElement = doc.body;                   // cierre
    restore();
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  it('activeElementNow: el foco actual, o null sin DOM (SSR / tests en node)', () => {
    expect(activeElementNow()).toBeNull();
    const { doc, node } = dom();
    const el = node();
    doc.activeElement = el;
    expect(activeElementNow()).toBe(el);
  });

  it('un control de adentro ya tiene el foco (un autoFocus): no se lo quita', () => {
    const { doc, node } = dom();
    const input = node();
    const box = node({ inside: [input] });
    doc.activeElement = input;
    focusInto(box as never);
    expect(box.focus).not.toHaveBeenCalled();
  });

  it('al cerrarse no roba el foco: si el usuario lo llevó a otro lado, no lo toca', () => {
    const { doc, node } = dom();
    const box = node();
    const opener = node();
    doc.activeElement = opener;
    const restore = focusInto(box as never);
    doc.activeElement = node();                     // p. ej. un link del TopNav
    restore();
    expect(opener.focus).not.toHaveBeenCalled();
    // abierto sin foco previo (<body>) y sin otro diálogo: no hay a quién devolverlo
    doc.activeElement = doc.body;
    const restore2 = focusInto(box as never);
    doc.activeElement = doc.body;
    expect(() => restore2()).not.toThrow();
  });

  it('quien abrió no sirve (se fue con su fila o está deshabilitado): el foco va al diálogo que sigue abierto', () => {
    const { doc, node } = dom();
    for (const opener of [node({ connected: false }), node({ disabled: true })]) {
      const below = node();                         // p. ej. el Modal «Subcategory» que sigue abierto
      doc.modals = [below];
      const box = node();
      doc.activeElement = opener;
      const restore = focusInto(box as never);
      doc.activeElement = doc.body;
      restore();
      expect(opener.focus).not.toHaveBeenCalled();
      expect(below.focus).toHaveBeenCalledTimes(1);
    }
  });

  it('confirmaciones encadenadas: quien abrió el 2.º estaba en el 1.º (ya cerrado) → vuelve a quien abrió el 1.º', () => {
    const { doc, node } = dom();
    const trigger = node();                         // «Chained…»
    const boxA = node();
    doc.activeElement = trigger;
    focusInto(boxA as never);                       // confirm A: guarda a `trigger` como opener
    (boxA as { isConnected: boolean }).isConnected = false;   // A se cerró…
    const yesA = node({ connected: false, dialog: boxA });    // …y su botón se fue con él
    const boxB = node();
    doc.activeElement = trigger;
    const restoreB = focusInto(boxB as never, yesA as never); // confirm B, abierto desde A
    trigger.focus.mockClear();
    doc.activeElement = doc.body;                   // cierra B
    restoreB();
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });

  it('isFocusReturn: verdadero solo durante la devolución del foco al cerrarse, y solo para ese elemento', () => {
    const { doc, node } = dom();
    const opener = node();
    const other = node();
    const box = node();
    let during: boolean[] = [];
    opener.focus = vi.fn(() => { doc.activeElement = opener; during = [isFocusReturn(opener), isFocusReturn(other)]; });
    doc.activeElement = opener;
    const restore = focusInto(box as never);
    doc.activeElement = doc.body;
    restore();
    expect(during).toEqual([true, false]);          // el onFocus del que lo recibe lo ve (el evento es síncrono)
    expect(isFocusReturn(opener)).toBe(false);       // después, no
  });

  it('quien abrió quedó deshabilitado dentro de un diálogo que sigue abierto: el foco va a esa caja, no detrás de ella', () => {
    const { doc, node } = dom();
    const pageBtn = node();                         // botón de la página, detrás del diálogo de afuera
    const outer = node();                           // el diálogo de afuera: sigue abierto
    doc.activeElement = pageBtn;
    focusInto(outer as never);                      // el de afuera guarda como opener al botón de la página
    const del = node({ disabled: true, dialog: outer });      // su «Delete» está deshabilitado (busy)
    const inner = node();
    const restore = focusInto(inner as never, del as never);  // el confirm que abrió ese «Delete»
    doc.modals = [outer];
    pageBtn.focus.mockClear();
    outer.focus.mockClear();
    doc.activeElement = doc.body;                   // se cierra el confirm
    restore();
    expect(pageBtn.focus).not.toHaveBeenCalled();
    expect(outer.focus).toHaveBeenCalledTimes(1);
  });
});

/** Con el diálogo abierto, el foco puede caer a <body> (un botón que entró en busy o
 *  que desapareció): la caja lo retoma para que Tab no salga a la página. */
describe('recoverTab / keepFocusIn', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('recoverTab: Tab con el foco en <body> (o en un control deshabilitado de la caja) vuelve a la caja', () => {
    const { doc, node } = dom();
    const busyBtn = node({ disabled: true });
    const box = node({ inside: [busyBtn] });
    for (const lost of [doc.body, null, busyBtn]) {
      doc.activeElement = lost;
      const e = { key: 'Tab', preventDefault: vi.fn() };
      recoverTab(e, box as never);
      expect(e.preventDefault).toHaveBeenCalled();
      expect(box.focus).toHaveBeenCalled();
      box.focus.mockClear();
    }
  });

  it('recoverTab: con el foco en un control habilitado, o con otra tecla, no hace nada', () => {
    const { doc, node } = dom();
    const input = node();
    const box = node({ inside: [input] });
    doc.activeElement = input;
    const tab = { key: 'Tab', preventDefault: vi.fn() };
    recoverTab(tab, box as never);
    doc.activeElement = doc.body;
    const enter = { key: 'Enter', preventDefault: vi.fn() };
    recoverTab(enter, box as never);
    expect(tab.preventDefault).not.toHaveBeenCalled();
    expect(enter.preventDefault).not.toHaveBeenCalled();
    expect(box.focus).not.toHaveBeenCalled();
  });

  it('keepFocusIn: tras un render, si el foco quedó en <body> o en un botón de la caja que se deshabilitó, vuelve a la caja', () => {
    const { doc, node } = dom();
    const save = node({ disabled: true });
    const box = node({ inside: [save] });
    for (const lost of [doc.body, save]) {
      doc.activeElement = lost;
      keepFocusIn(box as never);
      expect(box.focus).toHaveBeenCalledTimes(1);
      box.focus.mockClear();
    }
    doc.activeElement = node();                     // afuera y no perdido (p. ej. el TopNav): no se lo quita
    keepFocusIn(box as never);
    expect(box.focus).not.toHaveBeenCalled();
  });
});

/** La trampa no se limita a `.disabled`: también excluye lo deshabilitado por un
 *  `fieldset[disabled]` y lo oculto con `visibility: hidden`. */
describe('trapTab: solo controles habilitados y visibles', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('un control de un fieldset deshabilitado o con visibility:hidden no cuenta', () => {
    const ctrl = (disabled = false, hidden = false) =>
      ({ focus: vi.fn(), hidden, matches: (sel: string) => sel === ':disabled' && disabled, getClientRects: () => [1] });
    const only = ctrl();
    const inFieldset = ctrl(true);                  // `.disabled` es false; `:disabled` por el fieldset
    const ghost = ctrl(false, true);
    vi.stubGlobal('getComputedStyle', (el: { hidden: boolean }) => ({ visibility: el.hidden ? 'hidden' : 'visible' }));
    vi.stubGlobal('document', { activeElement: only });
    const e = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };
    trapTab(e, { querySelectorAll: () => [only, inFieldset, ghost] } as never);
    expect(e.preventDefault).toHaveBeenCalled();    // `only` es el último de verdad: vuelve al primero (él mismo)
    expect(only.focus).toHaveBeenCalled();
  });
});

/** Un Enter que cierra un diálogo en su keydown no devuelve el foco a quien lo
 *  abrió hasta el keyup: si lo devolviera antes de que llegue el keypress de ese
 *  mismo Enter, el keypress «clicaría» al opener (un botón) y se reabriría el
 *  popup de búsqueda o se repetiría Undo. */
describe('focusInto con un Enter en curso', () => {
  afterEach(() => { noteKey({ type: 'keyup', key: 'Enter' }); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('el foco vuelve recién en el keyup del Enter: el keypress de ese Enter no le llega a quien abrió', () => {
    const { doc, node } = dom();
    const opener = node();                          // «Search the model» / «Undo» del toolbar
    const box = node();
    doc.activeElement = opener;
    const restore = focusInto(box as never);
    noteKey({ type: 'keydown', key: 'Enter' });     // Enter en el buscador: Locate cierra el diálogo…
    doc.activeElement = doc.body;
    restore();                                      // …y su limpieza corre dentro de ese keydown
    const keypressTarget = doc.activeElement;       // el keypress que sigue va a quien tiene el foco
    expect(keypressTarget).not.toBe(opener);
    expect(opener.focus).not.toHaveBeenCalled();
    noteKey({ type: 'keyup', key: 'Enter' });
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  it('otra tecla (ESC) no demora la devolución', () => {
    const { doc, node } = dom();
    const opener = node();
    const box = node();
    doc.activeElement = opener;
    const restore = focusInto(box as never);
    noteKey({ type: 'keydown', key: 'Escape' });
    doc.activeElement = doc.body;
    restore();
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  it('al keyup no se lo quita a otro diálogo que lo tomó; si quedó en la caja que contiene a quien abrió, sí vuelve', () => {
    const { doc, node } = dom();
    const other = node();                           // otro diálogo abierto por el mismo Enter
    const opener = node();
    const box = node();
    doc.activeElement = opener;
    const restore = focusInto(box as never);
    noteKey({ type: 'keydown', key: 'Enter' });
    doc.activeElement = doc.body;
    restore();
    doc.activeElement = other;
    noteKey({ type: 'keyup', key: 'Enter' });
    expect(opener.focus).not.toHaveBeenCalled();
    // quien abrió está dentro de un diálogo cuya caja tiene el foco (keepFocusIn)
    const inner = node();
    const outer = { ...node({ inside: [inner] }), matches: (sel: string) => sel === '[aria-modal="true"]' };
    doc.activeElement = inner;
    const restore2 = focusInto(node() as never);
    noteKey({ type: 'keydown', key: 'Enter' });
    doc.activeElement = doc.body;
    restore2();
    doc.activeElement = outer;
    noteKey({ type: 'keyup', key: 'Enter' });
    expect(inner.focus).toHaveBeenCalledTimes(1);
  });

  it('Enter sostenido (autorepeat) más de 1 s: el respaldo espera mientras sigan llegando keydown', () => {
    vi.useFakeTimers();
    const { doc, node } = dom();
    const opener = node();
    doc.activeElement = opener;
    const restore = focusInto(node() as never);
    noteKey({ type: 'keydown', key: 'Enter' });
    doc.activeElement = doc.body;
    restore();
    for (let i = 0; i < 12; i += 1) {               // ~1,2 s de autorepeat
      vi.advanceTimersByTime(100);
      noteKey({ type: 'keydown', key: 'Enter', repeat: true });
    }
    vi.advanceTimersByTime(100);
    expect(opener.focus).not.toHaveBeenCalled();    // devuelto en este punto, el autorepeat lo «clicaría»
    noteKey({ type: 'keyup', key: 'Enter' });
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  it('⌘Enter (macOS no manda el keyup del Enter con ⌘) no deja la marca pegada: el cierre siguiente devuelve al instante', () => {
    const { doc, node } = dom();
    noteKey({ type: 'keydown', key: 'Enter', metaKey: true });   // ⌘Enter en una nota del canvas, sin keyup
    const opener = node();
    doc.activeElement = opener;
    const restore = focusInto(node() as never);
    doc.activeElement = doc.body;                   // ESC / Cancel de un diálogo abierto después
    restore();
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  it('el keyup de Meta también suelta la marca del Enter', () => {
    const { doc, node } = dom();
    const opener = node();
    doc.activeElement = opener;
    const restore = focusInto(node() as never);
    noteKey({ type: 'keydown', key: 'Enter' });
    doc.activeElement = doc.body;
    restore();
    noteKey({ type: 'keyup', key: 'Meta' });
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  it('un diálogo que se abre con una devolución pendiente recuerda a su destino, no a <body>', () => {
    const { doc, node } = dom();
    const apply = node();                           // «Apply…» de la página
    doc.activeElement = apply;
    const restoreConfirm = focusInto(node() as never);   // el confirm lo abrió «Apply…»
    noteKey({ type: 'keydown', key: 'Enter' });     // Enter confirma…
    doc.activeElement = doc.body;
    restoreConfirm();                               // …y la devolución queda pendiente (Enter abajo)
    const modalBox = node();
    const restoreModal = focusInto(modalBox as never, doc.body as never);   // 20 ms después, un Modal: «opener» = <body>
    noteKey({ type: 'keyup', key: 'Enter' });       // al soltar, el Modal tiene el foco: no se lo quita
    expect(apply.focus).not.toHaveBeenCalled();
    doc.activeElement = doc.body;                   // ESC cierra el Modal
    restoreModal();
    expect(apply.focus).toHaveBeenCalledTimes(1);   // vuelve a «Apply…» (no queda en <body>)
  });

  it('un Tab durante la espera (foco en <body>) hace ya la devolución y se queda en quien abrió', () => {
    const { doc, node } = dom();
    const notes = node();                           // «Notes…»
    doc.activeElement = notes;
    const restore = focusInto(node() as never);
    noteKey({ type: 'keydown', key: 'Enter' });     // Enter apretado en el textarea (salto de línea)
    doc.activeElement = doc.body;                   // Close con el mouse: pendiente mientras el Enter siga abajo
    restore();
    expect(notes.focus).not.toHaveBeenCalled();
    const tab = { type: 'keydown', key: 'Tab', preventDefault: vi.fn() };
    noteKey(tab);
    expect(notes.focus).toHaveBeenCalledTimes(1);   // el Tab no salta al inicio de la página
    expect(tab.preventDefault).toHaveBeenCalled();
    // con el foco en otro lado (no perdido), un Tab no toca nada
    const other = node();
    doc.activeElement = other;
    const again = focusInto(node() as never);
    doc.activeElement = doc.body;
    again();
    doc.activeElement = other;
    const tab2 = { type: 'keydown', key: 'Tab', preventDefault: vi.fn() };
    noteKey(tab2);
    expect(tab2.preventDefault).not.toHaveBeenCalled();
  });

  it('sin keyup (la ventana perdió el foco, o pasó más de un segundo), la devolución pendiente igual ocurre', () => {
    vi.useFakeTimers();
    const { doc, node } = dom();
    const opener = node();
    doc.activeElement = opener;
    const restore = focusInto(node() as never);
    noteKey({ type: 'keydown', key: 'Enter' });
    doc.activeElement = doc.body;
    restore();
    noteKey({ type: 'blur' });
    expect(opener.focus).toHaveBeenCalledTimes(1);
    const opener2 = node();
    doc.activeElement = opener2;
    const restore2 = focusInto(node() as never);
    noteKey({ type: 'keydown', key: 'Enter' });
    doc.activeElement = doc.body;
    restore2();
    expect(opener2.focus).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(opener2.focus).toHaveBeenCalledTimes(1);
  });
});

/** El canvas protege sus atajos (⌘Z, ESC) con `modalOpen()`, que ve cualquier
 *  diálogo y no solo `.dmh-backdrop`: con un Dialog abierto (Search, CTAS,
 *  Publish…), ⌘Z no deshace por detrás. */
describe('modalOpen', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('ve cualquier diálogo aria-modal (Dialog, Modal, confirm, prompt) además de un .dmh-backdrop', () => {
    // documento simulado con un Dialog abierto: `.dmh-dialog-backdrop` > `[aria-modal="true"]`
    const present = ['.dmh-dialog-backdrop', '[aria-modal="true"]'];
    vi.stubGlobal('document', { querySelector: (sel: string) => (sel.split(',').some((p) => present.includes(p.trim())) ? {} : null) });
    expect(modalOpen()).toBe(true);
    vi.stubGlobal('document', { querySelector: () => null });
    expect(modalOpen()).toBe(false);
  });

  it('ve también las esperas bloqueantes: «Saving working copy…» (.dmh-busy-overlay) y el Locate (.wk-nav-overlay)', () => {
    for (const present of ['.dmh-busy-overlay', '.wk-nav-overlay']) {
      vi.stubGlobal('document', { querySelector: (sel: string) => (sel.split(',').some((p) => p.trim() === present) ? {} : null) });
      expect(modalOpen()).toBe(true);
    }
  });

  it('ModelerCanvas protege sus atajos de teclado con modalOpen()', () => {
    const src = readFileSync(fileURLToPath(new URL('../../features/modeler/components/ModelerCanvas.tsx', import.meta.url)), 'utf8');
    expect(src).toMatch(/if \(modalOpen\(\)\) return;/);
  });
});
