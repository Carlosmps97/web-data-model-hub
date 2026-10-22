// Color de una caja (tabla o vista) en el canvas abierto: la regla de
// precedencia de `lib/colors.ts` con lo que el store tiene a mano. Lo usan
// TableNode/ViewNode (por selector: devuelve un string estable, así un cambio
// de color re-pinta solo las cajas afectadas) y el export.
import type { CSSProperties } from 'react';
import { boxTints, colorHex, effectiveRef, type Theme } from '@/lib/colors';

const NO_EXCEPTION: Record<string, string> = {};

/** Hex visible de la caja `id` (null = sin color). `preview` = los colores
 *  pendientes de la ficha del canvas abierta (sin grabar): una caja que
 *  está ahí se ve con ese color (null = vuelve al de su tabla). Pura. */
export function boxHex(id: string, own: string | null | undefined,
  canvas: Record<string, string> | null | undefined, themes: Map<string, Theme>,
  preview?: Record<string, string | null> | null): string | null {
  if (preview && Object.prototype.hasOwnProperty.call(preview, id)) {
    const ref = preview[id];
    return colorHex(effectiveRef(id, own, ref === null ? NO_EXCEPTION : { [id]: ref }), themes);
  }
  return colorHex(effectiveRef(id, own, canvas), themes);
}

/** Variables CSS del tinte de un bloque pintado (cuerpo y franja de llave). */
export function tintStyle(hex: string | null): CSSProperties | undefined {
  if (!hex) return undefined;
  const t = boxTints(hex);
  return { ['--tint-body' as string]: t.body, ['--tint-key' as string]: t.key } as CSSProperties;
}
