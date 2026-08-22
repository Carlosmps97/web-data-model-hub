/**
 * Inversa genérica de un lote de cambios (doc 50 — Undo). Pura, sin IO.
 *
 * Regla por ítem, recorrido en ORDEN INVERSO (lo último aplicado se deshace
 * primero — p.ej. la relación cae antes de restaurar/borrar sus columnas):
 *  - upsert de entidad PREEXISTENTE (hay pre-imagen) → re-upsert del pre-image;
 *  - upsert de entidad NUEVA (sin pre-imagen)        → delete;
 *  - delete (hay pre-imagen)                          → re-upsert del pre-image;
 *  - delete sin pre-imagen                            → no restaurable (se omite).
 *
 * Asume que un lote toca cada entidad UNA sola vez (cierto para todos los
 * lotes de la plataforma: paste, relación, cascadas).
 */
import type { BulkChange } from '@/features/governance/services/governance.service';

/** Clave del mapa de pre-imágenes: `${collection}:${entityId}`. */
export const preKey = (collection: string, entityId: string) => `${collection}:${entityId}`;

export function invertBulk(
  changes: BulkChange[],
  pre: Map<string, Record<string, unknown>>,
): BulkChange[] {
  const out: BulkChange[] = [];
  for (const ch of [...changes].reverse()) {
    const before = pre.get(preKey(ch.collection, ch.entityId));
    if (ch.op === 'upsert') {
      out.push(before
        ? { collection: ch.collection, entityId: ch.entityId, op: 'upsert', payload: { ...before } }
        : { collection: ch.collection, entityId: ch.entityId, op: 'delete' });
    } else if (before) {
      out.push({ collection: ch.collection, entityId: ch.entityId, op: 'upsert', payload: { ...before } });
    }
  }
  return out;
}
