/**
 * PK de una tabla en el orden único (doc 94 D1). Ya NO existe un orden de
 * llave aparte (`pkPosition` se retiró): la llave sigue el `ordinal`, y
 * `PRIMARY KEY(...)`, el bloque PK del canvas y los pares de relación lo usan.
 */
import { sortByOrdinal } from './columnOrder';

/** PKs de la tabla, por `ordinal`. `cols` debe venir acotado a UNA tabla. */
export function pkInKeyOrder<T extends { ordinal: number; isPrimaryKey?: boolean | null }>(cols: T[]): T[] {
  return sortByOrdinal(cols.filter((c) => !!c.isPrimaryKey));
}
