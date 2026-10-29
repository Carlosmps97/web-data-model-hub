/**
 * Selección por área del canvas (doc 134 §3.2). El cuadro lo calcula la app, no
 * React Flow: React Flow da por «dentro» a todo nodo que aún no se dibujó (con
 * `onlyRenderVisibleElements`, las tablas lejanas que nunca entraron a la vista),
 * marca también las relaciones y dibuja su propio rectángulo sobre el grupo. Aquí
 * entra solo la tabla cuya caja (la medida o la estimada) queda completamente
 * dentro del cuadro. Lo seleccionado lo decide la app (el grupo o, sin grupo, la
 * tabla seleccionada) y se espeja en el `selected` de los nodos: es lo que React
 * Flow arrastra junto. Puro.
 */
import type { Node } from '@xyflow/react';
import type { FlowBox, Point } from './canvasFocus';

/** Píxeles de pantalla desde el `mousedown` para que sea un cuadro y no un clic
 *  (los mismos de `paneClickDistance`). */
export const BOX_DRAG_PX = 4;

export interface ScreenRect { left: number; top: number; width: number; height: number }

const rectOf = (a: Point, b: Point): ScreenRect =>
  ({ left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });

/** Las tablas (no ocultas) cuya caja queda completamente dentro de `box`. */
export function tablesInBox(nodes: Node[], box: FlowBox, boxOf: (n: Node) => FlowBox): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.type !== 'table' || n.hidden) continue;
    const b = boxOf(n);
    if (b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h) out.push(n.id);
  }
  return out;
}

/** La selección de la app en los nodos: con grupo, sus tablas y nada más (una
 *  vista o un dibujo seleccionados antes no viajan con el grupo); sin grupo, la
 *  tabla seleccionada (`single`) y lo que no es tabla, como estaba. El mismo
 *  arreglo si nada cambia. */
export function applySelection(nodes: Node[], group: ReadonlySet<string>, single: string | null): Node[] {
  let changed = false;
  const out = nodes.map((n) => {
    const want = n.type === 'table' ? (group.size ? group.has(n.id) : n.id === single) : !group.size && !!n.selected;
    if (!!n.selected === want) return n;
    changed = true;
    return { ...n, selected: want };
  });
  return changed ? out : nodes;
}

/** Ctrl/Cmd + clic en una tabla: el grupo (sin grupo, la tabla seleccionada) con
 *  esa tabla sumada o sacada. */
export function toggleGroup(group: string[], single: string | null, id: string): string[] {
  const base = group.length ? group : single ? [single] : [];
  return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
}

/** Las tablas seleccionadas, en el orden de los nodos. */
export const selectedTables = (nodes: Node[]): string[] => nodes.filter((n) => n.type === 'table' && n.selected).map((n) => n.id);

/** El gesto del cuadro, en coordenadas de pantalla: `move` devuelve el rectángulo
 *  a dibujar (null mientras sea un clic); `up` selecciona lo que quedó dentro y
 *  devuelve true si hubo cuadro (quien llama ataja el clic que sigue). */
export function createBoxGesture(deps: { toFlow: (p: Point) => Point; pick: (box: FlowBox) => string[]; onSelect: (ids: string[]) => void }) {
  let start: Point | null = null;
  let active = false;
  return {
    down(p: Point): void { start = p; active = false; },
    move(p: Point): ScreenRect | null {
      if (!start) return null;
      if (!active && Math.hypot(p.x - start.x, p.y - start.y) <= BOX_DRAG_PX) return null;
      active = true;
      return rectOf(start, p);
    },
    up(p: Point): boolean {
      const from = start;
      const was = active;
      start = null;
      active = false;
      if (!from || !was) return false;
      const r = rectOf(deps.toFlow(from), deps.toFlow(p));
      deps.onSelect(deps.pick({ x: r.left, y: r.top, w: r.width, h: r.height }));
      return true;
    },
    cancel(): void { start = null; active = false; },
  };
}
