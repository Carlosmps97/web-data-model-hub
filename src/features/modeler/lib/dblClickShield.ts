/**
 * Escudo del doble clic sobre una tabla.
 * Un clic en una tabla (o en una de sus filas) la selecciona y el canvas se
 * mueve enseguida para encuadrarla; el 2.º clic de un doble clic, rápido o
 * lento, caería entonces sobre otra cosa (el fondo, otra tabla, un wire, un
 * dibujo) y haría lo suyo (deseleccionar, elegir otra tabla, abrir el popup de
 * la relación, el zoom del fondo) o cortaría el encuadre a medio camino. Se lo
 * ataja en la captura del canvas, antes que React Flow y React: el navegador
 * dice cuál es (`detail` ≥ 2: mismo lugar, dentro del tiempo del sistema) y acá
 * se exige, además, que el 1.er clic haya encuadrado (`arm`), a unos píxeles de
 * él y poco después. Solo el botón principal; los demás gestos pasan.
 */

/** Píxeles de pantalla desde el 1.er clic (el umbral del sistema es menor). */
const RADIUS = 8;
/** Milisegundos desde el 1.er clic (el doble clic del sistema: ~500). */
const WINDOW = 650;

export interface ShieldEvent {
  type: string; detail: number; button: number; clientX: number; clientY: number;
  stopPropagation(): void; preventDefault(): void;
}

export function createDblClickShield(now: () => number = () => performance.now()) {
  let first: { x: number; y: number; t: number } | null = null;
  let armedAt = -Infinity;
  return {
    /** El clic que se está atendiendo encuadró una tabla. */
    arm(): void { armedAt = now(); },
    /** Captura de mousedown / mouseup / click / dblclick del canvas. */
    handle(e: ShieldEvent): void {
      if (e.button !== 0) return;
      if (e.detail < 2) {
        if (e.type === 'click') first = { x: e.clientX, y: e.clientY, t: now() };
        return;
      }
      if (!first || armedAt < first.t || now() - first.t > WINDOW
        || Math.hypot(e.clientX - first.x, e.clientY - first.y) > RADIUS) return;
      e.stopPropagation();
      if (e.type !== 'mouseup') e.preventDefault();
    },
  };
}

/** Eventos que el escudo mira (en la captura del canvas). */
export const SHIELD_EVENTS = ['mousedown', 'mouseup', 'click', 'dblclick'] as const;

/** El del canvas abierto: lo arma `frameTable` tras un clic; lo instala ModelerCanvas. */
export const dblClickShield = createDblClickShield();
