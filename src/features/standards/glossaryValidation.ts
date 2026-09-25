/**
 * glossaryValidation — lógica pura del flujo Validar término (F2 #1).
 * Separada de GlossaryPage para testearla con vitest sin montar JSX.
 */
import type { GlossaryImpact, GlossaryValidation, UdpScope } from '@/services/naming.service';

/** Normaliza para comparar textos (case/espacios-insensible). */
const norm = (s: string | undefined | null) => (s || '').trim().toLowerCase();

/** Términos que hay que validar antes de aplicar: filas NUEVAS o cuyo TEXTO
 *  cambió vs el original (`_orig`), vivas y con texto. El backend valida tanto
 *  altas como renombres (con exclude_id); un cambio de solo case/espacios o de
 *  abreviatura no dispara validación (el término lógico no cambió). */
export function termsToValidate<
  T extends { term: string; _new?: boolean; _deleted?: boolean; _orig?: string },
>(drafts: T[]): string[] {
  return drafts
    .filter((d) => {
      if (d._deleted || d.term.trim().length === 0) return false;
      if (d._new) return true;
      return d._orig !== undefined && norm(d.term) !== norm(d._orig);
    })
    .map((d) => d.term.trim());
}

/** Líneas legibles del dialog de conflictos: dónde aparece la palabra/frase. */
export function conflictLines(v: GlossaryValidation): string[] {
  const lines: string[] = [];
  const dup = v.conflicts.glossaryDuplicate;
  if (dup) lines.push(`Already in the glossary: ${dup.term} → ${dup.abbrev}`);
  for (const hit of v.conflicts.corpus) {
    lines.push(hit.entity === 'table'
      ? `Table ${hit.tableName} · "${hit.logicalName}"`
      : `Column ${hit.tableName}.${hit.columnName} · "${hit.logicalName}"`);
  }
  const corpusTotal = v.conflicts.total - (dup ? 1 : 0);
  if (corpusTotal > v.conflicts.corpus.length) {
    lines.push(`… and ${corpusTotal - v.conflicts.corpus.length} more matches`);
  }
  return lines;
}

// ── Impacto real del apply (doc 94 D7/D8) ──

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Nombres físicos que cambiarían en total (0 ⇒ se aplica sin aviso). */
export const impactTotal = (imp: GlossaryImpact): number => imp.columns + imp.tables;

/** Resumen por tipo de nombre: los términos de columna solo tocan campos. */
export function impactSummary(imp: GlossaryImpact): string[] {
  const out: string[] = [];
  if (imp.columns) {
    out.push(`${plural(imp.columns, 'column (field) name', 'column (field) names')} in ${plural(imp.columnTables, 'table', 'tables')}`);
  }
  if (imp.tables) out.push(plural(imp.tables, 'table name', 'table names'));
  return out;
}

/** Muestra legible del cambio de nombres, con el resto fuera de la muestra. */
export function impactSampleLines(imp: GlossaryImpact): string[] {
  const lines = imp.sample.map((s) => (s.entity === 'table'
    ? `Table ${s.from} → ${s.to}`
    : `${s.table} · ${s.from} → ${s.to}`));
  const rest = impactTotal(imp) - imp.sample.length;
  if (rest > 0) lines.push(`… and ${rest} more`);
  return lines;
}

/** Nota del diálogo según el scope editado (final review #10): un término de
 *  columna nunca renombra tablas y uno de tabla nunca renombra columnas; si el
 *  otro scope también cambia es porque tenía nombres ya desfasados que el apply
 *  re-deriva de paso. */
export function impactNote(scope: UdpScope, imp: GlossaryImpact): string {
  const base = scope === 'table'
    ? 'Table terms only rename table names — never column names.'
    : 'Column terms only rename column (field) names — never table names.';
  const otherChanges = scope === 'table' ? imp.columns > 0 : imp.tables > 0;
  const other = scope === 'table' ? 'column' : 'table';
  const drift = otherChanges
    ? ` Some ${other} names that are already out of sync with the current rules are re-derived too.` : '';
  return `${base}${drift} You can roll back this version from the history.`;
}
