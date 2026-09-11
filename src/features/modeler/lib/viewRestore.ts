/**
 * Doc 89 §3.4 — Undo del borrado de una vista desde el Object Inspector.
 * El backend (doc 88 §4) quita la vista de `viewIds`/`layout` de sus canvases
 * al grabar el delete; la inversa re-graba el doc de la vista y la vuelve a
 * listar en los canvases donde estaba. Este planner es PURO: recibe los
 * canvases EFECTIVOS (leídos al deshacer) y devuelve sólo los que hay que
 * escribir. Un canvas legacy sin membresía explícita (`viewIds` null/ausente,
 * doc 70) no se toca: su regla por fuentes la vuelve a mostrar sola.
 */
import { mergeIds } from './canvasViews';

export interface RestorableCanvas { id: string; viewIds?: string[] | null }

export function viewRestorePlan(viewId: string, canvases: RestorableCanvas[]): { canvasId: string; viewIds: string[] }[] {
  const seen = new Set<string>();
  const out: { canvasId: string; viewIds: string[] }[] = [];
  for (const c of canvases) {
    if (seen.has(c.id) || !Array.isArray(c.viewIds) || c.viewIds.includes(viewId)) continue;
    seen.add(c.id);
    out.push({ canvasId: c.id, viewIds: mergeIds(c.viewIds, [viewId]) });
  }
  return out;
}
