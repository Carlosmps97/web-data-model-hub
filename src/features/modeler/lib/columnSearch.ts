// Matcher del buscador de columnas de Properties · Columns (doc 42). Mismo
// paradigma que los combobox del doc 41: "contiene", case-insensitive,
// contra el nombre LÓGICO o el FÍSICO. Puro.
import { containsCI } from './typePick';

export function matchesColumn(
  c: { logicalName?: string; physicalName?: string },
  query: string,
): boolean {
  const q = query.trim();
  if (!q) return true;
  return (
    (!!c.logicalName && containsCI(c.logicalName, q)) ||
    (!!c.physicalName && containsCI(c.physicalName, q))
  );
}
