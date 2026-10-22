import type { ScopeCounts } from '@/types/versioning';

/**
 * Textos del borrado de proyecto por draft: el diálogo del modelador, el panel
 * «Deletion pending» y el aviso crítico para quien revisa. Puros: reciben los
 * conteos de `GET /api/projects/{pid}/counts`.
 */
const num = new Intl.NumberFormat('en-US');

/** «1 folder» / «12 folders» (singular con 1). */
const n = (count: number, one: string, many: string) => `${num.format(count)} ${count === 1 ? one : many}`;

function countsList(c: ScopeCounts): string {
  return `${n(c.tables, 'table', 'tables')}, ${n(c.columns, 'column', 'columns')}, ${n(c.views, 'view', 'views')}, `
    + `${n(c.relationships, 'relationship', 'relationships')}, ${n(c.schemas, 'schema', 'schemas')}, `
    + `${n(c.folders, 'folder', 'folders')} and ${n(c.canvases, 'canvas', 'canvases')}`;
}

// Los conteos son de producción; al aprobar, el apply graba primero lo que la
// working copy agregó y la cascada lo borra junto con el resto.
export function deletionSummary(name: string, c: ScopeCounts): string {
  return `This working copy will delete project «${name}» and everything in it: ${countsList(c)} in production `
    + '(plus anything this working copy adds), and its Data Standards.';
}

/** Confirmación tipeada: exacta (sensible a mayúsculas), sin espacios sobrantes. */
export function nameMatches(typed: string, name: string): boolean {
  const t = typed.trim();
  return t.length > 0 && t === name;
}

export function criticalDeletionText(name: string, c: ScopeCounts): { title: string; body: string } {
  return {
    title: `Critical: this request deletes project «${name}».`,
    body: `Approving it removes ${countsList(c)} (as published today, plus anything this request adds) from the platform, `
      + "together with the project's Data Standards. This cannot be undone from the web.",
  };
}
