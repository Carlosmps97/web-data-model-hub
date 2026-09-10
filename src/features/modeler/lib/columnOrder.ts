// Orden de columnas (doc 74/81): UN solo orden de DISPLAY por tabla — bloque de
// llaves primero (orden de llave, `pkPosition`) y el resto por `ordinal`, el
// mismo en el modelo lógico y en el físico. Helpers PUROS que comparten el
// canvas, el panel de propiedades, el Object Inspector, el panel de columna y
// el store, para que NINGUNO diverja del canvas (doc 81: el properties mostraba
// puro `ordinal` y con la carga Excel —PK no primero— se veía distinto). El
// reorden de columnas escribe `ordinal`; el de la LLAVE (`pkPosition`) vive en
// `keyOrder.ts`.
import { sortByKeyOrder } from './keyOrder';

export interface ReorderStep<T> { c: T; idx: number }

/** Columnas por `ordinal` (sort estable; no muta la entrada). */
export function sortByOrdinal<T extends { ordinal: number }>(cols: T[]): T[] {
  return [...cols].sort((a, b) => a.ordinal - b.ordinal);
}

/** Orden ÚNICO de display de una tabla (doc 81): PRIMERO el bloque de llaves,
 *  en orden de llave (`pkPosition`; sin él, por ordinal — ver keyOrder), y
 *  DESPUÉS el resto por `ordinal`. Es exactamente lo que dibuja el canvas
 *  (`TableNode`): la única fuente de verdad del orden visible. `cols` debe venir
 *  acotado a UNA tabla. Sort estable; no muta la entrada. */
export function orderColumns<T extends { ordinal: number; isPrimaryKey?: boolean | null; pkPosition?: number | null }>(cols: T[]): T[] {
  const pks = sortByKeyOrder(cols.filter((c) => !!c.isPrimaryKey));
  const rest = sortByOrdinal(cols.filter((c) => !c.isPrimaryKey));
  return [...pks, ...rest];
}

/** Columnas cuya posición cambia con `orderedIds` (índice nuevo = `ordinal`).
 *  Ids desconocidos se ignoran; sin cambios → []. */
export function reorderPlan<T extends { id: string; ordinal: number }>(cols: T[], orderedIds: string[]): ReorderStep<T>[] {
  const byId = new Map(cols.map((c) => [c.id, c]));
  return orderedIds
    .map((id, idx) => ({ c: byId.get(id), idx }))
    .filter((x): x is ReorderStep<T> => !!x.c && x.c.ordinal !== x.idx);
}

/** Mueve `id` `delta` posiciones (−1 arriba · +1 abajo) dentro de `ids`;
 *  fuera de rango o id ausente → la misma lista. */
export function moveId(ids: string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length || delta === 0) return ids;
  const out = [...ids];
  out.splice(from, 1);
  out.splice(to, 0, id);
  return out;
}

/** Persiste el plan en tandas de `batch` (ráfagas grandes saturan el backend). */
export async function persistReorder<T>(plan: ReorderStep<T>[], save: (c: T, idx: number) => Promise<unknown>, batch = 5): Promise<void> {
  for (let i = 0; i < plan.length; i += batch) {
    await Promise.all(plan.slice(i, i + batch).map(({ c, idx }) => save(c, idx)));
  }
}
