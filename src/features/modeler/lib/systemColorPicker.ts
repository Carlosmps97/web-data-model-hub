import { useModelerStore } from '@/store/useModelerStore';
import { pinSession } from './sessionGuard';

/**
 * «More colors…» (doc 109): el selector del sistema sobre un <input type="color">
 * PROPIO, fuera de React. Abrirlo le quita el foco a la ventana y el panel que
 * lo ofreció puede cerrarse: el input sigue vivo y aplica lo elegido igual (en
 * Mac el selector del sistema queda abierto y se sigue ajustando). Según el
 * navegador avisa con `input` en cada arrastre y con `change` al cerrarse: se
 * aplica al `change` o tras una pausa sin cambios. Uno a la vez: abrir otro
 * descarta el anterior. Sólo aplica en la sesión y el canvas donde se abrió (el
 * selector del sistema puede seguir abierto mientras el usuario cambia de
 * versión o de canvas) y, doc 112, mientras `alive` lo permita: una ficha del
 * canvas ya cerrada no pinta su caja con lo elegido después.
 */
interface SystemPicker {
  el: HTMLInputElement;
  alive?: () => boolean;
  /** Lo suelta sin aplicar nada más. */
  discard: () => void;
  /** Aplica ya lo elegido que esperaba la pausa (si sigue la sesión) y lo suelta. */
  flushNow: () => void;
}
let systemPicker: SystemPicker | null = null;

export function openSystemPicker(initial: string, at: DOMRect | null, apply: (hex: string) => void,
                                 alive?: () => boolean): void {
  systemPicker?.discard();
  const pin = pinSession();
  const canvas = useModelerStore.getState().activeSaId;
  const sameSession = () => pin.holds() && useModelerStore.getState().activeSaId === canvas;
  const valid = () => sameSession() && (!alive || alive());
  const el = document.createElement('input');
  el.type = 'color';
  el.value = initial.toLowerCase();
  el.tabIndex = -1;
  el.setAttribute('aria-hidden', 'true');
  // Encima del botón pulsado y de su tamaño: el selector del navegador se ancla
  // a la caja del input (debajo de ella, o arriba si no entra).
  Object.assign(el.style, {
    position: 'fixed', left: `${at?.left ?? 0}px`, top: `${at?.top ?? 0}px`,
    width: `${Math.max(1, Math.round(at?.width ?? 1))}px`, height: `${Math.max(1, Math.round(at?.height ?? 1))}px`,
    opacity: '0', border: '0', padding: '0', margin: '0', pointerEvents: 'none',
  });
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let done = false;
  const finish = () => {
    done = true;
    pending = null;
    if (timer) { clearTimeout(timer); timer = null; }
    el.remove();
    if (systemPicker?.el === el) systemPicker = null;
  };
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (done) return;
    if (!valid()) { finish(); return; }
    if (pending) { const v = pending; pending = null; apply(v); }
  };
  const onInput = () => {
    if (done) return;
    pending = el.value.toUpperCase();
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 700);
  };
  el.addEventListener('input', onInput);
  // Al cerrarse el selector se suelta el foco: los atajos (deshacer, borrar)
  // vuelven al canvas, que ignora las teclas que caen en un input.
  el.addEventListener('change', () => { onInput(); flush(); el.blur(); });
  document.body.appendChild(el);
  const flushNow = () => {
    if (done) return;
    const v = pending;
    if (v && sameSession()) apply(v);
    finish();
  };
  systemPicker = { el, alive, discard: finish, flushNow };
  // Doc 112: recién agregado, el input todavía no tiene posición calculada y
  // Chrome abría su selector en la esquina superior izquierda de la pantalla.
  el.getBoundingClientRect();
  el.click();
}

/** Doc 112: quien lo abrió con `alive` se cierra (la ficha del canvas): lo que
 *  ya se había elegido y esperaba la pausa de 700 ms se aplica, y el selector se
 *  suelta — elegir y cerrar enseguida no pierde el último color. Otro selector
 *  (abierto con otro `alive`, o sin él) no se toca. */
export function flushSystemPicker(alive: () => boolean): void {
  if (systemPicker && systemPicker.alive === alive) systemPicker.flushNow();
}

/** Doc 112: quien lo abrió con `alive` se cerró SIN guardar (Cancel de la
 *  ficha): lo elegido no se aplica y el selector se suelta. Otro no se toca. */
export function discardSystemPicker(alive: (() => boolean) | undefined): void {
  if (systemPicker && systemPicker.alive === alive) systemPicker.discard();
}
