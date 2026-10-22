/**
 * Drag&drop de filas en el bloque del canvas (paridad con Erwin): planificación
 * pura de lo que un drop significa para el modelo. Hay un solo orden
 * (`ordinal`) con las PK siempre primero:
 *  - Soltar entre filas no-llave: reordena las no-PK.
 *  - Soltar en el área de llave (sobre una PK o en la zona vacía): la columna
 *    entra a la llave en esa posición del bloque (o al final); una PK soltada
 *    sobre otra PK se reordena dentro del bloque, como cualquier columna.
 *  - Sacar una PK del área hacia la lista: sale de la llave y se ubica donde
 *    cayó; nunca queda una PK debajo de una no-PK.
 * El store aplica el plan (`applyCanvasDrop`) por el camino versionado.
 */
import { orderColumns } from './columnOrder';

export type DropTarget = { kind: 'row'; id: string; after: boolean } | { kind: 'pkzone' };
export interface KeyChange { id: string; isPrimaryKey: boolean }
export interface CanvasDropPlan {
  /** Nuevo orden (ids de todas las columnas de la tabla, PK primero); null si no cambia. */
  order: string[] | null;
  /** Columnas que entran o salen de la llave. */
  key: KeyChange[];
}
type Col = { id: string; ordinal: number; isPrimaryKey?: boolean };

const NONE: CanvasDropPlan = { order: null, key: [] };

/** `ids` sin `dragId`, con `dragId` insertado delante o detrás de `targetId`; null si `targetId` no está. */
function insertAt(ids: string[], dragId: string, targetId: string, after: boolean): string[] | null {
  const out = ids.filter((x) => x !== dragId);
  let idx = out.indexOf(targetId);
  if (idx < 0) return null;
  if (after) idx += 1;
  out.splice(idx, 0, dragId);
  return out;
}

export function planCanvasDrop(cols: Col[], dragId: string, target: DropTarget): CanvasDropPlan {
  const drag = cols.find((c) => c.id === dragId);
  if (!drag) return NONE;
  const flat = orderColumns(cols).map((c) => c.id);
  const isPk = new Map(cols.map((c) => [c.id, !!c.isPrimaryKey]));
  const pkIds = flat.filter((id) => isPk.get(id));
  const restIds = flat.filter((id) => !isPk.get(id));
  const plan = (order: string[], key: KeyChange[]): CanvasDropPlan => {
    const changed = order.some((x, i) => x !== flat[i]) ? order : null;
    return changed || key.length ? { order: changed, key } : NONE;
  };

  if (target.kind === 'pkzone') {
    if (drag.isPrimaryKey) return NONE;
    return plan([...pkIds, dragId, ...restIds.filter((x) => x !== dragId)], [{ id: dragId, isPrimaryKey: true }]);
  }
  if (target.id === dragId) return NONE;
  const tgt = cols.find((c) => c.id === target.id);
  if (!tgt) return NONE;
  if (tgt.isPrimaryKey) {
    // Sobre una fila del área de llave: entra (o se reordena) dentro del bloque.
    const keyIds = insertAt(pkIds, dragId, target.id, target.after);
    if (!keyIds) return NONE;
    return plan([...keyIds, ...restIds.filter((x) => x !== dragId)],
      drag.isPrimaryKey ? [] : [{ id: dragId, isPrimaryKey: true }]);
  }
  // Sobre una fila no-llave: se ubica entre las no-PK; una PK arrastrada acá sale de la llave.
  const rest = insertAt(restIds, dragId, target.id, target.after);
  if (!rest) return NONE;
  return plan([...pkIds.filter((x) => x !== dragId), ...rest],
    drag.isPrimaryKey ? [{ id: dragId, isPrimaryKey: false }] : []);
}
