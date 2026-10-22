/**
 * searchSelectNav — navegación por teclado del menú de SearchSelect, pura.
 * `count` = opciones visibles; la fila de acción, si existe, ocupa el índice
 * `count`. Sin acción, solo se navega entre las opciones.
 */

/** ↓ (`dir` 1) / ↑ (`dir` -1): nunca baja de 0 ni pasa del último ítem. */
export function moveHighlight(hi: number, dir: 1 | -1, count: number, hasAction: boolean): number {
  if (dir === -1) return Math.max(hi - 1, 0);
  return Math.min(hi + 1, count - (hasAction ? 0 : 1));
}

/** Qué elige Enter con el ítem resaltado `hi`. */
export function enterTarget(hi: number, count: number, hasAction: boolean): 'option' | 'action' | 'none' {
  if (hasAction && hi === count) return 'action';
  return hi >= 0 && hi < count ? 'option' : 'none';
}
