/**
 * rollbackPreview — lógica pura de la vista previa del rollback de Data
 * Standards (doc 95 D9): qué dominios cambian de tipo y cuántas columnas se
 * re-tipan, antes de confirmar.
 */
import type { RollbackPreview } from './standards.service';

export interface RollbackDomainRow { id: string; name: string; physical: string; logical: string; columns: string }

const fmt = (n: number) => n.toLocaleString('en-US');
const change = (c: { from: string | null; to: string } | null): string => (c ? `${c.from ?? '—'} → ${c.to}` : '—');

/** Filas de la tabla: dominio · físico · lógico · columnas re-tipadas. */
export const rollbackDomainRows = (p: RollbackPreview): RollbackDomainRow[] =>
  p.domains.map((d) => ({ id: d.id, name: d.name, physical: change(d.physical), logical: change(d.logical), columns: fmt(d.columns) }));

/** Qué hace el rollback, en frases. */
export function rollbackSummary(p: RollbackPreview): string[] {
  const n = p.domains.length;
  const cols = p.domains.reduce((s, d) => s + d.columns, 0);
  const out = [n
    ? `${fmt(n)} domain type change${n === 1 ? '' : 's'} · ${fmt(cols)} column${cols === 1 ? '' : 's'} re-typed (only the ones that follow each domain).`
    : 'No domain type changes — no column is re-typed.'];
  if (p.namesRederived) out.push(`Physical names are re-derived from the glossary and naming rules of ${p.target.label}.`);
  return out;
}
