/**
 * Doc 105 (ronda 4) — aviso de los canvases donde la carga no pudo ubicar lo
 * nuevo, cuando el popup ya no los muestra: se cerró (cambiar Logical/Physical
 * cierra los modales; salir por el TopNav) o se abrió otra versión a mitad
 * (`version`: la carga quedó aplicada en la suya). Con 3 o menos y sus nombres
 * conocidos, los nombra; si no, dice cuántos. Doc 113 §1.3: lo nuevo quedó en
 * la posición provisional del backend (debajo de lo existente) — ya no se
 * sugiere Autoarrange, que reordenaría todo el canvas.
 */
export function notPlacedNotice(
  ids: string[], nameOf: (id: string) => string | undefined, other?: { version: string | null | undefined },
): string {
  const names = ids.map(nameOf);
  const which = ids.length <= 3 && names.every(Boolean) ? `: ${names.map((n) => `“${n}”`).join(', ')}` : '';
  const count = ids.length === 1 ? '1 canvas' : `${ids.length} canvases`;
  const left = 'they were left below the existing blocks.';
  if (!other) return `Couldn't place the new objects on ${count}${which} — ${left}`;
  const applied = other.version ? `The upload to “${other.version}” was applied` : 'The upload was applied to its version';
  return `${applied}, but the new objects couldn't be placed on ${count}${which} — ${left}`;
}
