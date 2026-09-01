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

/** Doc 64 §4a — condición de JOIN sugerida por COLUMNAS HOMÓNIMAS para las
 *  fuentes SIN relación modelada con las previas. Para cada fuente k>0 no
 *  conectada, toma la PRIMERA fuente previa con columnas de igual physicalName
 *  (case-insensitive) y emite `tPrev.COL = tK.COL` por cada homónima —
 *  priorizando las que son PK en ALGUNO de los dos lados (si ninguna es PK,
 *  usa todas las homónimas). Devuelve '' si no hay nada que sugerir. Pura;
 *  alias posicionales t1, t2… (mismo contrato que inferJoin). La sugerencia se
 *  precarga en el textarea del editor y persiste como joinOverride (difiere de
 *  la inferida por relaciones), así el DDL la emite verbatim. */
export function inferNameJoin(
  sourceTableIds: string[],
  relationships: { parentTableId: string; childTableId: string }[],
  columns: { tableId: string; physicalName: string; isPrimaryKey?: boolean }[],
): string {
  if (sourceTableIds.length < 2) return '';
  const alias = new Map(sourceTableIds.map((id, i) => [id, `t${i + 1}`]));
  const byTable = new Map<string, { physicalName: string; isPrimaryKey?: boolean }[]>();
  for (const c of columns) {
    if (!alias.has(c.tableId)) continue;
    const a = byTable.get(c.tableId) ?? [];
    a.push(c);
    byTable.set(c.tableId, a);
  }
  const conds: string[] = [];
  for (let k = 1; k < sourceTableIds.length; k++) {
    const cur = sourceTableIds[k];
    const prevIds = sourceTableIds.slice(0, k);
    const connected = relationships.some((r) =>
      (r.childTableId === cur && prevIds.includes(r.parentTableId))
      || (r.parentTableId === cur && prevIds.includes(r.childTableId)));
    if (connected) continue;                       // esa fuente ya la cubre inferJoin
    const curByName = new Map((byTable.get(cur) ?? []).map((c) => [c.physicalName.toLowerCase(), c]));
    for (const p of prevIds) {
      const shared = (byTable.get(p) ?? []).filter((c) => curByName.has(c.physicalName.toLowerCase()));
      if (!shared.length) continue;
      const keyish = shared.filter((c) => c.isPrimaryKey || curByName.get(c.physicalName.toLowerCase())?.isPrimaryKey);
      for (const c of (keyish.length ? keyish : shared)) {
        const curCol = curByName.get(c.physicalName.toLowerCase())!;
        conds.push(`${alias.get(p)}.${c.physicalName} = ${alias.get(cur)}.${curCol.physicalName}`);
      }
      break;                                       // una fuente previa alcanza
    }
  }
  return conds.join(' AND ');
}
