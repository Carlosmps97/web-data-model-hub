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

/** joinOverride persistido: solo si el usuario ESCRIBIÓ algo distinto de la
 *  condición inferida. Si coincide con la inferida se guarda undefined y la
 *  derivación sigue VIVA (cambia la relación ⇒ cambia el JOIN del DDL). */
export function resolveJoinOverride(joinText: string, inferred: string): string | undefined {
  const t = joinText.trim();
  return t && t !== inferred.trim() ? t : undefined;
}
