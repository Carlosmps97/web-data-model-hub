/**
 * Autoarrange «headless» de los canvases tocados por la carga masiva (doc 55
 * §3.5): mismo motor y configuración que el botón del toolbar (`arrangeDiagram`
 * → ELK), pero sin nodos medidos — los tamaños salen de la estimación LOD
 * (idéntica a `scripts/arrange_all.py`). Corre canvas por canvas y persiste
 * el layout con el servicio changeset-aware (`arrangeSubjectArea` MERGEA las
 * posiciones). Doc 99: como el arrange mueve TODOS los bloques del canvas, la
 * misma escritura reinicia sus trazos manuales de wires — en un canvas
 * existente que ganó tablas ya no calzarían con los bloques.
 * Un canvas que falla no frena a los demás: se devuelve en `failed` para que
 * el popup lo avise (queda el botón Autoarrange manual).
 * Doc 105 (ronda 3, R7-B): corre con el pin de la CARGA — el servicio toma la
 * versión al llamarlo: si en el medio se abrió otra, corta antes de escribir en
 * ella. Ronda 4: el corte no es un error — devuelve en `skipped` los canvases
 * que no llegó a arreglar (el popup lo avisa); cerrar el popup ya no lo corta.
 */
import * as mod from '@/features/modeler/services/modeler.service';
import * as struct from '@/features/modeler/services/structure.service';
import { arrangeDiagram } from '@/features/modeler/lib/arrangeGraph';
// eslint-disable-next-line no-restricted-imports -- a propósito: por el barrel de modeler sería un ciclo (Toolbar → UploadModal → modeler); ver doc/architecture.md
import { SessionChangedError, pinSession, type SessionPin } from '@/features/modeler/lib/sessionGuard';

/** `skipped`: los que no se llegaron a arreglar porque la sesión cambió (ronda 4). */
export interface ArrangeOutcome { arranged: number; failed: string[]; skipped: string[]; }

export async function arrangeCanvases(
  canvasIds: string[],
  viewMode: 'logical' | 'physical',
  onProgress?: (done: number, total: number) => void,
  guard: { pin?: SessionPin } = {},
): Promise<ArrangeOutcome> {
  const pin = guard.pin ?? pinSession();
  const out: ArrangeOutcome = { arranged: 0, failed: [], skipped: [] };
  for (let i = 0; i < canvasIds.length; i++) {
    // Doc 105 (ronda 5, R15-H8): con la sesión ya cambiada no se trabaja en la
    // nueva (cargar el diagrama y ELK antes del corte de la escritura).
    if (!pin.holds()) { out.skipped = canvasIds.slice(i); break; }
    onProgress?.(i, canvasIds.length);
    const id = canvasIds[i];
    try {
      const dia = await mod.loadDiagram(id);
      if (dia.tables.length) {
        const pos = await arrangeDiagram(dia, () => undefined, viewMode);
        pin.check();
        await struct.arrangeSubjectArea(id, pos);
      }
      out.arranged += 1;
    } catch (e) {
      // La sesión cambió: no es un canvas que falló — éste y los que faltan quedan sin arreglar.
      if (e instanceof SessionChangedError) { out.skipped = canvasIds.slice(i); break; }
      out.failed.push(id);
    }
  }
  onProgress?.(canvasIds.length, canvasIds.length);
  return out;
}
