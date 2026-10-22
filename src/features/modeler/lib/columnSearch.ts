// Matcher del buscador de columnas de Properties · Columns. Mismo paradigma
// que los combobox de dominio y tipos: "contiene", case-insensitive, contra el
// nombre lógico o el físico. Puro.
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
