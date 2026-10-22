/**
 * Dónde va la barra de formato de un dibujo (`NodeToolbar` de
 * React Flow, que no se acomoda sola): arriba del dibujo, salvo que su borde
 * superior quede tan cerca del borde superior del canvas que la barra se
 * cortaría — entonces va abajo. Puro.
 */

/** Alto que necesita la barra sobre el dibujo: la barra (~40 px), su
 *  separación (12 px) y un poco de aire. */
export const DRAWING_TOOLBAR_ROOM = 60;

/** `top`/`bottom`: bordes del dibujo en píxeles del canvas; `paneHeight`: alto
 *  del canvas. Abajo solo si arriba no entra y abajo sí (con un dibujo grande
 *  que se sale por abajo, la barra quedaría invisible). */
export function drawingToolbarSide(topOnScreen: number, bottomOnScreen: number, paneHeight: number,
  room = DRAWING_TOOLBAR_ROOM): 'top' | 'bottom' {
  return topOnScreen < room && paneHeight - bottomOnScreen >= room ? 'bottom' : 'top';
}

/** Borde superior de un nodo en píxeles del canvas: `transform` = [x, y, zoom] del viewport. */
export function nodeTopOnScreen(flowY: number, transform: readonly [number, number, number]): number {
  return flowY * transform[2] + transform[1];
}
