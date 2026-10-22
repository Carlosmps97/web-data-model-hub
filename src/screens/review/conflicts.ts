/**
 * Conflictos con producción en la revisión. Tres clases, que la pantalla dice
 * con palabras distintas:
 *  - `overwrites`: producción modificó la entidad después de que esta versión
 *    la editó; aprobar pisa ese cambio.
 *  - `restores`: producción la borró después de abrirse esta versión; aprobar
 *    la vuelve a la vida (el dibujo: canvases y carpetas; y las restauraciones).
 *  - `blocked`: otra versión borró y publicó ese objeto del modelo después de
 *    abrirse esta; no se publica ni se revive: el dueño descarta el cambio.
 */
import type { ChangesetDiff } from '@/types/versioning';

export interface ConflictCounts { overwrites: number; restores: number; blocked: number; total: number }

export function conflictCounts(diff: ChangesetDiff): ConflictCounts {
  let overwrites = 0;
  let restores = 0;
  let blocked = 0;
  Object.values(diff.collections).forEach((b) => {
    [...b.added, ...b.edited, ...b.deleted].forEach((e) => {
      if (!e.conflict) return;          // `restores` y `deletedInProduction` vienen siempre con `conflict`
      if (e.deletedInProduction) blocked += 1;
      else if (e.restores) restores += 1;
      else overwrites += 1;
    });
  });
  return { overwrites, restores, blocked, total: overwrites + restores + blocked };
}
