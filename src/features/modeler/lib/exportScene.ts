// Doc 59: motor de export SIN captura de DOM.
//
// html-to-image clonaba ~450k elementos con getComputedStyle por elemento y
// serializaba cientos de MB (minutos de bloqueo + RangeError en canvases
// gigantes). Este módulo dibuja el diagrama DESDE EL MODELO — tablas,
// columnas, relaciones, vistas, subcategorías y shapes — con las MISMAS
// métricas del canvas (header 32 / fila 28 / clamp 240..880, espejo de
// lodSize.ts y scripts/arrange_all.py) y los mismos ruteos (getSmoothStepPath
// / getBezierPath de React Flow son funciones puras). El resultado es una
// ESCENA intermedia (rects/paths/textos con coordenadas absolutas) que
// serializan sceneSvg.ts y scenePdf.ts: solo el diagrama, cero metadata.
//
// Colores = tokens.css RESUELTOS a literal (el export vive fuera del
// documento). Los rgba/opacity se PRE-MEZCLAN sobre su fondo real: la escena
// no maneja transparencia (simplifica el PDF).
import { Position, getBezierPath, getSmoothStepPath } from '@xyflow/react';
import type { CanonicalColumn, Cardinality } from '@/services/governance.service';
import type { Diagram, Drawing } from '@/features/modeler/services/modeler.service';
import type { View } from '@/services/views.service';
import { collapseComplexType } from './complexTypes';
import { orderColumns } from './columnOrder';
import { HEADER_H, ROW_H, fanSlots, fanSourceY } from './edgeFanout';
import { relationshipDrift } from './relationshipPairs';
import { SYMBOL_SIZE, isSubcategory, subtypeGroups, symbolDefaultPos } from './subtypeGraph';
import { viewNodeRows, viewSourceIds } from './viewGraph';

// ── IR de la escena ────────────────────────────────────────────────────────
export type SceneItem =
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; sw?: number; rx?: number; dash?: string; rtop?: boolean }
  | { k: 'hatch'; x: number; y: number; w: number; h: number }
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: string; stroke?: string; sw?: number }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number; dash?: string; cap?: 'round' }
  | { k: 'poly'; pts: [number, number][]; fill?: string; stroke?: string; sw?: number; join?: 'round' }
  | { k: 'path'; d: string; stroke?: string; sw?: number; dash?: string; fill?: string }
  | { k: 'text'; x: number; y: number; s: string; size: number; color: string; mono?: boolean; bold?: boolean; italic?: boolean; anchor?: 'start' | 'middle' | 'end'; ls?: number };

export interface Scene { w: number; h: number; bg: string; items: SceneItem[] }

export interface SceneInput {
  diagram: Diagram | null;
  drawings: Drawing[];
  viewMode: 'logical' | 'physical';
}

// ── Tokens resueltos (tokens.css) y mezclas pre-calculadas ────────────────
const C = {
  bg: '#FBFCFD',            // --canvas-bg
  surface: '#ffffff',
  border: '#E2E6EE',        // --border-1
  navy: '#1A2B4A',          // header de tabla
  headSchema: '#A8AFBA',    // blanco .62 sobre navy
  headGlyph: '#E8EAED',     // blanco .9 sobre navy
  pkZone: '#E3EBFF',        // --blue-soft-2
  pkInset: '#D6E0F5',
  rowSep: '#F2F4F8',
  text: '#3A4658',          // --text-body / --ink-2
  muted: '#8A93A5',         // --text-muted-2
  pk: '#E0A024',            // --k-pk (amber)
  fk: '#2E5BFF',            // --k-fk / --blue
  red: '#C0392B',
  deriv: '#94A3B8',
  vHead: '#5D6675',
  vHeadSchema: '#C1C4CB',   // blanco .62 sobre vHead
  vBadge: '#CBD1DA',
  vBody: '#EDEFF4',
  vBorder: '#C5CCD8',
  vRowSep: '#DADDE4',       // rgba(90,102,117,.13) sobre vBody
  vFxBg: '#FBFBFC',         // blanco .75 sobre vBody
  vFxBorder: '#D5DBE4',
  vFxText: '#7A8598',
} as const;

// Métricas del canvas (.wk-node) — espejo de lodSize.ts / arrange_all.py.
const PADX = 11;
const KEY_W = 14, GAP = 7;
const CHAR_UI = 7.4;        // Geist 12px, nombres UPPER_SNAKE
const CHAR_MONO = 6;        // Geist Mono 10px (tipos)
const CHAR_HEAD = 7.2;      // header 12px bold mono-ish
const clampW = (chars: number) => Math.min(880, Math.max(240, Math.round(chars * 8 + 72)));

const trunc = (s: string, maxChars: number): string =>
  s.length <= maxChars ? s : `${s.slice(0, Math.max(1, maxChars - 1))}…`;

interface Box { x: number; y: number; w: number; h: number }

interface TableBox extends Box {
  t: Diagram['tables'][number];
  ordered: CanonicalColumn[];
  pkRows: number;
  rowIdx: Map<string, number>;
}

const nameOf = (mode: 'logical' | 'physical') =>
  (o: { logicalName: string; physicalName: string }) => (mode === 'logical' ? o.logicalName : o.physicalName);

/** Y del centro de la fila de una columna (ancla de wires), o centro del header. */
function rowCenterY(b: TableBox, colId: string | null | undefined): number {
  const idx = colId != null ? b.rowIdx.get(colId) : undefined;
  return idx == null ? b.y + HEADER_H / 2 : b.y + HEADER_H + idx * ROW_H + ROW_H / 2;
}

/** Marcador crow-foot en un extremo del wire. `away` = dirección X del wire
 *  ALEJÁNDOSE del nodo (+1 derecha). Geometría espejo de CrowFootMarkers
 *  (viewBox 0..20, lado del nodo en x=20): u(x) = borde + away·(20−x). */
function crowfoot(items: SceneItem[], edgeX: number, y: number, away: 1 | -1, card: Cardinality, color: string) {
  const u = (x: number) => edgeX + away * (20 - x);
  const line = (x1: number, dy1: number, x2: number, dy2: number) =>
    items.push({ k: 'line', x1: u(x1), y1: y + dy1, x2: u(x2), y2: y + dy2, stroke: color, sw: 1.5 });
  const many = card === 'many' || card === 'one-many' || card === 'zero-many';
  const zero = card === 'zero-one' || card === 'zero-many';
  if (many) {
    line(11, 0, 20, -6); line(11, 0, 20, 6); line(11, 0, 20, 0);
    if (card === 'one-many') line(8, -5, 8, 5);
  } else {
    line(13.5, -5, 13.5, 5);
    if (card === 'one-only') line(10.5, -5, 10.5, 5);
  }
  if (zero) items.push({ k: 'ellipse', cx: u(5.5), cy: y, rx: 3, ry: 3, fill: C.surface, stroke: color, sw: 1.4 });
}

const EMPTY_SCENE: Scene = { w: 640, h: 400, bg: C.bg, items: [] };

export function buildDiagramScene(input: SceneInput): Scene {
  const { diagram, drawings, viewMode } = input;
  if (!diagram && !drawings.length) return EMPTY_SCENE;
  const name = nameOf(viewMode);
  const items: SceneItem[] = [];

  // ── Fase 1: cajas de TODOS los nodos (coordenadas del canvas) ───────────
  const layout = diagram?.subjectArea.layout ?? {};
  const colsByTable = new Map<string, CanonicalColumn[]>();
  (diagram?.columns ?? []).forEach((c) => {
    const a = colsByTable.get(c.tableId); if (a) a.push(c); else colsByTable.set(c.tableId, [c]);
  });

  const tableBoxes = new Map<string, TableBox>();
  // Mismas filas que el canvas (doc 74/94): el orden único — PK primero y cada
  // bloque por `ordinal` — en ambas facetas.
  (diagram?.tables ?? []).forEach((t, i) => {
    const cols = colsByTable.get(t.id) ?? [];
    const ordered = orderColumns(cols);
    const header = t.schema ? `${t.schema}.${name(t)}` : name(t);
    let maxcol = 12;
    for (const c of cols) {
      const len = name(c).length + collapseComplexType(c.dataType).length;
      if (len > maxcol) maxcol = len;
    }
    const pos = layout[t.id] ?? { x: 60 + (i % 4) * 260, y: 60 + Math.floor(i / 4) * 220 };
    tableBoxes.set(t.id, {
      t, x: pos.x, y: pos.y,
      w: clampW(Math.max(header.length, maxcol + 3)),
      h: HEADER_H + Math.max(1, cols.length) * ROW_H,
      ordered, pkRows: ordered.filter((c) => c.isPrimaryKey).length,
      rowIdx: new Map(ordered.map((c, idx) => [c.id, idx])),
    });
  });

  // dataType por `${tableId}::${physicalName}` (filas del nodo vista).
  const colTypes: Record<string, string> = {};
  (diagram?.columns ?? []).forEach((c) => { colTypes[`${c.tableId}::${c.physicalName}`] = c.dataType; });

  interface ViewBox extends Box { v: View; rows: ReturnType<typeof viewNodeRows>; present: string[] }
  const viewBoxes: ViewBox[] = [];
  // Doc 63: vistas SOLO en modelo físico — paridad export ↔ canvas.
  for (const v of (viewMode === 'physical' ? diagram?.views ?? [] : [])) {
    const present = viewSourceIds(v).filter((id) => tableBoxes.has(id));
    if (!present.length) continue;
    const rows = viewNodeRows(v, colTypes);
    const header = v.schema ? `${v.schema}.${v.name}` : v.name;
    let maxrow = 12;
    for (const r of rows) {
      const len = r.name.length + collapseComplexType(r.type).length;
      if (len > maxrow) maxrow = len;
    }
    const anchor = tableBoxes.get(present[0])!;
    const pos = layout[v.id] ?? { x: anchor.x + 280, y: anchor.y };
    viewBoxes.push({
      v, rows, present, x: pos.x, y: pos.y,
      w: clampW(Math.max(header.length, maxrow + 6)),
      h: HEADER_H + Math.max(1, rows.length) * ROW_H,
    });
  }

  const subRels = viewMode === 'logical' ? (diagram?.relationships ?? []).filter(isSubcategory) : [];
  const symbolBoxes = new Map<string, Box>();
  for (const g of subtypeGroups(subRels)) {
    const p = tableBoxes.get(g.parentTableId);
    if (!p) continue;
    const kids = g.rels.map((r) => tableBoxes.get(r.childTableId)).filter((b): b is TableBox => !!b);
    const pos = layout[g.symbolId] ?? symbolDefaultPos({ x: p.x, y: p.y, w: p.w, h: p.h }, kids);
    symbolBoxes.set(g.symbolId, { x: pos.x, y: pos.y, w: SYMBOL_SIZE, h: SYMBOL_SIZE });
  }

  // ── Fase 2: bounds + traslación (padding 60) ────────────────────────────
  const boxes: Box[] = [...tableBoxes.values(), ...viewBoxes, ...symbolBoxes.values(), ...drawings];
  if (!boxes.length) return EMPTY_SCENE;
  const minX = Math.min(...boxes.map((b) => b.x)) - 60;
  const minY = Math.min(...boxes.map((b) => b.y)) - 60;
  const maxX = Math.max(...boxes.map((b) => b.x + b.w)) + 60;
  const maxY = Math.max(...boxes.map((b) => b.y + b.h)) + 60;
  for (const b of [...tableBoxes.values(), ...viewBoxes, ...symbolBoxes.values()]) { b.x -= minX; b.y -= minY; }
  const dwx = (d: Drawing): Box => ({ x: d.x - minX, y: d.y - minY, w: d.w, h: d.h });

  // ── Fase 3: SHAPES (capa de fondo, zIndex -1 en el canvas) ──────────────
  for (const d of drawings) {
    const b = dwx(d);
    const color = d.color ?? '#2E5BFF';
    const soft = `${color}1A`;
    switch (d.type) {
      case 'rect': case 'square':
        items.push({ k: 'rect', ...b, rx: 8, fill: soft, stroke: color, sw: 2 }); break;
      case 'circle': case 'ellipse':
        items.push({ k: 'ellipse', cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2, fill: soft, stroke: color, sw: 2 }); break;
      case 'line':
        items.push({ k: 'line', x1: b.x, y1: b.y + b.h / 2, x2: b.x + b.w, y2: b.y + b.h / 2, stroke: color, sw: 2.4, cap: 'round' }); break;
      case 'diamond':
        items.push({ k: 'poly', pts: [[b.x + b.w / 2, b.y], [b.x + b.w, b.y + b.h / 2], [b.x + b.w / 2, b.y + b.h], [b.x, b.y + b.h / 2]], fill: soft, stroke: color, sw: 2 }); break;
      case 'star': {
        const pts: [number, number][] = [];
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? 0.48 : 0.19;
          const a = (Math.PI / 5) * i - Math.PI / 2;
          pts.push([b.x + b.w / 2 + r * b.w * Math.cos(a), b.y + b.h / 2 + r * b.h * Math.sin(a)]);
        }
        items.push({ k: 'poly', pts, fill: soft, stroke: color, sw: 2, join: 'round' });
        break;
      }
      case 'text': {
        const budget = Math.max(4, Math.floor((b.w - 8) / 8.4));
        const lines = (d.text || 'Text').split('\n').flatMap((ln) => {
          const out: string[] = [];
          for (let s = ln; s.length > budget; s = s.slice(budget)) out.push(s.slice(0, budget));
          out.push(...(ln.length > budget ? [ln.slice(Math.floor(ln.length / budget) * budget)] : [ln]));
          return ln.length > budget ? out.slice(0, -1) : out;
        });
        const lh = 18.2;
        const y0 = b.y + b.h / 2 - (lines.length * lh) / 2 + 13;
        lines.forEach((s, i) => items.push({ k: 'text', x: b.x + 4, y: y0 + i * lh, s, size: 14, color, bold: true }));
        break;
      }
    }
  }

  // ── Fase 4: EDGES (React Flow los pinta bajo los nodos) ─────────────────
  const pkIdsByTable = new Map<string, Set<string>>();
  (diagram?.columns ?? []).forEach((c) => {
    if (!c.isPrimaryKey) return;
    const s = pkIdsByTable.get(c.tableId); if (s) s.add(c.id); else pkIdsByTable.set(c.tableId, new Set([c.id]));
  });
  const stdRels = (diagram?.relationships ?? []).filter((r) => !isSubcategory(r) && tableBoxes.has(r.parentTableId) && tableBoxes.has(r.childTableId));
  const slots = fanSlots(stdRels.map((r) => {
    const tp = tableBoxes.get(r.childTableId)!;
    return { id: r.id, parentId: r.parentTableId, targetY: tp.y, targetX: tp.x };
  }));

  const sidesOf = (s: Box, t: Box) => {
    const facesRight = s.x + s.w / 2 <= t.x + t.w / 2;
    return {
      sx: facesRight ? s.x + s.w : s.x,
      tx: facesRight ? t.x : t.x + t.w,
      sPos: facesRight ? Position.Right : Position.Left,
      tPos: facesRight ? Position.Left : Position.Right,
      awayS: (facesRight ? 1 : -1) as 1 | -1,
      awayT: (facesRight ? -1 : 1) as 1 | -1,
    };
  };

  for (const r of stdRels) {
    const p = tableBoxes.get(r.parentTableId)!;
    const c = tableBoxes.get(r.childTableId)!;
    const { sx, tx, sPos, tPos, awayS, awayT } = sidesOf(p, c);
    const fan = slots.get(r.id);
    const sy = fanSourceY(p.y, p.h, p.pkRows, fan?.slot ?? 0, fan?.count ?? 1);
    const ty = rowCenterY(c, r.pairs[0]?.childColumnId);
    const pkIds = [...(pkIdsByTable.get(r.parentTableId) ?? new Set<string>())];
    const color = relationshipDrift(r, pkIds) != null ? C.red : C.text;
    const [d] = getSmoothStepPath({ sourceX: sx, sourceY: sy, sourcePosition: sPos, targetX: tx, targetY: ty, targetPosition: tPos, borderRadius: 10 });
    items.push({ k: 'path', d, stroke: color, sw: 1.5, dash: r.identifying ? undefined : '7 4' });
    crowfoot(items, sx, sy, awayS, r.parentCardinality ?? 'one', color);
    crowfoot(items, tx, ty, awayT, r.childCardinality ?? 'zero-many', color);
  }

  // Derivación tabla→vista: bezier libre gris + anillo hueco en la vista.
  for (const vb of viewBoxes) {
    for (const tid of vb.present) {
      const t = tableBoxes.get(tid)!;
      const [d] = getBezierPath({
        sourceX: t.x + t.w, sourceY: t.y + HEADER_H / 2, sourcePosition: Position.Right,
        targetX: vb.x, targetY: vb.y + HEADER_H / 2, targetPosition: Position.Left, curvature: 0.35,
      });
      items.push({ k: 'path', d, stroke: C.deriv, sw: 1.2 });
      items.push({ k: 'ellipse', cx: vb.x, cy: vb.y + HEADER_H / 2, rx: 3.5, ry: 3.5, fill: C.bg, stroke: C.deriv, sw: 1.5 });
    }
  }

  // Subcategorías (doc 53, solo lógico): tronco y ramas con TRAZO DOBLE
  // (ancho color + carve central color canvas).
  const dbl = (d: string, color: string) => {
    items.push({ k: 'path', d, stroke: color, sw: 4.4 });
    items.push({ k: 'path', d, stroke: C.bg, sw: 1.8 });
  };
  for (const g of subtypeGroups(subRels)) {
    const sym = symbolBoxes.get(g.symbolId);
    const p = tableBoxes.get(g.parentTableId);
    if (!sym || !p) continue;
    {
      const { sx, tx, sPos, tPos } = sidesOf(p, sym);
      const [d] = getSmoothStepPath({ sourceX: sx, sourceY: p.y + HEADER_H / 2, sourcePosition: sPos, targetX: tx, targetY: sym.y + sym.h / 2, targetPosition: tPos, borderRadius: 10 });
      dbl(d, C.text);
    }
    for (const r of g.rels) {
      const c = tableBoxes.get(r.childTableId);
      if (!c) continue;
      const { sx, tx, sPos, tPos } = sidesOf(sym, c);
      const pkIds = [...(pkIdsByTable.get(r.parentTableId) ?? new Set<string>())];
      const [d] = getSmoothStepPath({ sourceX: sx, sourceY: sym.y + sym.h / 2, sourcePosition: sPos, targetX: tx, targetY: rowCenterY(c, r.pairs[0]?.childColumnId), targetPosition: tPos, borderRadius: 10 });
      dbl(d, relationshipDrift(r, pkIds) != null ? C.red : C.text);
    }
  }

  // ── Fase 5: NODOS tabla ─────────────────────────────────────────────────
  for (const b of tableBoxes.values()) {
    const { t, x, y, w, h } = b;
    items.push({ k: 'rect', x, y, w, h, rx: 11, fill: C.surface });
    items.push({ k: 'rect', x, y, w, h: HEADER_H, rx: 11, rtop: true, fill: C.navy });
    if (b.pkRows > 0) {
      items.push({ k: 'rect', x, y: y + HEADER_H, w, h: b.pkRows * ROW_H, fill: C.pkZone });
      items.push({ k: 'line', x1: x, y1: y + HEADER_H + b.pkRows * ROW_H, x2: x + w, y2: y + HEADER_H + b.pkRows * ROW_H, stroke: C.pkInset, sw: 1 });
    }
    // Glyph de tabla (blanco tenue) + título `schema.` + nombre.
    const gx = x + PADX, gy = y + (HEADER_H - 11) / 2;
    items.push({ k: 'rect', x: gx, y: gy, w: 13, h: 11, rx: 2, stroke: C.headGlyph, sw: 1.4 });
    items.push({ k: 'line', x1: gx, y1: gy + 4, x2: gx + 13, y2: gy + 4, stroke: C.headGlyph, sw: 1.2 });
    items.push({ k: 'line', x1: gx + 6.5, y1: gy + 4, x2: gx + 6.5, y2: gy + 11, stroke: C.headGlyph, sw: 1.2 });
    const titleX = x + PADX + 13 + GAP;
    const budget = Math.floor((w - (titleX - x) - PADX) / CHAR_HEAD);
    const schema = t.schema ? `${t.schema}.` : '';
    const title = name(t);
    if (schema && schema.length + 1 <= budget) {
      items.push({ k: 'text', x: titleX, y: y + 20, s: schema, size: 12, color: C.headSchema, mono: true });
      items.push({ k: 'text', x: titleX + schema.length * CHAR_HEAD, y: y + 20, s: trunc(title, budget - schema.length), size: 12, color: C.surface, mono: true, bold: true });
    } else {
      items.push({ k: 'text', x: titleX, y: y + 20, s: trunc(schema + title, budget), size: 12, color: C.surface, mono: true, bold: true });
    }
    // Filas: separadores + icono de llave + nombre + tipo.
    b.ordered.forEach((c2, idx) => {
      const rowY = y + HEADER_H + idx * ROW_H;
      if (idx > 0) items.push({ k: 'line', x1: x, y1: rowY, x2: x + w, y2: rowY, stroke: C.rowSep, sw: 1 });
      if (c2.isPrimaryKey) {
        // Llave (KeyRound simplificada): anillo + caña 45° + diente, ámbar.
        items.push({ k: 'ellipse', cx: x + PADX + 3.2, cy: rowY + 17, rx: 2.6, ry: 2.6, stroke: C.pk, sw: 1.5 });
        items.push({ k: 'line', x1: x + PADX + 5.2, y1: rowY + 15, x2: x + PADX + 10.5, y2: rowY + 9.6, stroke: C.pk, sw: 1.5, cap: 'round' });
        items.push({ k: 'line', x1: x + PADX + 8.6, y1: rowY + 11.5, x2: x + PADX + 10.4, y2: rowY + 13.3, stroke: C.pk, sw: 1.5, cap: 'round' });
      } else if (c2.isForeignKey) {
        // Eslabones (Link2 simplificado), azul.
        items.push({ k: 'rect', x: x + PADX - 0.5, y: rowY + 11.5, w: 7, h: 5, rx: 2.5, stroke: C.fk, sw: 1.4 });
        items.push({ k: 'rect', x: x + PADX + 4, y: rowY + 11.5, w: 7, h: 5, rx: 2.5, stroke: C.fk, sw: 1.4 });
      }
      const dt = trunc(collapseComplexType(c2.dataType), 30);
      const dtW = dt.length * CHAR_MONO;
      const nameX = x + PADX + KEY_W + GAP;
      const nb = Math.max(3, Math.floor((w - (nameX - x) - PADX - GAP - dtW) / CHAR_UI));
      items.push({ k: 'text', x: nameX, y: rowY + 18, s: trunc(name(c2), nb), size: 12, color: c2.isForeignKey ? C.fk : C.text });
      items.push({ k: 'text', x: x + w - PADX, y: rowY + 17.5, s: dt, size: 10, color: C.muted, mono: true, anchor: 'end' });
    });
    if (!b.ordered.length) items.push({ k: 'text', x: x + PADX, y: y + HEADER_H + 18, s: 'No columns', size: 11, color: C.muted });
    items.push({ k: 'rect', x, y, w, h, rx: 11, stroke: C.border, sw: 1 });
  }

  // ── Fase 6: NODOS vista ─────────────────────────────────────────────────
  for (const vb of viewBoxes) {
    const { v, x, y, w, h } = vb;
    items.push({ k: 'rect', x, y, w, h, rx: 12, fill: C.surface });
    items.push({ k: 'rect', x, y: y + HEADER_H, w, h: h - HEADER_H, fill: C.vBody });
    items.push({ k: 'hatch', x, y: y + HEADER_H, w, h: h - HEADER_H });
    items.push({ k: 'rect', x, y, w, h: HEADER_H, rx: 12, rtop: true, fill: C.vHead });
    // Ojo (glyph) + título + badge VISTA.
    const ex = x + PADX + 6, ey = y + HEADER_H / 2;
    items.push({ k: 'ellipse', cx: ex, cy: ey, rx: 6, ry: 4, stroke: C.headGlyph, sw: 1.4 });
    items.push({ k: 'ellipse', cx: ex, cy: ey, rx: 1.6, ry: 1.6, fill: C.headGlyph });
    const titleX = x + PADX + 13 + GAP;
    const budget = Math.floor((w - (titleX - x) - PADX - 40) / CHAR_HEAD);   // 40 ≈ badge
    const schema = v.schema ? `${v.schema}.` : '';
    if (schema && schema.length + 1 <= budget) {
      items.push({ k: 'text', x: titleX, y: y + 20, s: schema, size: 12, color: C.vHeadSchema, mono: true });
      items.push({ k: 'text', x: titleX + schema.length * CHAR_HEAD, y: y + 20, s: trunc(v.name, budget - schema.length), size: 12, color: C.surface, mono: true, bold: true });
    } else {
      items.push({ k: 'text', x: titleX, y: y + 20, s: trunc(schema + v.name, budget), size: 12, color: C.surface, mono: true, bold: true });
    }
    items.push({ k: 'text', x: x + w - PADX, y: y + 19, s: 'VISTA', size: 9, color: C.vBadge, bold: true, anchor: 'end', ls: 1.3 });
    vb.rows.forEach((r, idx) => {
      const rowY = y + HEADER_H + idx * ROW_H;
      if (idx > 0) items.push({ k: 'line', x1: x, y1: rowY, x2: x + w, y2: rowY, stroke: C.vRowSep, sw: 1 });
      if (r.fx) {
        items.push({ k: 'rect', x: x + PADX, y: rowY + 7.5, w: 16, h: 13, rx: 4, fill: C.vFxBg, stroke: C.vFxBorder, sw: 1 });
        items.push({ k: 'text', x: x + PADX + 8, y: rowY + 17, s: 'fx', size: 9, color: C.vFxText, bold: true, italic: true, anchor: 'middle' });
      }
      const dt = trunc(collapseComplexType(r.type), 30);
      const dtW = dt.length * CHAR_MONO;
      const nameX = x + PADX + 16 + GAP;
      const nb = Math.max(3, Math.floor((w - (nameX - x) - PADX - GAP - dtW) / CHAR_UI));
      items.push({ k: 'text', x: nameX, y: rowY + 18, s: trunc(r.name, nb), size: 12, color: C.text });
      if (dt) items.push({ k: 'text', x: x + w - PADX, y: rowY + 17.5, s: dt, size: 10, color: C.muted, mono: true, anchor: 'end' });
    });
    if (!vb.rows.length) items.push({ k: 'text', x: x + PADX, y: y + HEADER_H + 18, s: 'Sin columnas', size: 11, color: C.muted });
    items.push({ k: 'rect', x, y, w, h, rx: 12, stroke: C.vBorder, sw: 2, dash: '6 5' });
  }

  // ── Fase 7: símbolos de subcategoría (rombo + barra) ────────────────────
  for (const sym of symbolBoxes.values()) {
    const s = SYMBOL_SIZE / 28;
    const px = (v: number) => sym.x + v * s;
    const py = (v: number) => sym.y + v * s;
    items.push({ k: 'poly', pts: [[px(14), py(2.4)], [px(25.6), py(14)], [px(14), py(25.6)], [px(2.4), py(14)]], fill: C.bg, stroke: C.text, sw: 1.8, join: 'round' });
    items.push({ k: 'line', x1: px(8.8), y1: py(14), x2: px(19.2), y2: py(14), stroke: C.text, sw: 1.8 });
  }

  return { w: Math.max(400, maxX - minX), h: Math.max(300, maxY - minY), bg: C.bg, items };
}
