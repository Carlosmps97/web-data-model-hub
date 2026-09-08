// Membresía de vistas en el canvas (doc 70 §2) — helpers PUROS, sin React ni
// red, para el store y el tab Views del panel de tabla.
//
// Desde el doc 70 una vista se dibuja en un canvas sólo si es MIEMBRO
// (`SubjectArea.viewIds`), igual que las tablas con `tableIds`; el backend
// devuelve `diagram.subjectArea.viewIds` ya materializado (un canvas legacy
// recibe la lista de lo que hoy se ve), así que todas las mutaciones parten de
// una lista explícita.
import type { View } from '@/services/views.service';
import { viewSourceIds } from './viewGraph';

/** Vistas (de cualquier origen) que tienen a `tableId` entre sus fuentes. */
export function viewsOfTable<T extends View>(views: T[], tableId: string): T[] {
  return views.filter((v) => viewSourceIds(v).includes(tableId));
}

/** Parte una lista de vistas de la tabla en las que están en ESTE canvas
 *  (`onCanvas` = ids de `diagram.views`) y las que viven sólo en otros
 *  canvases (o en ninguno). Conserva el orden de `all`. */
export function splitByCanvas<T extends { id: string }>(
  all: T[], onCanvas: Set<string>,
): { here: T[]; elsewhere: T[] } {
  const here: T[] = [];
  const elsewhere: T[] = [];
  for (const v of all) (onCanvas.has(v.id) ? here : elsewhere).push(v);
  return { here, elsewhere };
}

/** Vistas del canvas que quedarían SIN ninguna fuente presente si el canvas
 *  conserva sólo `remainingTableIds` — se podan de la membresía al quitar una
 *  tabla (una vista sin fuente en el canvas no se dibuja ni tiene sentido). */
export function orphanViewIds(views: View[], remainingTableIds: string[]): string[] {
  const remaining = new Set(remainingTableIds);
  return views
    .filter((v) => !viewSourceIds(v).some((tid) => remaining.has(tid)))
    .map((v) => v.id);
}

/** Unión ordenada sin duplicados: primero `base` (en su orden), luego los
 *  `add` nuevos. */
export function mergeIds(base: string[], add: string[]): string[] {
  const out = [...new Set(base)];
  const seen = new Set(out);
  for (const id of add) if (!seen.has(id)) { seen.add(id); out.push(id); }
  return out;
}

/** `base` sin los ids de `drop` (conserva el orden). */
export function withoutIds(base: string[], drop: string[]): string[] {
  const gone = new Set(drop);
  return base.filter((id) => !gone.has(id));
}
