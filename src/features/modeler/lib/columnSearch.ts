// Matcher del buscador de columnas de Properties · Columns (doc 42). Mismo
// paradigma que los combobox del doc 41: "empieza por", case-insensitive,
// contra el nombre LÓGICO o el FÍSICO. Puro.
import { startsWithCI } from './typePick';

export function matchesColumn(
  c: { logicalName?: string; physicalName?: string },
  query: string,
): boolean {
  const q = query.trim();
  if (!q) return true;
  return (
    (!!c.logicalName && startsWithCI(c.logicalName, q)) ||
    (!!c.physicalName && startsWithCI(c.physicalName, q))
  );
}
