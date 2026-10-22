/**
 * affectedRows: lógica pura de las listas de afectados. Los popups
 * de conflictos y de renombres del glosario y el de la cascada de un parent
 * domain comparten tabla (`AffectedTable.tsx`). Separada para testearla sin JSX.
 */

/** Espacios Unicode raros y caracteres de ancho cero: no se ven en pantalla. */
const INVISIBLE: Record<string, string> = {
  '\u00a0': 'no-break space',
  '\u2007': 'figure space',
  '\u202f': 'narrow no-break space',
  '\u200b': 'zero-width space',
  '\u200c': 'zero-width non-joiner',
  '\u200d': 'zero-width joiner',
  '\u2060': 'word joiner',
  '\ufeff': 'zero-width no-break space',
  '\t': 'tab',
};

/** El texto con cada carácter invisible reemplazado por «⍽»: se ve que existe. */
export function showInvisible(s: string | null | undefined): string {
  let out = '';
  for (const ch of s ?? '') out += INVISIBLE[ch] ? '⍽' : ch;
  return out;
}

/** Los invisibles presentes, p. ej. `['U+00A0 no-break space']`, sin repetir. */
export function invisibleChars(s: string | null | undefined): string[] {
  const out: string[] = [];
  for (const ch of s ?? '') {
    const name = INVISIBLE[ch];
    if (!name) continue;
    const label = `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')} ${name}`;
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

const fold = (s: string | null | undefined): string =>
  (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Filtro «contiene» sin mayúsculas ni tildes sobre los campos de cada fila. */
export function filterRows<T>(rows: T[], query: string, fields: (row: T) => (string | null | undefined)[]): T[] {
  const q = fold(query).trim();
  if (!q) return rows;
  return rows.filter((r) => fields(r).some((v) => fold(v).includes(q)));
}

/** Une una página del servidor a lo ya cargado: `offset` 0 sustituye todo; otra
 *  página solo se agrega si empieza justo donde termina lo cargado. Una respuesta
 *  repetida (dos scrolls previos al re-render) o fuera de orden se descarta: la
 *  lista no duplica filas ni se da por completa antes de tiempo. */
export function mergePage<T>(loaded: T[], page: T[], offset: number): T[] {
  if (offset === 0) return page;
  return offset === loaded.length ? [...loaded, ...page] : loaded;
}

const n = (x: number) => x.toLocaleString('en-US');

/** Pie de la tabla: «Showing 200 of 17,756» si falta cargar o hay filtro; si no, «17,756 rows». */
export function countLabel(shown: number, total: number): string {
  if (shown < total) return `Showing ${n(shown)} of ${n(total)}`;
  return `${n(total)} row${total === 1 ? '' : 's'}`;
}

/** Mueve el borde entre la columna `index` y la siguiente `dx` px: una crece y
 *  la vecina se achica en lo mismo (el total no cambia: el popup no
 *  se ensancha ni desborda), sin bajar de `min` y sin empujar al revés. */
export function resizeColumns(widths: number[], index: number, dx: number, min: number): number[] {
  if (index < 0 || index >= widths.length - 1) return widths;
  const a = widths[index], b = widths[index + 1];
  const d = dx < 0 ? Math.min(0, Math.max(dx, min - a)) : Math.max(0, Math.min(dx, b - min));
  if (d === 0) return widths;
  const out = [...widths];
  out[index] = a + d;
  out[index + 1] = b - d;
  return out;
}
