/**
 * Lote que aplica cambios a columnas de una tabla y la deja con las PK
 * primero: la que entra a la llave queda al final del bloque de PK; la que
 * sale, primera entre las no-PK; las que se corren por eso viajan en el mismo
 * lote. Cada columna viaja una sola vez (documento completo + campos + ordinal
 * nuevo: dos ops al mismo _id en un lote no se acumulan). Devuelve también las
 * pre-imágenes para el Undo. Puro.
 */
import { bulk, type BulkChange, type CanonicalColumn } from '@/services/governance.service';

import { pkFirstOrdinals } from './columnOrder';

const clone = (c: CanonicalColumn): CanonicalColumn => ({ ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) });

export function keyLayoutBulk(
  cols: CanonicalColumn[],
  patches: Record<string, Partial<CanonicalColumn>>,
): { changes: BulkChange[]; pres: CanonicalColumn[] } {
  const byId = new Map(cols.map((c) => [c.id, c]));
  const toKey: string[] = [];
  const fromKey: string[] = [];
  for (const [id, p] of Object.entries(patches)) {        // orden de los patches = orden de entrada
    const c = byId.get(id);
    if (!c || p.isPrimaryKey === undefined || !!p.isPrimaryKey === !!c.isPrimaryKey) continue;
    (p.isPrimaryKey ? toKey : fromKey).push(id);
  }
  const ord = toKey.length || fromKey.length ? pkFirstOrdinals(cols, { toKey, fromKey }) : new Map<string, number>();
  const changes: BulkChange[] = [];
  const pres: CanonicalColumn[] = [];
  for (const c of cols) {
    const p = patches[c.id];
    const o = ord.get(c.id);
    if (!p && o === undefined) continue;
    pres.push(clone(c));
    changes.push(bulk.createColumn({ ...c, ...(p ?? {}), ...(o !== undefined ? { ordinal: o } : {}) }));
  }
  return { changes, pres };
}
