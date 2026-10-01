/**
 * Doc 105 (ronda 4) — aviso de los canvases que la carga no pudo arreglar,
 * cuando el popup ya no los muestra: se cerró (cambiar Logical/Physical cierra
 * los modales; salir por el TopNav) o se abrió otra versión a mitad del
 * arrange (`version`: la carga quedó aplicada en la suya). Con 3 o menos y sus
 * nombres conocidos, los nombra; si no, dice cuántos.
 */
export function notArrangedNotice(
  ids: string[], nameOf: (id: string) => string | undefined, other?: { version: string | null | undefined },
): string {
  const one = ids.length === 1;
  const names = ids.map(nameOf);
  const which = ids.length <= 3 && names.every(Boolean) ? `: ${names.map((n) => `“${n}”`).join(', ')}` : '';
  const count = one ? '1 canvas' : `${ids.length} canvases`;
  const them = one ? 'it' : 'them';
  if (!other) return `Couldn't auto-arrange ${count}${which} — open ${them} and use Autoarrange.`;
  const applied = other.version ? `The upload to “${other.version}” was applied` : 'The upload was applied to its version';
  return `${applied}, but ${count} ${one ? "wasn't" : "weren't"} auto-arranged${which} — open ${them} in that version and use Autoarrange.`;
}
