// Orden de columnas (doc 74/81/94): UN solo orden por tabla — `ordinal` — con
// las PK SIEMPRE primero (doc 94 D1: no existe un orden de llave aparte; entre
// PK manda el `ordinal`, como entre las demás). Mismo orden en el modelo lógico
// y en el físico, en el canvas, el panel de propiedades, el Object Inspector,
// el panel de columna, las vistas, el DDL y el store. Helpers PUROS.

export interface ReorderStep<T> { c: T; idx: number }

type Orderable = { ordinal: number; isPrimaryKey?: boolean | null };

/** Columnas por `ordinal` (sort estable; no muta la entrada). */
export function sortByOrdinal<T extends { ordinal: number }>(cols: T[]): T[] {
  return [...cols].sort((a, b) => a.ordinal - b.ordinal);
}

/** Orden ÚNICO de una tabla (doc 94 D1): PRIMERO las PK y después el resto,
 *  cada bloque por `ordinal`. Es exactamente lo que dibuja el canvas. Una tabla
 *  vieja con `ordinal` desordenado (PK con ordinal mayor que una no-PK) se ve
 *  igual PK primero. `cols` debe venir acotado a UNA tabla. Sort estable; no
 *  muta la entrada. */
export function orderColumns<T extends Orderable>(cols: T[]): T[] {
  const pks = sortByOrdinal(cols.filter((c) => !!c.isPrimaryKey));
  const rest = sortByOrdinal(cols.filter((c) => !c.isPrimaryKey));
  return [...pks, ...rest];
}

/** ¿`orderedIds` respeta «PK primero» (doc 94 D3)? Falso si alguna PK queda
 *  debajo de una no-PK. Ids desconocidos se ignoran. */
export function isPkFirst<T extends Orderable & { id: string }>(cols: T[], orderedIds: string[]): boolean {
  const pk = new Map(cols.map((c) => [c.id, !!c.isPrimaryKey]));
  let seenNonPk = false;
  for (const id of orderedIds) {
    if (!pk.has(id)) continue;
    if (!pk.get(id)) seenNonPk = true;
    else if (seenNonPk) return false;
  }
  return true;
}

/** Orden nuevo (ids) cuando `colId` entra a la llave o sale de ella (doc 94
 *  D2) — con el flag `isPrimaryKey` de `cols` YA sin contar a `colId`: queda
 *  justo en la frontera, al FINAL del bloque de PK si entra y PRIMERA entre las
 *  no-PK si sale (es el mismo lugar). El resto conserva su orden único (así
 *  también se normaliza un `ordinal` viejo). Id desconocido ⇒ el orden único. */
export function placeAtKeyBoundary<T extends Orderable & { id: string }>(cols: T[], colId: string): string[] {
  if (!cols.some((c) => c.id === colId)) return orderColumns(cols).map((c) => c.id);
  const others = cols.filter((c) => c.id !== colId);
  const pks = sortByOrdinal(others.filter((c) => !!c.isPrimaryKey)).map((c) => c.id);
  const rest = sortByOrdinal(others.filter((c) => !c.isPrimaryKey)).map((c) => c.id);
  return [...pks, colId, ...rest];
}

/** Doc 94 D2 — ordinales que dejan UNA tabla PK primero tras un cambio de
 *  llave y/o altas: las que entran (`toKey`, en ese orden, existentes o nuevas)
 *  van al final del bloque de PK; las que salen (`fromKey`), primeras entre las
 *  no-PK; las nuevas que no entran a la llave (`add` fuera de `toKey`), al
 *  final. Devuelve SOLO las columnas cuyo ordinal cambia (las nuevas siempre).
 *  Sin cambios, normaliza un `ordinal` viejo desordenado. Puro. */
export function pkFirstOrdinals<T extends Orderable & { id: string }>(
  cols: T[], opts: { toKey?: string[]; fromKey?: string[]; add?: { id: string }[] },
): Map<string, number> {
  const toKey = opts.toKey ?? [];
  const into = new Set(toKey);
  const out = new Set((opts.fromKey ?? []).filter((id) => !into.has(id)));
  const known = new Map(cols.map((c) => [c.id, c]));
  const stays = (c: T) => !into.has(c.id) && !out.has(c.id);
  const order = [
    ...sortByOrdinal(cols.filter((c) => !!c.isPrimaryKey && stays(c))).map((c) => c.id),
    ...toKey,
    ...sortByOrdinal(cols.filter((c) => out.has(c.id))).map((c) => c.id),
    ...sortByOrdinal(cols.filter((c) => !c.isPrimaryKey && stays(c))).map((c) => c.id),
    ...(opts.add ?? []).filter((a) => !into.has(a.id)).map((a) => a.id),
  ];
  const res = new Map<string, number>();
  order.forEach((id, idx) => {
    const c = known.get(id);
    if (!c || c.ordinal !== idx) res.set(id, idx);
  });
  return res;
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
