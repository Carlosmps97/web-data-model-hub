// Doc 109: color de una caja (tabla o vista) en el canvas abierto — la regla
// de precedencia de `lib/colors.ts` con lo que el store tiene a mano. Lo usan
// TableNode/ViewNode (por selector: devuelve un string estable, así un cambio
// de color re-pinta sólo las cajas afectadas) y el export.
import type { CSSProperties } from 'react';
import { boxTints, colorHex, effectiveRef, type Theme } from '@/lib/colors';

/** Hex visible de la caja `id` (null = sin color). Pura. */
export function boxHex(id: string, own: string | null | undefined,
  canvas: Record<string, string> | null | undefined, themes: Map<string, Theme>): string | null {
  return colorHex(effectiveRef(id, own, canvas), themes);
}

/** Variables CSS del tinte de un bloque pintado (cuerpo y franja de llave). */
export function tintStyle(hex: string | null): CSSProperties | undefined {
  if (!hex) return undefined;
  const t = boxTints(hex);
  return { ['--tint-body' as string]: t.body, ['--tint-key' as string]: t.key } as CSSProperties;
}
