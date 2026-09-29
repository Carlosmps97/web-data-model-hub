/**
 * Conflictos con producción en la revisión (doc 84 A2; doc 100 P3). Dos
 * clases, que la pantalla dice con palabras distintas:
 *  - `overwrites`: producción cambió la entidad después de que esta versión la
 *    editó — aprobar pisa ese cambio.
 *  - `restores`: producción la BORRÓ después de abrirse esta versión — aprobar
 *    la vuelve a la vida (gana el draft que publica, regla del owner).
 */
import type { ChangesetDiff } from '@/types/versioning';

export interface ConflictCounts { overwrites: number; restores: number; total: number }

export function conflictCounts(diff: ChangesetDiff): ConflictCounts {
  let overwrites = 0;
  let restores = 0;
  Object.values(diff.collections).forEach((b) => {
    [...b.added, ...b.edited, ...b.deleted].forEach((e) => {
      if (!e.conflict) return;                      // `restores` viene siempre con `conflict`
      if (e.restores) restores += 1; else overwrites += 1;
    });
  });
  return { overwrites, restores, total: overwrites + restores };
}
