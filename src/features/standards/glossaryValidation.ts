/**
 * glossaryValidation — lógica pura del flujo Validar término (F2 #1).
 * Separada de GlossaryPage para testearla con vitest sin montar JSX.
 */
import type { GlossaryValidation } from '@/services/naming.service';

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
  if (dup) lines.push(`Ya existe en el glosario: ${dup.term} → ${dup.abbrev}`);
  for (const hit of v.conflicts.corpus) {
    lines.push(hit.entity === 'table'
      ? `Tabla ${hit.tableName} · "${hit.logicalName}"`
      : `Columna ${hit.tableName}.${hit.columnName} · "${hit.logicalName}"`);
  }
  const corpusTotal = v.conflicts.total - (dup ? 1 : 0);
  if (corpusTotal > v.conflicts.corpus.length) {
    lines.push(`… y ${corpusTotal - v.conflicts.corpus.length} coincidencias más`);
  }
  return lines;
}
