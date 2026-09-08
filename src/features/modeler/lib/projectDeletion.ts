import type { ScopeCounts } from '@/types/versioning';

/**
 * Textos del borrado de proyecto por draft (doc 75 D5): el diálogo del
 * modelador, el panel «Deletion pending» y el aviso crítico del revisor
 * (D20). Puros: reciben los conteos de `GET /api/projects/{pid}/counts`.
 */
const num = new Intl.NumberFormat('en-US');

function countsList(c: ScopeCounts): string {
  return `${num.format(c.tables)} tables, ${num.format(c.columns)} columns, ${num.format(c.views)} views, `
    + `${num.format(c.relationships)} relationships, ${num.format(c.schemas)} schemas, `
    + `${num.format(c.folders)} folders and ${num.format(c.canvases)} canvases`;
}

export function deletionSummary(name: string, c: ScopeCounts): string {
  return `This working copy will delete project «${name}» and everything in it: ${countsList(c)}, plus its Data Standards.`;
}

/** Confirmación tipeada: exacta (sensible a mayúsculas), sin espacios sobrantes. */
export function nameMatches(typed: string, name: string): boolean {
  const t = typed.trim();
  return t.length > 0 && t === name;
}

export function criticalDeletionText(name: string, c: ScopeCounts): { title: string; body: string } {
  return {
    title: `Critical: this request deletes project «${name}».`,
    body: `Approving it removes ${countsList(c)} from the platform, together with the project's Data Standards. This cannot be undone from the web.`,
  };
}
