// Doc 64 §5 — matcheo del buscador "Locate & center" del toolbar, extraído a
// lógica PURA (testeable sin DOM). "Contiene" case-insensitive (doc 57) sobre
// el nombre lógico/físico de las tablas y el nombre de las vistas del canvas.
// SIN tope acá: el dropdown corta las primeras N; el popup de Enter lista todas.
import { containsCI } from './typePick';

export interface FindMatch {
  id: string;
  kind: 'table' | 'view';
  /** Nombre principal (lógico de la tabla / nombre de la vista). */
  primary: string;
  /** Secundario (físico de la tabla / rótulo 'view'). */
  secondary: string;
}

export function findMatches(
  query: string,
  tables: { id: string; logicalName: string; physicalName: string }[],
  views: { id: string; name: string }[],
): FindMatch[] {
  const q = query.trim();
  if (!q) return [];
  const t = tables
    .filter((x) => containsCI(x.logicalName, q) || containsCI(x.physicalName, q))
    .map((x) => ({ id: x.id, kind: 'table' as const, primary: x.logicalName, secondary: x.physicalName }));
  const v = views
    .filter((x) => containsCI(x.name, q))
    .map((x) => ({ id: x.id, kind: 'view' as const, primary: x.name, secondary: 'view' }));
  return [...t, ...v];
}
