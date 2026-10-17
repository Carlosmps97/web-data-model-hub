/**
 * Doc 113 §1.3 — dónde van las tablas y vistas que ENTRARON a un canvas con la
 * carga Excel. Antes la carga corría el Autoarrange COMPLETO (movía todos los
 * bloques y reiniciaba los trazos manuales de wires); ahora lo existente no se
 * toca:
 *  · lo nuevo (tablas + las vistas de esas tablas) se ordena como GRUPO con el
 *    mismo motor del Autoarrange (ELK), sólo con esos bloques: no se pisan entre
 *    sí y cada vista queda a la derecha de su tabla;
 *  · el grupo se centra en `focus` (el centro de lo que el usuario ve, si es el
 *    canvas abierto) o en el centro del contenido existente; en un canvas sin
 *    nada, arriba a la izquierda. Si ahí había bloques, lo nuevo queda encima
 *    (el canvas lo pinta por delante: `freshNodes`), sin moverlos;
 *  · una vista nueva de una tabla que YA estaba va pegada a la derecha de su
 *    tabla y baja si chocaría con otro bloque nuevo.
 * Tamaños: la estimación LOD en físico (la carga es del modelo físico), la misma
 * del Autoarrange sin nodos medidos. Devuelve, en píxeles enteros, la posición
 * de lo que entró y (ronda 2 de la revisión) la de lo existente SIN posición
 * guardada que el canvas correría de lugar, fijado donde estaba: las tablas
 * sin posición se pintan por su número de orden (el backend ordena por nombre,
 * también en el draft) y una tabla que entra y ordena antes las corre — se
 * fijan todas, así tampoco las corre un alta posterior —; una vista sin
 * posición se re-anclaría a una tabla que entra si es su primera fuente.
 */
import type { Diagram } from '../services/modeler.service';
import type { CanonicalColumn } from '@/services/governance.service';
import type { Point } from './canvasFocus';
import { tableLodSize, viewLodSize } from './lodSize';
import { defaultViewPosition, viewSourceIds } from './viewGraph';
import { gridSlot } from './viewerLayout';

export interface LayoutNode { id: string; width: number; height: number }
export interface LayoutEdge { id: string; source: string; target: string }
/** Motor de layout del grupo (ELK por defecto; inyectable en tests). */
export type LayoutFn = (nodes: LayoutNode[], edges: LayoutEdge[]) => Promise<Record<string, Point>>;

/** Separación tabla → vista: la de capas del Autoarrange (`elkLayout`). */
const VIEW_GAP_X = 140;
/** Aire al bajar una vista que chocaría con otro bloque nuevo. */
const STACK_GAP_Y = 40;
/** Esquina del grupo en un canvas vacío (la de la grilla provisional del backend). */
const ORIGIN = 40;

const elk: LayoutFn = async (nodes, edges) => {
  const { elkLayout } = await import('./elkLayout');
  return elkLayout(nodes.map((n) => ({ id: n.id, position: { x: 0, y: 0 }, data: {}, width: n.width, height: n.height })) as never, edges as never);
};

interface Box { x: number; y: number; w: number; h: number }
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function centerOf(bs: Box[]): Point | null {
  if (!bs.length) return null;
  const l = Math.min(...bs.map((b) => b.x)), t = Math.min(...bs.map((b) => b.y));
  const r = Math.max(...bs.map((b) => b.x + b.w)), btm = Math.max(...bs.map((b) => b.y + b.h));
  return { x: (l + r) / 2, y: (t + btm) / 2 };
}

/** Dónde está HOY cada bloque existente (`now`) y cuáles fijar (`pins`) para
 *  que lo que entra — tablas `tables` y vistas `views` — no los corra: su
 *  posición guardada o, si no tiene (entró sin layout, antes del doc 113), donde
 *  lo pinta el canvas — la grilla por número de orden entre lo que ya estaba
 *  para las tablas, y a la derecha de su primera fuente que ya estaba para las
 *  vistas. Si entra una tabla se fijan TODAS las tablas sin posición (una que
 *  ordena antes las corre de casilla; así tampoco las corre un alta posterior)
 *  y las vistas sin posición cuya primera fuente presente pasaría a ser una
 *  tabla que entra. `dia` puede ser el canvas de ANTES (doc 114: crear,
 *  importar, CTAS, pegar — lo que entra todavía no está) o el de DESPUÉS (la
 *  carga Excel: lo que entró ya está y se salta). Puro. */
export function pinsForEntering(
  dia: Diagram, tables: readonly string[], views: readonly string[] = [],
): { now: Record<string, Point>; pins: Record<string, Point> } {
  const fresh = new Set([...tables, ...views]);
  const after = new Set([...dia.tables.map((t) => t.id), ...tables]);
  const before = new Set(dia.tables.filter((t) => !fresh.has(t.id)).map((t) => t.id));
  const saved = dia.subjectArea.layout ?? {};
  const now: Record<string, Point> = {};
  const pins: Record<string, Point> = {};
  let order = 0;
  for (const t of dia.tables) {
    if (fresh.has(t.id)) continue;
    now[t.id] = saved[t.id] ?? gridSlot(order);
    if (!saved[t.id] && tables.length) pins[t.id] = now[t.id];
    order += 1;
  }
  for (const v of dia.views ?? []) {
    const src = viewSourceIds(v);
    if (fresh.has(v.id) || !src.some((id) => after.has(id))) continue;
    if (saved[v.id]) { now[v.id] = saved[v.id]; continue; }
    const was = src.find((id) => before.has(id));
    if (!was) continue;                        // no se veía: ninguna fuente estaba
    now[v.id] = defaultViewPosition(now[was]);
    if (src.find((id) => after.has(id)) !== was) pins[v.id] = now[v.id];
  }
  return { now, pins };
}

/** Revisión doc 114: lo mismo al SACAR o BORRAR tablas (`leaving`) del canvas
 *  abierto — las que siguen sin posición se correrían una casilla hacia atrás
 *  (y un Undo posterior dejaba una tabla tapando a otra): se fijan donde se ven,
 *  igual que las vistas sin posición cuya primera fuente presente sale y les
 *  queda otra. `dia` = el canvas de ANTES de sacarlas. Puro. */
export function pinsForLeaving(dia: Diagram, leaving: readonly string[]): Record<string, Point> {
  const out = new Set(leaving);
  if (!dia.tables.some((t) => out.has(t.id))) return {};
  const saved = dia.subjectArea.layout ?? {};
  const now = new Map<string, Point>();
  const pins: Record<string, Point> = {};
  dia.tables.forEach((t, i) => {
    now.set(t.id, saved[t.id] ?? gridSlot(i));
    if (!saved[t.id] && !out.has(t.id)) pins[t.id] = now.get(t.id)!;
  });
  for (const v of dia.views ?? []) {
    if (saved[v.id] || out.has(v.id)) continue;
    const present = viewSourceIds(v).filter((id) => now.has(id));
    const after = present.find((id) => !out.has(id));
    if (present[0] && after && present[0] !== after) pins[v.id] = defaultViewPosition(now.get(present[0])!);
  }
  return pins;
}

/** Revisión 2 doc 114 (R2-1): dónde se ve la tabla `id` en el canvas `dia` — su
 *  posición guardada o su casilla por número de orden; null si no está. El Undo
 *  de borrar una tabla la repone ahí en cada canvas que no estaba abierto. Puro. */
export function seenAt(dia: Diagram, id: string): Point | null {
  const i = dia.tables.findIndex((t) => t.id === id);
  return i < 0 ? null : dia.subjectArea.layout?.[id] ?? gridSlot(i);
}

export async function placeNewMembers(
  dia: Diagram, entering: string[], focus: Point | null, layout: LayoutFn = elk,
): Promise<Record<string, Point>> {
  const fresh = new Set(entering);
  if (!fresh.size) return {};
  const colsByTable = new Map<string, CanonicalColumn[]>();
  const colTypes: Record<string, string> = {};
  for (const c of dia.columns) {
    (colsByTable.get(c.tableId) ?? colsByTable.set(c.tableId, []).get(c.tableId)!).push(c);
    colTypes[`${c.tableId}::${c.physicalName}`] = c.dataType;
  }
  const tableIds = new Set(dia.tables.map((t) => t.id));
  const size = new Map<string, { w: number; h: number }>();
  for (const t of dia.tables) {
    const s = tableLodSize(t, colsByTable.get(t.id) ?? [], 'physical');
    size.set(t.id, { w: s.w, h: s.h });
  }
  // Las vistas que el canvas muestra: con al menos una fuente presente.
  const views = (dia.views ?? []).filter((v) => viewSourceIds(v).some((id) => tableIds.has(id)));
  for (const v of views) size.set(v.id, viewLodSize(v, colTypes));
  const anchorOf = new Map(views.map((v) => [v.id, viewSourceIds(v).find((id) => tableIds.has(id))!]));
  const { now, pins } = pinsForEntering(dia, entering.filter((id) => tableIds.has(id)), entering.filter((id) => !tableIds.has(id)));

  // Lo existente: sus cajas, para el centro del contenido (canvas no abierto).
  const existing: Box[] = [];
  for (const [id, s] of size) {
    const p = now[id];
    if (!fresh.has(id) && p) existing.push({ x: p.x, y: p.y, ...s });
  }

  // Vista nueva pegada a una tabla que ya estaba (y tiene posición) → al lado
  // de su tabla; el resto de lo nuevo → el grupo.
  const attached = views.filter((v) => {
    const tid = anchorOf.get(v.id)!;
    return fresh.has(v.id) && !fresh.has(tid) && !!now[tid];
  }).map((v) => v.id);
  const attachedSet = new Set(attached);
  const group = [
    ...dia.tables.filter((t) => fresh.has(t.id)).map((t) => t.id),
    ...views.filter((v) => fresh.has(v.id) && !attachedSet.has(v.id)).map((v) => v.id),
  ];

  const out: Record<string, Point> = {};
  const placed: Box[] = [];
  if (group.length) {
    const inGroup = new Set(group);
    const edges: LayoutEdge[] = [
      ...dia.relationships.filter((r) => inGroup.has(r.parentTableId) && inGroup.has(r.childTableId))
        .map((r) => ({ id: r.id, source: r.parentTableId, target: r.childTableId })),
      ...views.filter((v) => inGroup.has(v.id)).flatMap((v) => viewSourceIds(v).filter((t) => inGroup.has(t))
        .map((t) => ({ id: `deriv__${v.id}__${t}`, source: t, target: v.id }))),
    ];
    const raw = await layout(group.map((id) => ({ id, width: size.get(id)!.w, height: size.get(id)!.h })), edges);
    const rawBoxes = group.map((id) => ({ id, x: raw[id]?.x ?? 0, y: raw[id]?.y ?? 0, ...size.get(id)! }));
    const l = Math.min(...rawBoxes.map((b) => b.x)), t = Math.min(...rawBoxes.map((b) => b.y));
    const r = Math.max(...rawBoxes.map((b) => b.x + b.w)), btm = Math.max(...rawBoxes.map((b) => b.y + b.h));
    const target = focus ?? centerOf(existing);
    const dx = target ? target.x - (l + r) / 2 : ORIGIN - l;
    const dy = target ? target.y - (t + btm) / 2 : ORIGIN - t;
    for (const b of rawBoxes) {
      const p = { x: Math.round(b.x + dx), y: Math.round(b.y + dy) };
      out[b.id] = p;
      placed.push({ ...p, w: b.w, h: b.h });
    }
  }
  for (const vid of attached) {
    const tid = anchorOf.get(vid)!;
    const tp = now[tid];
    let box: Box = { x: Math.round(tp.x + size.get(tid)!.w + VIEW_GAP_X), y: Math.round(tp.y), ...size.get(vid)! };
    for (let guard = 0; guard < 1000; guard++) {
      const hit = placed.find((p) => overlaps(p, box));
      if (!hit) break;
      box = { ...box, y: hit.y + hit.h + STACK_GAP_Y };
    }
    out[vid] = { x: box.x, y: box.y };
    placed.push(box);
  }
  return { ...out, ...pins };
}
