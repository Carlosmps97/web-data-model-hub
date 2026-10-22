/**
 * glossaryValidation — lógica pura de los popups del glosario.
 * Separada de GlossaryPage para testearla con vitest sin montar JSX.
 */
import type { GlossaryImpact, GlossaryImpactRow, GlossaryValidation, UdpScope } from '@/services/naming.service';
import { invisibleChars } from '@/components/ui/affectedRows';

/** Normaliza para comparar textos (case/espacios-insensible). */
const norm = (s: string | undefined | null) => (s || '').trim().toLowerCase();
const fmt = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

/** Términos que hay que validar antes de aplicar: filas nuevas o cuyo texto
 *  difiere del original (`_orig`), vivas y con texto. El backend valida tanto
 *  altas como renombres (con exclude_id); un cambio de solo case/espacios o de
 *  abreviatura no dispara validación (el término lógico es el mismo). */
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

// ── Conflictos al agregar un término ──

export interface ConflictRow { table: string; column: string | null; logical: string }

/** Filas de la tabla de conflictos (la lista completa que manda el backend). */
export const conflictRows = (v: GlossaryValidation): ConflictRow[] =>
  v.conflicts.corpus.map((h) => ({ table: h.tableName, column: h.columnName, logical: h.logicalName }));

/** Por qué no se puede agregar: duplicado en el glosario y/o uso en nombres
 *  lógicos — de columnas para un término de columna, de tablas para uno de tabla. */
export function conflictMessage(v: GlossaryValidation, scope: UdpScope): string[] {
  const out: string[] = [];
  const dup = v.conflicts.glossaryDuplicate;
  if (dup) out.push(`It's already in the glossary: ${dup.term} → ${dup.abbrev}.`);
  const hits = v.conflicts.corpus;
  if (hits.length > 0 && scope === 'table') {
    out.push(`It already appears in the logical name of ${plural(hits.length, 'table', 'tables')}. `
      + "Adding it would change their physical names, so it's not allowed.");
  } else if (hits.length > 0) {
    const tables = new Set(hits.map((h) => h.tableName)).size;
    out.push(`It already appears in the logical name of ${plural(hits.length, 'column', 'columns')} in `
      + `${plural(tables, 'table', 'tables')}. Adding it would change their physical names, so it's not allowed.`);
    out.push('Column terms only look at column names — tables are never renamed.');
  }
  return out;
}

// Mismo límite de «frase completa» que el backend (`corpus_regex`).
const WORD = 'a-záéíóúñ0-9';

/** Partes del nombre lógico con la frase del término marcada (sin mayúsculas,
 *  nunca dentro de otra palabra). */
export function highlightParts(text: string, term: string): { text: string; hit: boolean }[] {
  const t = term.trim();
  if (!t) return [{ text, hit: false }];
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![${WORD}])${esc}(?![${WORD}])`, 'gi');
  const out: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), hit: false });
    out.push({ text: m[0], hit: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out.length ? out : [{ text, hit: false }];
}

// ── Renombres del apply ──

/** ¿Hay algo que mostrar antes de aplicar? (renombres o reparaciones). */
export const needsConfirm = (imp: GlossaryImpact): boolean => imp.renamed.length + imp.outOfSync.length > 0;

/** Resumen por tipo de nombre de un grupo de filas: los términos de columna solo tocan campos. */
export function impactSummary(rows: GlossaryImpactRow[]): string[] {
  const cols = rows.filter((r) => r.entity === 'column');
  const tabs = rows.filter((r) => r.entity === 'table');
  const out: string[] = [];
  if (cols.length) {
    const tables = new Set(cols.map((r) => r.tableId)).size;
    out.push(`${plural(cols.length, 'column (field) name', 'column (field) names')} in ${plural(tables, 'table', 'tables')}`);
  }
  if (tabs.length) out.push(plural(tabs.length, 'table name', 'table names'));
  return out;
}

/** Título del popup: con renombres pide confirmarlos; si solo hay reparaciones, lo dice. */
export function applyTitle(imp: GlossaryImpact): string {
  return imp.renamed.length
    ? `Rename ${plural(imp.renamed.length, 'physical name', 'physical names')}?`
    : 'Apply glossary changes?';
}

/** Por qué un nombre ya estaba desfasado de la regla vigente. */
export function outOfSyncReason(row: GlossaryImpactRow): string {
  const inv = invisibleChars(row.from);
  return inv.length ? `Invisible character (${inv.join(', ')})` : 'Differs from the naming rules';
}

export const NO_RENAMES = "Your changes don't rename any existing name.";

/** Nota del popup según el scope editado. */
export function impactNote(scope: UdpScope): string {
  const base = scope === 'table'
    ? 'Table terms only rename table names — never column names.'
    : 'Column terms only rename column (field) names — never table names.';
  return `${base} You can roll back this version from the history.`;
}

// ── Filas incompletas ──

/** Qué le falta a una fila del glosario (null = completa). */
export type TermGap = 'term' | 'abbrev' | 'both';
export function termGap(t: { term: string; abbrev: string }): TermGap | null {
  const noTerm = t.term.trim() === '';
  const noAbbrev = t.abbrev.trim() === '';
  if (noTerm && noAbbrev) return 'both';
  if (noTerm) return 'term';
  return noAbbrev ? 'abbrev' : null;
}

/** ¿La fila existente se editó? Se compara recortado, como viaja al backend:
 *  «SUC␠» sobre «SUC» no es una edición (viajaría idéntico y registraría una
 *  versión sin cambios reales). */
export function termEdited(t: { term: string; abbrev: string }, before: { term: string; abbrev: string }): boolean {
  return t.term.trim() !== before.term.trim() || t.abbrev.trim() !== before.abbrev.trim();
}

/** `termsUpsert` del apply: solo filas vivas nuevas o editadas de verdad
 *  (`termEdited`), recortadas; una nueva viaja sin id. Las borradas van por
 *  `termsDelete`. */
export function termsToUpsert<S extends string>(
  drafts: { id: string; term: string; abbrev: string; _new?: boolean; _deleted?: boolean }[],
  before: Map<string, { term: string; abbrev: string }>, scope: S,
): { id: string | undefined; term: string; abbrev: string; scope: S }[] {
  return drafts
    .filter((t) => {
      if (t._deleted) return false;
      if (t._new) return true;
      const b = before.get(t.id);
      return !b || termEdited(t, b);
    })
    // Sin descarte silencioso: el guard de filas incompletas garantiza término y abreviatura.
    .map((t) => ({ id: t._new ? undefined : t.id, term: t.term.trim(), abbrev: t.abbrev.trim(), scope }));
}

/** Filas nuevas o editadas (vivas) con término o abreviatura vacíos: bloquean
 *  el Save & apply (no se descartan en silencio). Una fila existente sin tocar
 *  no cuenta aunque ya esté guardada incompleta (tocarla solo con blancos
 *  tampoco). */
export function incompleteRows<T extends { id: string; term: string; abbrev: string; _new?: boolean; _deleted?: boolean }>(
  drafts: T[], before: Map<string, { term: string; abbrev: string }>,
): T[] {
  return drafts.filter((d) => {
    if (d._deleted || termGap(d) === null) return false;
    if (d._new) return true;
    const b = before.get(d.id);
    return !b || termEdited(d, b);
  });
}

/** Pie del editor con filas incompletas. */
export const incompleteMessage = (n: number): string =>
  (n === 1 ? '1 row needs a term and an abbreviation.' : `${fmt(n)} rows need a term and an abbreviation.`);

/** Aviso del botón Validar según lo que falta. */
export function gapToast(gap: TermGap): string {
  if (gap === 'abbrev') return 'Type the abbreviation before validating';
  if (gap === 'term') return 'Type the term before validating';
  return 'Type the term and the abbreviation before validating';
}

/** Límite del físico tal como lo aplica el motor: 0 = límite desactivado
 *  («No limit», no «0 chars»). */
export function maxLengthLabel(n: number): string {
  if (!n || n <= 0) return 'No limit';
  return `${n} ${n === 1 ? 'char' : 'chars'}`;
}
