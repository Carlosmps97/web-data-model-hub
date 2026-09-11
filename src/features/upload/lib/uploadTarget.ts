/**
 * Proyecto destino de la carga (doc 87 §3.5, decisión D1) — helpers PUROS del
 * popup. La REGLA (qué carpetas raíz son «proyectos internos» y cuándo hace
 * falta elegir) vive en el backend (`upload_targets`); acá solo se decide qué
 * mostrar y qué preseleccionar.
 */
import type { UploadTargets } from '../upload.service';

/** ¿El popup debe exigir un destino? Solo con 2+ proyectos internos. */
export const needsTarget = (targets: UploadTargets | null): boolean => targets?.mode === 'choose';

/** Destino preseleccionado en modo `choose`: el actual si sigue siendo
 *  candidato, si no el recordado del proyecto; entre 2+ nunca se adivina
 *  (D1: el usuario elige). Fuera de `choose` no hay destino que elegir. */
export function pickTarget(targets: UploadTargets | null, remembered: string | null, current: string | null): string | null {
  if (!targets || targets.mode !== 'choose') return null;
  const ids = new Set(targets.candidates.map((c) => c.id));
  if (current && ids.has(current)) return current;
  if (remembered && ids.has(remembered)) return remembered;
  return null;
}

/** Texto de solo lectura cuando hay UNA sola raíz con subcarpetas (`auto`):
 *  el backend la toma solo y el usuario debe saber dónde caerá lo cargado. */
export function targetHint(targets: UploadTargets | null): string | null {
  if (!targets || targets.mode !== 'auto' || !targets.candidates[0]) return null;
  return `Subjects and diagrams will be created under “${targets.candidates[0].name}”`;
}
