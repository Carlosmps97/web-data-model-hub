// Doc 109: cómo se ve un dibujo del canvas (forma o texto) — una sola regla
// para el canvas y el export. Todo lo que el dibujo no trae toma el default de
// su tipo; los dibujos anteriores al doc 109 se ven igual que antes.
import type { CSSProperties } from 'react';
import type { Drawing, DrawingFont, TextAlign, TextVAlign } from '../services/modeler.service';
import { normalColor } from '@/lib/colors';

export const DEFAULT_STROKE = '#2E5BFF';
export const DEFAULT_TEXT_COLOR = '#1A2B4A';
/** Tamaño de letra por defecto, en puntos (≈ 14.7 px, el texto de siempre). */
export const DEFAULT_FONT_PT = 11;
/** Familia de la app (cuando el dibujo no elige una): la de `tokens.css`. */
export const APP_FONT = 'var(--ui)';

/** Familias del selector: las de Windows/Office que usan los modelos de Erwin
 *  (Microsoft Sans Serif es la de Erwin) y genéricas seguras. */
export const FONT_FAMILIES = [
  'Arial', 'Calibri', 'Cambria', 'Courier New', 'Georgia', 'Microsoft Sans Serif',
  'Segoe UI', 'Tahoma', 'Times New Roman', 'Verdana',
];
/** Tamaños del selector (puntos, como Office/Erwin). */
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

/** Texto «viejo» (anterior al doc 109): sin `font`, su `color` era el del texto. */
export const isLegacyText = (d: Drawing): boolean => d.type === 'text' && !d.font;
export const hasText = (d: Drawing): boolean => d.type !== 'line';

/** Borde (o línea): null = sin borde. Pura. */
export function drawingStroke(d: Drawing): string | null {
  if (isLegacyText(d)) return null;
  if (d.color === 'none') return null;
  const c = normalColor(d.color);
  if (c) return c;
  return d.type === 'text' ? null : DEFAULT_STROKE;
}

/** Relleno: null = transparente. Sin `fill`, las formas llevan el tinte suave
 *  de su borde (como siempre) y el texto, nada. Pura. */
export function drawingFill(d: Drawing): string | null {
  if (d.fill === 'none') return null;
  const f = normalColor(d.fill);
  if (f) return f;
  if (d.type === 'text' || d.type === 'line') return null;
  return `${normalColor(d.color) ?? DEFAULT_STROKE}1A`;
}

export interface ResolvedFont {
  family: string | null; size: number; bold: boolean; italic: boolean; underline: boolean; color: string;
}

/** Formato del texto con los defaults del tipo. Pura. */
export function drawingFont(d: Drawing): ResolvedFont {
  if (isLegacyText(d)) {
    // texto anterior al doc 109: 14 px seminegrita del color del dibujo
    return { family: null, size: 10.5, bold: true, italic: false, underline: false,
             color: normalColor(d.color) ?? DEFAULT_STROKE };
  }
  const f: DrawingFont = d.font ?? {};
  return {
    family: (f.family ?? '').trim() || null,
    size: typeof f.size === 'number' && f.size > 0 ? f.size : DEFAULT_FONT_PT,
    bold: !!f.bold, italic: !!f.italic, underline: !!f.underline,
    color: normalColor(f.color) ?? DEFAULT_TEXT_COLOR,
  };
}

export function drawingAlign(d: Drawing): { align: TextAlign; valign: TextVAlign } {
  if (isLegacyText(d)) return { align: 'left', valign: 'middle' };
  return {
    align: d.align ?? (d.type === 'text' ? 'left' : 'center'),
    valign: d.valign ?? 'middle',
  };
}

/** CSS de la familia: la elegida con la de la app de respaldo. */
export const fontStack = (family: string | null): string =>
  family ? `${JSON.stringify(family)}, ${APP_FONT}` : APP_FONT;

/** Estilo CSS del texto de un dibujo. Pura. */
export function textCss(d: Drawing): CSSProperties {
  const f = drawingFont(d);
  const { align, valign } = drawingAlign(d);
  return {
    fontFamily: fontStack(f.family),
    fontSize: `${f.size}pt`,
    fontWeight: isLegacyText(d) ? 600 : f.bold ? 700 : 400,
    fontStyle: f.italic ? 'italic' : 'normal',
    textDecoration: f.underline ? 'underline' : 'none',
    color: f.color,
    textAlign: align,
    justifyContent: valign === 'top' ? 'flex-start' : valign === 'bottom' ? 'flex-end' : 'center',
  };
}

/** Lo que pasa un texto viejo al modelo nuevo conservando cómo se veía
 *  (vacío si no es viejo). Toda edición desde la barra lo antepone: sin esto,
 *  el borde de un texto viejo cambiaba el color de su letra y la alineación no
 *  hacía nada. Pura. */
export function legacyUpgrade(d: Drawing): Partial<Drawing> {
  if (!isLegacyText(d)) return {};
  const f = drawingFont(d);
  return {
    font: { size: f.size, bold: true, color: f.color },
    color: null,                    // en el modelo nuevo `color` es el borde
    align: 'left', valign: 'middle',
  };
}

/** Patch de formato de texto sobre el `font` actual del dibujo (lo que el
 *  usuario cambia en la barra). Pura. */
export function fontPatch(d: Drawing, change: Partial<DrawingFont>): Pick<Drawing, 'font'> & Partial<Drawing> {
  const up = legacyUpgrade(d);
  return { ...up, font: { ...(up.font ?? d.font ?? {}), ...change } };
}
