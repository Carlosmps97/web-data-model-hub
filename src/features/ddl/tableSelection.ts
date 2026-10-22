/** Tablas elegidas en «Tables to export» del Export DDL: sin una elección
 *  explícita no hay ninguna; una elección conserva solo las tablas que siguen
 *  en el canvas. */
export function pickedTableIds(selected: ReadonlySet<string> | null, allIds: readonly string[]): Set<string> {
  if (!selected) return new Set();
  const all = new Set(allIds);
  return new Set([...selected].filter((id) => all.has(id)));
}
