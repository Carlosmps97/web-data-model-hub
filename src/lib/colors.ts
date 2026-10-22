/**
 * Colores de tablas, vistas y canvases. Espejo de
 * `backend-data-model-hub/app/core/colors.py` (misma gramática).
 *
 * Un color se guarda como referencia (`ColorRef`, un string):
 *   'theme:<id>'  un theme del proyecto (Data Standards → Themes): si cambia el
 *                 color del theme, cambian todas las cajas que lo usan
 *   '#RRGGBB'     un color fijo
 *   'none'        «sin color» — solo como excepción de un canvas
 *
 * Dónde vive: `CanonicalTable.color` / `View.color` (todos los canvases de la
 * tabla o vista; null = sin color) y `SubjectArea.colors` = {id: ColorRef}
 * (excepciones de ese canvas). Precedencia, como en Erwin: excepción del canvas
 * → color de la tabla → sin color.
 */

export const NO_COLOR = 'none';
const HEX = /^#[0-9A-Fa-f]{6}$/;
const THEME = /^theme:[A-Za-z0-9_.:-]{1,64}$/;

export interface Theme { id: string; name: string; color: string; order?: number }

/** Colores estándar del selector (los «Standard colors» de Office/Erwin). */
export const STANDARD_COLORS: { hex: string; name: string }[] = [
  { hex: '#C00000', name: 'Dark red' }, { hex: '#FF0000', name: 'Red' },
  { hex: '#FFC000', name: 'Orange' }, { hex: '#FFFF00', name: 'Yellow' },
  { hex: '#92D050', name: 'Light green' }, { hex: '#00B050', name: 'Green' },
  { hex: '#00B0F0', name: 'Light blue' }, { hex: '#0070C0', name: 'Blue' },
  { hex: '#002060', name: 'Dark blue' }, { hex: '#7030A0', name: 'Purple' },
];

/** Referencia normalizada (hex en mayúsculas) o null si no es válida.
 *  `allowNone`: si vale la palabra 'none' (excepción de canvas). Pura. */
export function normalColor(value: unknown, allowNone = false): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (HEX.test(v)) return v.toUpperCase();
  if (THEME.test(v)) return v;
  if (allowNone && v === NO_COLOR) return NO_COLOR;
  return null;
}

export const themeRef = (id: string): string => `theme:${id}`;
export const themeIdOf = (ref: string | null | undefined): string | null =>
  ref && ref.startsWith('theme:') ? ref.slice(6) : null;

/** Las excepciones de un canvas, solo las válidas. Pura. */
export function cleanColors(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const ref = normalColor(v, true);
    if (k && ref) out[k] = ref;
  }
  return out;
}

/** Hex de una referencia (null = sin color; un theme borrado, también). */
export function colorHex(ref: string | null | undefined, themes: Record<string, Theme> | Map<string, Theme>): string | null {
  const v = normalColor(ref, true);
  if (!v || v === NO_COLOR) return null;
  const tid = themeIdOf(v);
  if (tid === null) return v;
  const t = themes instanceof Map ? themes.get(tid) : themes[tid];
  return t ? normalColor(t.color) : null;
}

/** Referencia efectiva de una caja en un canvas: su excepción del canvas o, si
 *  no tiene, el color propio de la tabla/vista. Pura. */
export function effectiveRef(id: string, own: string | null | undefined,
  canvas: Record<string, string> | null | undefined): string | null {
  const ov = canvas && Object.prototype.hasOwnProperty.call(canvas, id) ? normalColor(canvas[id], true) : null;
  if (ov) return ov === NO_COLOR ? null : ov;
  return normalColor(own) ?? null;
}

/** Mezcla `hex` con blanco: `amount` = cuánto del color queda (0..1). Pura. */
export function tint(hex: string, amount: number): string {
  const v = normalColor(hex);
  if (!v || v.startsWith('theme:')) return '#FFFFFF';
  const n = parseInt(v.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * amount + 255 * (1 - amount));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Fondo del cuerpo de un bloque pintado y de su franja de llave: el color
 *  mezclado con blanco (legible, se reconoce de lejos). Puro. */
export const BODY_TINT = 0.45;
export const KEY_TINT = 0.62;
export function boxTints(hex: string): { body: string; key: string } {
  return { body: tint(hex, BODY_TINT), key: tint(hex, KEY_TINT) };
}

/** Nombre legible de una referencia para la UI («Entidad Principal», «#92D050»). */
export function colorLabel(ref: string | null | undefined, themes: Record<string, Theme> | Map<string, Theme>): string {
  const v = normalColor(ref, true);
  if (!v || v === NO_COLOR) return 'No color';
  const tid = themeIdOf(v);
  if (tid === null) return v;
  const t = themes instanceof Map ? themes.get(tid) : themes[tid];
  return t ? t.name : 'Removed theme';
}

/** Índice id → theme. Puro. */
export function themeIndex(themes: Theme[]): Map<string, Theme> {
  return new Map(themes.map((t) => [t.id, t]));
}
