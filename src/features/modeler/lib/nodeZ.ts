/**
 * Orden de pintado (zIndex) de un bloque del canvas: el seleccionado al frente
 * (una tabla nueva o importada nace seleccionada: no queda oculta detrás de
 * otra); doc 113 §1.3: lo nuevo de esta sesión (lo que trajo la carga Excel, lo
 * creado, importado o pegado), por delante de lo que ya estaba (sin moverlo),
 * cada tanda encima de las anteriores. Los dibujos van aparte, detrás (−1).
 */

/** Tandas de lo nuevo que se guardan por canvas (`freshNodes`): la más vieja
 *  pinta en 1 y la más nueva en 8, siempre debajo del seleccionado (10). */
export const FRESH_GENERATIONS = 8;

/** Rango de cada bloque nuevo: 0 = la tanda más vieja que se guarda. */
export function freshRanks(generations: readonly (readonly string[])[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  (generations ?? []).forEach((gen, rank) => gen.forEach((id) => out.set(id, rank)));
  return out;
}

export function nodeZ(id: string, selectedId: string | null, ranks: ReadonlyMap<string, number> | undefined): number {
  if (id === selectedId) return 10;
  const rank = ranks?.get(id);
  return rank === undefined ? 0 : 1 + rank;
}
