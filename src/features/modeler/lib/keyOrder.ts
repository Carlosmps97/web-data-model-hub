/**
 * Utilidades PURAS del orden de la LLAVE primaria (`pkPosition`, doc 19 §12b).
 *
 * Dos órdenes conviven por tabla (paridad Erwin): el de COLUMNAS (`ordinal`,
 * único para ambas facetas — panel y columnas del CREATE; `lib/columnOrder`)
 * y el de la LLAVE (`pkPosition` — bloque PK del canvas y `PRIMARY KEY(...)`
 * del DDL). Reglas:
 *  - pkPosition existe cuando el orden de llave es EXPLÍCITO (migración Erwin
 *    o llave reordenada en la plataforma); sin él, la llave sigue el `ordinal`.
 *  - Entrar a la llave = agregarse AL FINAL del orden explícito (si lo hay).
 *  - Reordenar la llave NORMALIZA todas las posiciones (0..k-1).
 */
import type { CanonicalColumn } from '@/services/governance.service';

type KeySortable = { pkPosition?: number | null; ordinal: number };

/** Orden de LLAVE: pkPosition primero; sin posición (PK a mano) cae al
 *  ordinal, después de las explícitas. Sort estable. */
export function sortByKeyOrder<T extends KeySortable>(pks: T[]): T[] {
  return [...pks].sort((a, b) =>
    ((a.pkPosition ?? Number.MAX_SAFE_INTEGER) - (b.pkPosition ?? Number.MAX_SAFE_INTEGER))
    || (a.ordinal - b.ordinal));
}

/** PKs de la tabla en orden de llave. `cols` debe venir acotado a UNA tabla.
 *  Genérico (doc 81): lo usan `orderColumns` y tests con formas mínimas, no sólo
 *  `CanonicalColumn`. */
export function pkInKeyOrder<T extends KeySortable & { isPrimaryKey?: boolean | null }>(cols: T[]): T[] {
  return sortByKeyOrder(cols.filter((c) => !!c.isPrimaryKey));
}

/** Posición para una columna que ENTRA a la llave: al final del orden
 *  explícito. `null` si la tabla NO maneja orden explícito (ninguna PK con
 *  pkPosition) — ahí rige la regla simple del orden físico. */
export function nextPkPosition(cols: CanonicalColumn[], excludeId?: string): number | null {
  const positions = cols
    .filter((c) => !!c.isPrimaryKey && c.id !== excludeId)
    .map((c) => c.pkPosition)
    .filter((p): p is number => p != null);
  return positions.length ? Math.max(...positions) + 1 : null;
}

/** Mueve la PK `colId` un paso (↑ -1 / ↓ +1) dentro de la llave. Devuelve las
 *  posiciones 0..k-1 a persistir para TODAS las PKs (reordenar DEFINE el orden
 *  explícito: también normaliza las que estaban sin posición). Vacío si el
 *  movimiento no aplica. */
export function reorderKey(cols: CanonicalColumn[], colId: string, dir: -1 | 1): { id: string; pkPosition: number }[] {
  const ordered = pkInKeyOrder(cols);
  const i = ordered.findIndex((c) => c.id === colId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ordered.length) return [];
  [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  return ordered.map((c, k) => ({ id: c.id, pkPosition: k }));
}
