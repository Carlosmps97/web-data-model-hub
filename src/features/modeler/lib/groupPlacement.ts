/**
 * Dónde nace un grupo de tablas pegado (doc 134 §3.7): el grupo conserva las
 * distancias entre sus tablas (las que no traen posición van en fila a su
 * derecha) y se ubica como un solo bloque: al costado de los originales (+36 px,
 * como una tabla pegada) si se ven, si no centrado en lo que se ve; y no cae
 * exactamente encima de otro bloque ni de un pegado reciente (`avoidStacking`).
 * Posiciones enteras. Puro.
 */
import { avoidStacking, blockSpot, cascade, type CanvasView, type Point, type StackBox } from './canvasFocus';

/** Lo que se corre la copia respecto del original, y el aire entre las que no traen posición. */
const BESIDE = 36;
const GAP = 48;

export interface GroupItem { id: string; pos: Point | null; size: { w: number; h: number } }

export function groupSpots(
  items: GroupItem[],
  o: { beside: boolean; view: CanvasView | null; others: StackBox[]; recent: StackBox[] },
): Record<string, Point> {
  const placed = items.filter((i) => i.pos);
  const left = placed.length ? Math.min(...placed.map((i) => i.pos!.x)) : 0;
  const top = placed.length ? Math.min(...placed.map((i) => i.pos!.y)) : 0;
  let right = placed.length ? Math.max(...placed.map((i) => i.pos!.x + i.size.w)) : left - GAP;
  let bottom = placed.length ? Math.max(...placed.map((i) => i.pos!.y + i.size.h)) : top;
  // Dentro del grupo, respecto de su esquina.
  const offset = new Map<string, Point>();
  for (const i of placed) offset.set(i.id, { x: i.pos!.x - left, y: i.pos!.y - top });
  for (const i of items) {
    if (i.pos) continue;
    offset.set(i.id, { x: right + GAP - left, y: 0 });
    right += GAP + i.size.w;
    bottom = Math.max(bottom, top + i.size.h);
  }
  const size = { w: right - left, h: bottom - top };
  const spot = o.beside ? { x: left + BESIDE, y: top + BESIDE } : o.view ? blockSpot(o.view, size) : { x: 120, y: 120 };
  const at = avoidStacking(spot, size, o.others, o.recent, o.view?.rect) ?? cascade(spot, size, o.others, o.recent);
  const out: Record<string, Point> = {};
  for (const i of items) {
    const d = offset.get(i.id)!;
    out[i.id] = { x: Math.round(at.x + d.x), y: Math.round(at.y + d.y) };
  }
  return out;
}
