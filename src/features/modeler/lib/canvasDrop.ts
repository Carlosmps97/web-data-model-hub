/**
 * Drag&drop de filas en el bloque del canvas (doc 73 §10.4 · doc 74, paridad
 * Erwin): planificación PURA de lo que un drop significa para el modelo.
 *  - Soltar entre filas no-llave: reordena las columnas (`ordinal`, el orden
 *    único de la tabla).
 *  - Soltar en el área de llave (sobre una PK o en la zona vacía): la columna
 *    entra a la llave en esa posición (o al final); una PK soltada ahí se
 *    reordena dentro de la llave. Las posiciones se normalizan 0..k-1.
 *  - Sacar una PK del área hacia la lista: sale de la llave (pkPosition null) y
 *    además se ubica donde cayó.
 * El store aplica el plan (`applyCanvasDrop`) por el camino versionado.
 */
import { sortByOrdinal } from './columnOrder';
import { sortByKeyOrder } from './keyOrder';

export type DropTarget = { kind: 'row'; id: string; after: boolean } | { kind: 'pkzone' };
export interface KeyChange { id: string; isPrimaryKey: boolean; pkPosition: number | null }
export interface CanvasDropPlan {
  /** Nuevo orden (ids de TODAS las columnas de la tabla); null si no cambia. */
  order: string[] | null;
  /** Cambios de llave (sólo lo que cambia): marcar/desmarcar y posiciones normalizadas. */
  key: KeyChange[];
}
type Col = { id: string; ordinal: number; isPrimaryKey?: boolean; pkPosition?: number | null };

const NONE: CanvasDropPlan = { order: null, key: [] };

/** Posiciones 0..k-1 para `orderedPkIds` (+ la demoted fuera de la llave), sólo donde cambian. */
function keyChanges(cols: Col[], orderedPkIds: string[], demoted?: string): KeyChange[] {
  const byId = new Map(cols.map((c) => [c.id, c]));
  const out: KeyChange[] = [];
  orderedPkIds.forEach((id, i) => {
    const c = byId.get(id);
    if (c && (!c.isPrimaryKey || (c.pkPosition ?? null) !== i)) out.push({ id, isPrimaryKey: true, pkPosition: i });
  });
  if (demoted) {
    const c = byId.get(demoted);
    if (c && (c.isPrimaryKey || c.pkPosition != null)) out.push({ id: demoted, isPrimaryKey: false, pkPosition: null });
  }
  return out;
}

/** `flat` sin `dragId`, con `dragId` insertado antes/después de `targetId`; null si queda igual. */
function moved(flat: string[], dragId: string, targetId: string, after: boolean): string[] | null {
  const ids = flat.filter((x) => x !== dragId);
  let idx = ids.indexOf(targetId);
  if (idx < 0) return null;
  if (after) idx += 1;
  ids.splice(idx, 0, dragId);
  return ids.every((x, i) => x === flat[i]) ? null : ids;
}

export function planCanvasDrop(cols: Col[], dragId: string, target: DropTarget): CanvasDropPlan {
  const drag = cols.find((c) => c.id === dragId);
  if (!drag) return NONE;
  const flat = sortByOrdinal(cols).map((c) => c.id);
  const pkIds = sortByKeyOrder(cols.filter((c) => !!c.isPrimaryKey)).map((c) => c.id);
  if (target.kind === 'pkzone') {
    return drag.isPrimaryKey ? NONE : { order: null, key: keyChanges(cols, [...pkIds, dragId]) };
  }
  if (target.id === dragId) return NONE;
  const tgt = cols.find((c) => c.id === target.id);
  if (!tgt) return NONE;
  if (tgt.isPrimaryKey) {
    // Sobre una fila del área de llave: entra o se reordena DENTRO de la llave.
    const ids = pkIds.filter((x) => x !== dragId);
    let idx = ids.indexOf(target.id);
    if (idx < 0) return NONE;
    if (target.after) idx += 1;
    ids.splice(idx, 0, dragId);
    return { order: null, key: keyChanges(cols, ids) };
  }
  // Sobre una fila no-llave: reordena las columnas; una PK arrastrada acá sale de la llave.
  return {
    order: moved(flat, dragId, target.id, target.after),
    key: drag.isPrimaryKey ? keyChanges(cols, pkIds.filter((x) => x !== dragId), dragId) : [],
  };
}
