/**
 * Lo último grabado de cada canvas en esta sesión del navegador.
 *
 * Un diagrama tarda en llegar. Si se pidió antes de que terminara un guardado
 * del canvas puede traer la posición o el trazo previos a ese guardado: al
 * pintarlo, lo recién grabado «se desharía solo» en pantalla hasta la
 * siguiente recarga. Con este registro, quien recibe el diagrama sabe si hay
 * algo más reciente que él y lo repone.
 *
 * El reloj es lógico (cuenta escrituras): no mide tiempo. Se anota por working
 * copy: lo grabado en una no se le repone a otra ni a producción.
 */
import { cleanRoutes, type WireRoutes } from './wireRoute';
import { cleanColors } from '@/lib/colors';

type Layout = Record<string, { x: number; y: number }>;
/** También los colores del canvas (excepciones por caja). */
export interface WrittenCanvas { layout: Layout; routes: WireRoutes; colors: Record<string, string> }

let clock = 0;
const written = new Map<string, WrittenCanvas & { at: number }>();
const key = (cs: string, saId: string) => `${cs}\n${saId}`;

const copyLayout = (layout: Layout | null | undefined): Layout => {
  const out: Layout = {};
  for (const [id, p] of Object.entries(layout ?? {})) out[id] = { x: p.x, y: p.y };
  return out;
};

/** Posiciones en píxeles enteros al grabar: React Flow mueve los bloques con
 *  decimales cuando el zoom no es 100 % (72.3315). Sin -0. */
export const wholePoint = <P extends { x: number; y: number }>(p: P): P => ({ ...p, x: whole(p.x), y: whole(p.y) });
const whole = (v: number): number => { const r = Math.round(v); return r === 0 ? 0 : r; };

/** El layout con cada posición entera; una entrada que no es un punto numérico
 *  pasa sin tocar (la valida el backend). */
export function wholeLayout<L extends Record<string, { x: number; y: number }>>(layout: L): L {
  const out: Record<string, { x: number; y: number }> = {};
  for (const [id, p] of Object.entries(layout)) {
    out[id] = p && typeof p.x === 'number' && typeof p.y === 'number' ? wholePoint(p) : p;
  }
  return out as L;
}

/** Marca para un diagrama que se está por pedir. */
export const canvasClock = (): number => clock;

/** Anota el documento que se acaba de grabar (`null` = el canvas se borró). */
export function noteCanvasWrite(
  cs: string, saId: string, doc: { layout?: Layout | null; routes?: unknown; colors?: unknown } | null,
): void {
  clock += 1;
  if (!doc) { written.delete(key(cs, saId)); return; }
  written.set(key(cs, saId), { at: clock, layout: copyLayout(doc.layout), routes: cleanRoutes(doc.routes),
                               colors: cleanColors(doc.colors) });
}

/** Posiciones, trazos y colores grabados después de la marca `asOf`; null si el
 *  diagrama pedido en esa marca ya los trae. */
export function writtenSince(cs: string | null, saId: string, asOf: number): WrittenCanvas | null {
  if (!cs) return null;
  const w = written.get(key(cs, saId));
  return w && w.at > asOf
    ? { layout: copyLayout(w.layout), routes: cleanRoutes(w.routes), colors: { ...w.colors } }
    : null;
}

/** Olvida todo (pruebas). */
export function forgetCanvasWrites(): void {
  written.clear();
}
