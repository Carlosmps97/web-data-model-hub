// Lógica pura del selector de tipos y dominios (doc 41). El combobox de
// "Type override" dejó de ser texto libre (fuente de errores según los
// modeladores): catálogo cerrado en MAYÚSCULAS (convención del DDV, y los
// defaults de dominio se comparan por string exacto), búsqueda "empieza por"
// case-insensitive, y tipos parametrizados editados por argumentos puntuales.
import { COLUMN_DATA_TYPES } from '@/types/model';

/** ¿`text` empieza con `query`? (case-insensitive; query vacía matchea todo).
 *  Deliberadamente "empieza por" y NO "contiene" (pedido de los modeladores). */
export function startsWithCI(text: string, query: string): boolean {
  return text.toLowerCase().startsWith(query.trim().toLowerCase());
}

/** Catálogo del combobox: canónico en MAYÚSCULAS, orden alfabético. Incluye
 *  STRUCT/ARRAY/MAP (elegirlos abre el builder — ya no van como botones). */
export const TYPE_OPTIONS: string[] = [...COLUMN_DATA_TYPES]
  .map((t) => t.toUpperCase())
  .sort();

// Tipos que reciben argumentos y sus etiquetas, en orden posicional.
const ARG_SPECS: Record<string, string[]> = {
  DECIMAL: ['precision', 'scale'],
  NUMERIC: ['precision', 'scale'],
  VARCHAR: ['length'],
  CHAR: ['length'],
  NVARCHAR: ['length'],
  VARBINARY: ['length'],
};

/** Etiquetas de argumentos del tipo (case-insensitive) o null si no lleva. */
export function argSpecFor(base: string): string[] | null {
  return ARG_SPECS[(base ?? '').trim().toUpperCase()] ?? null;
}

/** `DECIMAL(18,2)` → {base: 'DECIMAL', args: ['18','2']} (base normalizada a
 *  MAYÚSCULAS, tolerante a espacios/minúsculas). Solo bases del catálogo; los
 *  complejos (`<`) y los tipos fuera de catálogo devuelven null — el caller
 *  los muestra tal cual como opción extra (patrón SchemaSelect: un valor
 *  legacy no rompe la edición). */
export function parseParamType(value: string): { base: string; args: string[] } | null {
  const t = (value ?? '').trim();
  if (!t || t.includes('<')) return null;
  const m = /^([A-Za-z]+)\s*(?:\(([^)]*)\))?$/.exec(t);
  if (!m) return null;
  const base = m[1].toUpperCase();
  if (!TYPE_OPTIONS.includes(base)) return null;
  const args = (m[2] ?? '').trim() === ''
    ? []
    : (m[2] as string).split(',').map((a) => a.trim()).filter((a) => a !== '');
  return { base, args };
}

/** Arma el tipo desde base + argumentos: toma el PREFIJO no vacío (un scale
 *  sin precision no tiene sentido) y omite el paréntesis si no queda nada. */
export function composeParamType(base: string, args: string[]): string {
  const take: string[] = [];
  for (const a of args) {
    const v = (a ?? '').trim();
    if (v === '') break;
    take.push(v);
  }
  return take.length ? `${base}(${take.join(',')})` : base;
}
