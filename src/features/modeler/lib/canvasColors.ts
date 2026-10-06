/**
 * Doc 112 — el color de las cajas EN un canvas, para la UI:
 *  - «Colors on this canvas» (ficha del canvas, Model properties): qué cajas
 *    pinta distinto este canvas y a cuáles se aplica «Paint on this canvas»;
 *  - Properties: el color que se ve en la caja y de dónde sale.
 *
 * Los niveles (doc 109): Data Standards → Themes es la LISTA de colores con
 * nombre del proyecto; el color de la tabla/vista se ve en todos sus canvases;
 * el de un canvas es una excepción de ESA caja en ESE canvas. Lo que se ve:
 * excepción del canvas → color de la tabla → sin color. Puro.
 */
import type { Diagram } from '../services/modeler.service';
import type { Facet } from '@/lib/facets';
import { normalColor } from '@/lib/colors';

export interface CanvasBox { id: string; kind: 'table' | 'view'; name: string; own: string | null }

/** Las cajas que se ven en el canvas abierto: las tablas (nombre según la
 *  faceta) y, en físico, las vistas (doc 63: en lógico no hay vistas). */
export function canvasBoxes(diagram: Pick<Diagram, 'tables' | 'views'> | null, facet: Facet): CanvasBox[] {
  if (!diagram) return [];
  const own = (c: unknown) => normalColor(c) ?? null;
  const tables = diagram.tables.map((t): CanvasBox => ({
    id: t.id, kind: 'table', own: own(t.color),
    name: facet === 'logical' ? t.logicalName || t.physicalName : t.physicalName,
  }));
  if (facet === 'logical') return tables;
  return [...tables, ...(diagram.views ?? []).map((v): CanvasBox => ({ id: v.id, kind: 'view', name: v.name, own: own(v.color) }))];
}

/** Las cajas que este canvas pinta distinto (sólo las que se ven y con una
 *  excepción válida), ordenadas por nombre sin importar mayúsculas. */
export function paintedHere(boxes: CanvasBox[], colors: Record<string, string>): (CanvasBox & { ref: string })[] {
  const out: (CanvasBox & { ref: string })[] = [];
  for (const b of boxes) {
    const ref = Object.prototype.hasOwnProperty.call(colors, b.id) ? normalColor(colors[b.id], true) : null;
    if (ref) out.push({ ...b, ref });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export type ColorSource = 'canvas' | 'table' | 'none';

/** El color que se ve en la caja `id` del canvas abierto y de dónde sale: su
 *  excepción en este canvas ('none' = sin color aquí), el color propio de su
 *  tabla o vista, o ninguno. */
export function shownColor(id: string, own: string | null | undefined,
  colors: Record<string, string>): { ref: string | null; source: ColorSource } {
  const here = Object.prototype.hasOwnProperty.call(colors, id) ? normalColor(colors[id], true) : null;
  if (here) return { ref: here, source: 'canvas' };
  const mine = normalColor(own);
  return mine ? { ref: mine, source: 'table' } : { ref: null, source: 'none' };
}

/** A qué cajas se aplica «Paint on this canvas»: las tablas y vistas
 *  SELECCIONADAS en el canvas que se ven; sin ninguna, la del panel Properties
 *  (`fallback`: tabla y vista seleccionadas). */
export function paintTargets(nodes: { id: string; type?: string; selected?: boolean }[],
  fallback: (string | null)[], visible: Set<string>): string[] {
  const picked = nodes
    .filter((n) => n.selected && (n.type === 'table' || n.type === 'view') && visible.has(n.id))
    .map((n) => n.id);
  if (picked.length) return [...new Set(picked)];
  const one = fallback.find((id): id is string => !!id && visible.has(id));
  return one ? [one] : [];
}
