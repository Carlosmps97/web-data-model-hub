// Lógica pura del ViewPropertiesPanel, separada del JSX para probarla con
// vitest sin DOM (mismo criterio que viewEditorLogic).
import type { ViewSource } from '@/services/views.service';

/** Reordena `sources` moviendo el ítem `from` a la posición `to` (índices del
 *  array completo; `to` = posición de inserción post-remoción). Pura, clampa. */
export function moveSource(sources: ViewSource[], from: number, to: number): ViewSource[] {
  const next = sources.map((s) => ({ ...s }));
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  const dest = Math.max(0, Math.min(to, next.length));
  next.splice(dest, 0, item);
  return next;
}

/** Borrador de la User-Defined SQL del panel cuando la SQL guardada cambia por
 *  fuera (p. ej. se editó en el View Editor): sin cambios locales sin guardar,
 *  toma el texto nuevo; con cambios locales, se conservan. Pura. */
export function reseedDraft(draft: string, prevStored: string | null | undefined, nextStored: string | null | undefined): string {
  return draft.trim() === (prevStored ?? '').trim() ? (nextStored ?? '').trim() : draft;
}
