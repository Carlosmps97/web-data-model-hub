/**
 * Autoarrange «headless» de los canvases tocados por la carga masiva (doc 55
 * §3.5): mismo motor y configuración que el botón del toolbar (`arrangeDiagram`
 * → ELK), pero sin nodos medidos — los tamaños salen de la estimación LOD
 * (idéntica a `scripts/arrange_all.py`). Corre canvas por canvas y persiste
 * el layout con el servicio changeset-aware (`setSubjectAreaLayout` MERGEA).
 * Un canvas que falla no frena a los demás: se devuelve en `failed` para que
 * el popup lo avise (queda el botón Autoarrange manual).
 */
import * as mod from '@/features/modeler/services/modeler.service';
import * as struct from '@/features/modeler/services/structure.service';
import { arrangeDiagram } from '@/features/modeler/lib/arrangeGraph';

export interface ArrangeOutcome { arranged: number; failed: string[]; }

export async function arrangeCanvases(
  canvasIds: string[],
  viewMode: 'logical' | 'physical',
  onProgress?: (done: number, total: number) => void,
): Promise<ArrangeOutcome> {
  const out: ArrangeOutcome = { arranged: 0, failed: [] };
  for (let i = 0; i < canvasIds.length; i++) {
    onProgress?.(i, canvasIds.length);
    const id = canvasIds[i];
    try {
      const dia = await mod.loadDiagram(id);
      if (dia.tables.length) {
        const pos = await arrangeDiagram(dia, () => undefined, viewMode);
        await struct.setSubjectAreaLayout(id, pos);
      }
      out.arranged += 1;
    } catch {
      out.failed.push(id);
    }
  }
  onProgress?.(canvasIds.length, canvasIds.length);
  return out;
}
