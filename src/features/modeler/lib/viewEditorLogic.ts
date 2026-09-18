// Lógica PURA del ViewEditor multi-fuente (F3, spec §3-5) — separada del JSX
// para testearla con vitest sin DOM.
import type { ViewSource } from '@/services/views.service';

/** Config editable por columna de la grilla del editor. */
export interface ColCfg { included: boolean; output: string; expression: string; castType: string; description: string; }

/** Clave única de una columna en la grilla multi-fuente. */
export const colKey = (tableId: string, column: string) => `${tableId}::${column}`;

export function splitColKey(key: string): { tableId: string; column: string } {
  const i = key.indexOf('::');
  return { tableId: key.slice(0, i), column: key.slice(i + 2) };
}

/** Sources persistidos = columnas incluidas EN ORDEN (explícitas, sin SELECT *).
 *  Alias solo si difiere de la columna; expression/castType solo si no vacíos.
 *  `valid` filtra claves fantasma (columnas que ya no existen en sus fuentes). */
export function serializeSources(order: string[], cfg: Record<string, ColCfg>, valid: Set<string>): ViewSource[] {
  return order
    .filter((k) => valid.has(k) && cfg[k]?.included)
    .map((k) => {
      const { tableId, column } = splitColKey(k);
      const cc = cfg[k];
      const out = cc.output.trim();
      return {
        column,
        tableId,
        outputAlias: out && out !== column ? out : undefined,
        expression: cc.expression.trim() || undefined,
        castType: cc.castType.trim() || undefined,
        // Definición propia SOLO si el usuario escribió una (vacío ⇒ hereda la
        // de la columna física; no duplicamos passthroughs).
        description: cc.description.trim() || undefined,
      };
    });
}

/** Doc 91 D7 — `sources` de una vista en modo User-Defined SQL: TODAS las
 *  columnas de TODAS las fuentes, planas (columna + tableId, sin alias ni
 *  expresión), en el orden de las fuentes y el orden físico de cada tabla —
 *  es lo que pinta el canvas; el DDL no las usa (lo emite el script). Para
 *  una fuente cuyas columnas NO están a mano (tabla fuera de este canvas) se
 *  conservan tal cual las entradas previas de esa tabla (`fallback`), para no
 *  perderlas. Pura. */
export function allSourceColumns(
  sourceIds: string[],
  colsByTable: Map<string, { physicalName: string }[]>,
  fallback: ViewSource[] = [],
): ViewSource[] {
  const out: ViewSource[] = [];
  for (const tid of sourceIds) {
    const cols = colsByTable.get(tid);
    if (cols) {
      for (const c of cols) out.push({ column: c.physicalName, tableId: tid });
    } else {
      for (const s of fallback) if (s.tableId === tid) out.push({ ...s });
    }
  }
  return out;
}
