/**
 * Trampa de Tab de los diálogos: con un popup modal abierto, Tab y Shift+Tab no
 * salen a la página de atrás; del último control vuelven al primero y al revés.
 * Todos los diálogos comparten esta implementación. `tabTarget` es puro
 * (testeable en node, patrón de `dialogStack.ts`); `trapTab` es el `onKeyDown`
 * que lo aplica al DOM.
 */
export const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Adónde va el foco con Tab dentro de `box`: null = que siga el navegador;
 *  'stay' = no hay a dónde (se bloquea el Tab para que no salga). */
export function tabTarget<T>(items: readonly T[], active: T | null, box: T, shift: boolean): T | 'stay' | null {
  if (!items.length) return 'stay';
  const first = items[0];
  const last = items[items.length - 1];
  if (shift && (active === first || active === box)) return last;
  if (!shift && active === last) return first;
  return null;
}

/** Quién abrió cada caja: StrictMode (dev) corre el efecto de montaje dos veces
 *  y el segundo ya encuentra el foco adentro; sin este registro, se perdería
 *  quién abrió. */
const openers = new WeakMap<Element, Element | null>();

/** A quién le está devolviendo el foco un diálogo que se cierra (solo mientras
 *  corre ese `focus()`: el evento `focus` es síncrono). */
let returningTo: Element | null = null;

/** ¿Este foco lo devuelve un diálogo que se cierra, y no el usuario? Lo lee el
 *  `onFocus` de quien lo recibe; así SearchSelect no reabre su menú. */
export const isFocusReturn = (el: unknown): boolean => el != null && el === returningTo;

/** Enter apretado: su keydown ya ocurrió y su keyup no. Un diálogo que se cierra
 *  en ese keydown (Locate del buscador, `promptDialog`…) no devuelve el foco hasta
 *  el keyup: si lo devolviera antes de ese keyup, el keypress del mismo Enter
 *  «clicaría» a quien lo abrió (un botón) y se reabriría el popup o se repetiría
 *  Undo. */
let enterHeld = false;
/** Último keydown del Enter (también los del autorepeat de un Enter sostenido). */
let lastEnterAt = 0;
/** Devoluciones pendientes: a quién (`opener`) y cómo (`give`). */
const afterEnter: { opener: Element | null; give: () => void }[] = [];
const runAfterEnter = () => { afterEnter.splice(0).forEach((p) => p.give()); };
/** El foco está en <body> (o en nada). */
const focusOnBody = () => !document.activeElement || document.activeElement === document.body;

/** Lo llaman los listeners de `window` (keydown/keyup en captura, blur): lleva
 *  la cuenta del Enter y, al soltarlo (o si la ventana pierde el foco), corre
 *  las devoluciones de foco pendientes. Exportado para los tests. */
export function noteKey(e: { type: string; key?: string; metaKey?: boolean; repeat?: boolean; preventDefault?: () => void }): void {
  // Un Tab durante la espera, con el foco en <body>: la devolución se hace ya y
  // el Tab se queda en quien abrió, en vez de saltar al inicio de la página.
  if (e.type === 'keydown' && e.key === 'Tab' && afterEnter.length && typeof document !== 'undefined' && focusOnBody()) {
    runAfterEnter();
    if (!focusOnBody()) e.preventDefault?.();
    return;
  }
  if (e.type === 'keydown' && e.key === 'Enter') {
    // ⌘Enter: en macOS no llega el keyup del Enter mientras ⌘ está apretado (la
    // marca quedaría pegada), y con ⌘ no hay keypress que «clique» nada.
    if (e.metaKey) return;
    enterHeld = true;
    lastEnterAt = Date.now();
    return;
  }
  // El keyup de Meta también la suelta (⌘ soltado con el Enter ya abajo).
  if (e.type === 'blur' || (e.type === 'keyup' && (e.key === 'Enter' || e.key === 'Meta'))) {
    enterHeld = false;
    runAfterEnter();
  }
}

/** Respaldo sin keyup: lo pendiente se devuelve 1 s después del último keydown
 *  del Enter. Con el Enter sostenido el autorepeat sigue llegando y se espera:
 *  si se devolviera antes de ese momento, su keypress repetido «clicaría» a quien
 *  abrió el diálogo. */
function armFallback(ms: number): void {
  setTimeout(() => {
    if (!afterEnter.length) return;
    const wait = lastEnterAt + 1000 - Date.now();
    if (enterHeld && wait > 0) { armFallback(wait); return; }
    enterHeld = false;
    runAfterEnter();
  }, ms);
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('keydown', noteKey, true);
  window.addEventListener('keyup', noteKey, true);
  window.addEventListener('blur', noteKey);
}

/** ¿Hay algo modal en pantalla? Un diálogo (`[aria-modal="true"]`: Dialog,
 *  Modal, confirmaciones, `promptDialog`, Version tools), un scrim `.dmh-backdrop`, o
 *  una espera bloqueante: `.dmh-busy-overlay` («Saving working copy…»,
 *  «Creating table…» — `runBlocking`), `.wk-nav-overlay` (el Locate) y
 *  `.dmh-history-wait` (un Undo o un Redo en curso). Guarda de los atajos de la
 *  página que no deben actuar por detrás. */
const MODAL_SELECTOR = '.dmh-backdrop, [aria-modal="true"], .dmh-busy-overlay, .wk-nav-overlay, .dmh-history-wait';
export function modalOpen(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector(MODAL_SELECTOR);
}

/** El elemento con el foco, o null sin DOM (SSR, tests en node). Los diálogos
 *  lo leen en el render en que se abren, antes de la fase de commit, cuando ningún
 *  `autoFocus` de adentro tomó el foco: así saben quién los abrió. */
export const activeElementNow = (): Element | null =>
  (typeof document === 'undefined' ? null : document.activeElement);

/** Al abrirse un diálogo, el foco entra a su caja (`tabIndex={-1}`): abierto
 *  con el mouse, quedaría en la página de atrás y Tab la recorrería sin que la
 *  trampa actúe. No se lo quita a un control de adentro que ya lo tiene (un
 *  `autoFocus`). Devuelve el «al cerrar»: si el foco está
 *  huérfano en <body> (la caja se desmontó con él adentro), vuelve a quien abrió
 *  el diálogo si sigue en pantalla y habilitado — nunca se lo quita a otro.
 *  `openedFrom`: quién abrió, leído en el render (`activeElementNow`); sin él,
 *  se toma el foco de este momento (con un `autoFocus` no se puede saber). */
export function focusInto(box: HTMLElement | null, openedFrom?: Element | null): () => void {
  if (typeof document === 'undefined' || !box) return () => undefined;
  const active = document.activeElement;
  const inside = box.contains(active);
  let opener = (openedFrom !== undefined ? openedFrom : inside ? openers.get(box) ?? null : active) as HTMLElement | null;
  // Se abre con una devolución pendiente (un Enter aún apretado cerró otro
  // diálogo): el foco está en <body>, pero quien abrió de verdad es el destino
  // pendiente; al cerrarse, el foco vuelve ahí.
  if ((!opener || opener === document.body) && afterEnter.length) {
    opener = afterEnter[afterEnter.length - 1].opener as HTMLElement | null;
  }
  openers.set(box, opener);
  if (!inside) box.focus();
  const giveBack = () => {
    const target = returnTarget(opener);
    if (!target) return;
    // Solo si el foco está huérfano (<body>) o estacionado en la caja de un
    // diálogo que contiene a quien lo recibe (keepFocusIn): nunca se lo quita a otro.
    const now = document.activeElement;
    if (now && now !== document.body && !(now.matches('[aria-modal="true"]') && now.contains(target))) return;
    returningTo = target;
    try { target.focus(); } finally { returningTo = null; }
  };
  return () => {
    const now = document.activeElement;
    if (now && now !== document.body) return;
    if (!enterHeld) { giveBack(); return; }
    // Cerrado por un Enter aún apretado: al keyup (o, sin keyup, en 1 s).
    afterEnter.push({ opener, give: giveBack });
    armFallback(1000);
  };
}

/** ¿Se le puede devolver el foco? En pantalla, habilitado (también por un
 *  `fieldset`) y no es <body>. */
const usable = (el: Element): el is HTMLElement =>
  el !== document.body && el.isConnected && !el.matches(':disabled') && typeof (el as HTMLElement).focus === 'function';

/** Adónde devolver el foco al cerrar: a quien abrió si sigue sirviendo; si no, y
 *  estaba dentro de otro diálogo: si ese sigue abierto, a su caja (quien abrió a
 *  ese está detrás del modal); si ya se cerró (confirmaciones encadenadas), a
 *  quien abrió ese. Si no, al último diálogo modal que sigue en pantalla (quien
 *  abrió se fue con su fila). */
function returnTarget(opener: Element | null): HTMLElement | null {
  const seen = new Set<Element>();
  for (let el = opener; el && el !== document.body && !seen.has(el); ) {
    seen.add(el);
    if (usable(el)) return el;
    const box = el.closest<HTMLElement>('[aria-modal="true"]');
    if (box?.isConnected) return box;
    el = box ? openers.get(box) ?? null : null;
  }
  const open = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].filter((m) => m.getClientRects().length > 0);
  return open[open.length - 1] ?? null;
}

/** ¿El diálogo perdió el foco? Está en <body> (un control suyo desapareció) o
 *  en un control suyo que se deshabilitó (busy). */
function focusLost(box: HTMLElement): boolean {
  const a = document.activeElement;
  return !a || a === document.body || (box.contains(a) && a.matches(':disabled'));
}

/** Tras cada render del diálogo del tope: si perdió el foco (un botón que pasó
 *  a busy o que desapareció), vuelve a la caja; sin esto, el siguiente Tab
 *  saldría a la página de atrás. */
export function keepFocusIn(box: HTMLElement | null): void {
  if (typeof document === 'undefined' || !box) return;
  if (focusLost(box)) box.focus();
}

/** Tab con el foco perdido (ver `focusLost`): lo retoma la caja del diálogo
 *  del tope — el `onKeyDown` de la caja no lo ve (el evento nace en <body>).
 *  Va en el listener de `window` que cada diálogo ya tiene para ESC. */
export function recoverTab(e: { key: string; preventDefault: () => void }, box: HTMLElement | null): void {
  if (e.key !== 'Tab' || typeof document === 'undefined' || !box || !focusLost(box)) return;
  e.preventDefault();
  box.focus();
}

/** Habilitado (`:disabled` también ve un `fieldset[disabled]`) y visible
 *  (con caja y sin `visibility: hidden`). */
const tabbable = (el: HTMLElement): boolean =>
  !el.matches(':disabled') && el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible';

/** `onKeyDown` de un diálogo: Tab no sale de `box`. Cuenta solo controles
 *  habilitados y visibles. */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault: () => void }, box: HTMLElement | null): void {
  if (e.key !== 'Tab' || !box) return;
  const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(tabbable);
  const target = tabTarget(items, document.activeElement as HTMLElement | null, box, e.shiftKey);
  if (target === null) return;
  e.preventDefault();
  if (target !== 'stay') target.focus();
}
