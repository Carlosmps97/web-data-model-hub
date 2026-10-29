import { useUndoStore } from '@/store/useUndoStore';

/**
 * La pantalla en espera mientras corre un Undo o un Redo (doc 133 §5): no empieza
 * ninguna edición. Al vigilar la ventana (al montar la app, antes que los
 * widgets) se registran en captura sobre `window` listeners que, mientras corre
 * un paso, se quedan con el teclado y el puntero y cortan a los que siguen
 * (`stopImmediatePropagation`): menús y paneles flotantes no reaccionan a teclas
 * ni clics (la rueda pasa: solo mueve la vista y cierra menús).
 * Miran `busy` en el momento, así que valen desde el mismo cambio del historial,
 * sin esperar el render de la capa visible (`HistoryOverlay`). Lo que dispara el
 * código (un clic sintético que baja un archivo) sigue. El selector de color del
 * sistema (una ventana nativa) queda fuera: aplica al terminar el paso
 * (`whenHistoryIdle`).
 *
 * También lleva la cuenta de los punteros con un botón apretado: con uno (un
 * arrastre en curso, que grabaría al soltar, ya dentro del paso) Undo y Redo no
 * corren (`runHistory`).
 */

/** Atajos del navegador con ⌘/Ctrl que no editan: recargar, cerrar, abrir
 *  pestaña o ventana, la barra de direcciones, salir, minimizar, buscar,
 *  imprimir, copiar, seleccionar todo, zoom y saltar de pestaña. */
const BROWSER_KEYS = /^(?:[rwtnlqmfgpca0-9=+-]|tab)$/i;
/** Lo que empieza una edición con el puntero, el portapapeles o la escritura (el
 *  toque va aparte: su listener es pasivo). */
const BLOCKED = ['pointerdown', 'mousedown', 'click', 'dblclick', 'auxclick', 'contextmenu',
  'dragstart', 'drop', 'paste', 'cut', 'beforeinput'] as const;
/** Lo que dice si hay un botón apretado (el blur que cuenta es el de la ventana:
 *  se escucha aparte, sin captura). */
const POINTER_STATE = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'contextmenu', 'dragend', 'drop'] as const;

/** ¿La tecla se queda durante un Undo o un Redo? Pasan los atajos del navegador
 *  que no editan y F1–F12; todo lo demás (escribir, borrar, flechas, Tab, Esc,
 *  deshacer, pegar) se queda. */
export function heldKey(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
  if (/^F\d{1,2}$/.test(e.key)) return false;
  if (!(e.metaKey || e.ctrlKey)) return true;
  return !BROWSER_KEYS.test(e.key);
}

/** Punteros con un botón apretado. */
const pressed = new Set<number>();
/** ¿Hay un botón apretado? */
export const pointerHeld = (): boolean => pressed.size > 0;

/** Lleva la cuenta de los punteros apretados con los eventos de la ventana (un
 *  movimiento sin botón suelta ese puntero aunque su pointerup haya caído
 *  fuera). El menú contextual, el fin de un arrastre nativo o la ventana sin
 *  foco los sueltan todos. Exportado para los tests. */
export function notePointer(e: { type: string; buttons?: number; pointerId?: number }): void {
  const id = e.pointerId ?? 1;
  if (e.type === 'pointerdown' || e.type === 'pointermove' || e.type === 'pointerup') {
    if (e.buttons) pressed.add(id);
    else pressed.delete(id);
  } else if (e.type === 'pointercancel') pressed.delete(id);
  else pressed.clear();
}

interface Target {
  addEventListener(type: string, fn: (e: Event) => void, opts?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, fn: (e: Event) => void, opts?: boolean | EventListenerOptions): void;
}

/** Vigila la ventana `win`: los punteros apretados siempre y, mientras corre un
 *  Undo o un Redo, el teclado y el puntero. Devuelve con qué soltarla. */
export function watchHistoryWait(win: Target): () => void {
  const opts = { capture: true };
  // El toque, pasivo: uno que no lo es en `window` frena el scroll táctil de toda
  // la página. No se cancela (el clic que sigue sí); solo corta a los que siguen.
  const touch = { capture: true, passive: true };
  /** ¿Lo que llega es del usuario durante un paso? */
  const held = (e: Event) => useUndoStore.getState().busy && e.isTrusted !== false;
  const stopHere = (e: Event) => {
    if (!held(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const onKey = (e: Event) => { if (heldKey(e as KeyboardEvent)) stopHere(e); };
  const onTouch = (e: Event) => { if (held(e)) e.stopImmediatePropagation(); };
  const onBlur = (e: Event) => notePointer(e);
  for (const t of POINTER_STATE) win.addEventListener(t, notePointer, true);
  win.addEventListener('blur', onBlur);
  win.addEventListener('keydown', onKey, opts);
  win.addEventListener('touchstart', onTouch, touch);
  for (const t of BLOCKED) win.addEventListener(t, stopHere, opts);
  return () => {
    for (const t of POINTER_STATE) win.removeEventListener(t, notePointer, true);
    win.removeEventListener('blur', onBlur);
    win.removeEventListener('keydown', onKey, opts);
    win.removeEventListener('touchstart', onTouch, touch);
    for (const t of BLOCKED) win.removeEventListener(t, stopHere, opts);
  };
}
