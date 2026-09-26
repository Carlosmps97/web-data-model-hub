// Lógica PURA del ViewEditor multi-fuente (F3, spec §3-5) — separada del JSX
// para testearla con vitest sin DOM.
import type { ViewInput, ViewSource } from '@/services/views.service';

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

/** Doc 96 D6: cuerpo del guardado del editor de vistas. La estructura del
 *  builder es la verdad (el DDL sale de ahí); la User-Defined SQL viaja como
 *  texto INFORMATIVO ('' ⇒ se quita). Los UDP se conservan tal cual. */
export function viewSaveBody(a: {
  name: string; schema: string; sourceIds: string[]; sources: ViewSource[]; showOnCanvas: boolean;
  sql: string; description: string; sqlText: string; udpValues?: Record<string, string>;
}): ViewInput {
  return {
    name: a.name.trim(), schema: a.schema.trim() || undefined, sources: a.sources,
    sourceTableIds: a.sourceIds, tableId: a.sourceIds[0], showOnCanvas: a.showOnCanvas, sql: a.sql,
    description: a.description.trim() || undefined, customSql: a.sqlText.trim() || undefined,
    udpValues: a.udpValues,
  };
}

/** Nombres de salida repetidos (sin distinguir mayúsculas) entre las columnas
 *  de la vista: con alias duplicados el DDL es inválido (p. ej. `CODMES` de dos
 *  fuentes sin renombrar) — minor #12 del doc 96. Nombre = alias o columna; las
 *  expresiones sin alias no cuentan (su alias va dentro del texto). Devuelve la
 *  grafía de la primera aparición. Pura. */
export function duplicateOutputNames(sources: ViewSource[]): string[] {
  const seen = new Map<string, string>();
  const dup = new Set<string>();
  for (const s of sources) {
    const name = (s.outputAlias ?? '').trim() || (s.expression ? '' : (s.column ?? '').trim());
    if (!name) continue;
    const k = name.toLowerCase();
    const first = seen.get(k);
    if (first !== undefined) dup.add(first); else seen.set(k, name);
  }
  return [...dup];
}
