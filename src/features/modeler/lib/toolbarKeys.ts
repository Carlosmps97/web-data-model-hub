/**
 * Teclado en la barra del canvas y sus menús de grupo.
 * Puro (los componentes le pasan el evento y los elementos).
 */

/** Enter o Espacio sostenidos repiten la tecla: si cada repetición activara lo
 *  que tiene el foco, el grupo abriría su menú, el foco iría a la 1.ª
 *  herramienta, usarla lo devolvería al grupo… hasta confirmar un Auto-arrange.
 *  En un botón de la barra (`root`) o de sus menús flotantes, la repetición no
 *  activa nada; en un modal (aunque lo abra la barra) o en un campo, sí. */
export function blocksRepeat(
  e: { repeat: boolean; key: string; target: { closest?: (sel: string) => unknown } | null },
  root: { contains: (n: never) => boolean } | null,
): boolean {
  if (!e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return false;
  const t = e.target;
  if (!t?.closest || !t.closest('button')) return false;
  return !!t.closest('.wk-tbpop, .wk-ctxmenu') || !!root?.contains(t as never);
}

/** Tab en los bordes del menú de un grupo (un portal al final de la página: el
 *  foco saltaría lejos). `back`: Shift+Tab en la 1.ª herramienta (o en el menú,
 *  sin herramientas) — vuelve al botón del grupo; `forward`: Tab en la última —
 *  sigue con lo que viene después del grupo en la barra; null: lo hace el navegador. */
export function tabExit<T>(e: { key: string; shiftKey: boolean }, items: readonly T[], active: T | null, panel: T): 'back' | 'forward' | null {
  if (e.key !== 'Tab') return null;
  if (e.shiftKey) return !items.length || active === items[0] || active === panel ? 'back' : null;
  return !items.length || active === items[items.length - 1] ? 'forward' : null;
}

/** Lo que sigue a `from` en `all` (null si es el último o no está). */
export function nextIn<T>(all: readonly T[], from: T): T | null {
  const i = all.indexOf(from);
  return i >= 0 && i + 1 < all.length ? all[i + 1] : null;
}
