/**
 * Tras aplicar la carga masiva, en cada canvas que ganó tablas o vistas se
 * ubica solo lo que entró (`newMembers` del resultado del job): agrupado, sin
 * pisarse, en el centro de lo que el usuario ve (el canvas abierto: `focus`) o
 * del contenido de ese canvas (`placeNewMembers`). Se graba con
 * `setSubjectAreaLayout`, que mezcla las posiciones: lo existente no se mueve y
 * los trazos manuales de wires se conservan (no se reacomodan todos los bloques).
 * Un canvas que falla no frena a los demás: se devuelve en `failed` para que el
 * popup lo avise (lo nuevo queda en la posición provisional del backend).
 * Corre con el pin de la carga: si en el medio se abrió otra versión, corta
 * antes de cargar o escribir en ella y devuelve en `skipped` los canvases que
 * no llegó a ubicar.
 */
import * as mod from '@/features/modeler/services/modeler.service';
import * as struct from '@/features/modeler/services/structure.service';
import { placeNewMembers } from '@/features/modeler/lib/placeNewMembers';
// eslint-disable-next-line no-restricted-imports -- a propósito: por el barrel de modeler sería un ciclo (Toolbar → UploadModal → modeler); ver docs/02-arquitectura.md
import { SessionChangedError, pinSession, type SessionPin } from '@/features/modeler/lib/sessionGuard';

/** `placed`: canvases resueltos (también los que no tenían nada que mover). */
export interface PlaceOutcome { placed: number; failed: string[]; skipped: string[]; }

export async function placeUploadedObjects(
  canvasIds: string[],
  newMembers: Record<string, string[]> | null | undefined,
  focus: { saId: string; point: { x: number; y: number } } | null,
  onProgress?: (done: number, total: number) => void,
  guard: { pin?: SessionPin } = {},
): Promise<PlaceOutcome> {
  const pin = guard.pin ?? pinSession();
  const out: PlaceOutcome = { placed: 0, failed: [], skipped: [] };
  // Solo los canvases donde entró algo (sin `newMembers`, ninguno).
  const ids = canvasIds.filter((id) => (newMembers?.[id]?.length ?? 0) > 0);
  for (let i = 0; i < ids.length; i++) {
    if (!pin.holds()) { out.skipped = ids.slice(i); break; }
    onProgress?.(i, ids.length);
    const id = ids[i];
    try {
      const dia = await mod.loadDiagram(id);
      const pos = await placeNewMembers(dia, newMembers![id], focus?.saId === id ? focus.point : null);
      if (Object.keys(pos).length) {
        pin.check();
        await struct.setSubjectAreaLayout(id, pos);
      }
      out.placed += 1;
    } catch (e) {
      // Cambio de sesión: no es un canvas que falló; este y los que faltan quedan sin ubicar.
      if (e instanceof SessionChangedError) { out.skipped = ids.slice(i); break; }
      out.failed.push(id);
    }
  }
  if (ids.length) onProgress?.(ids.length, ids.length);
  return out;
}
