// Motor de export sin captura de DOM.
//
// Capturar el DOM del canvas obliga a clonar cientos de miles de elementos con
// getComputedStyle y a serializar cientos de MB: minutos de bloqueo y
// RangeError en canvases gigantes. Este módulo dibuja el diagrama a partir del
// modelo (tablas, columnas, relaciones, vistas, subcategorías y shapes) con
// las mismas métricas del canvas (header 32 / fila 28 / clamp 240..880, espejo
// de lodSize.ts y scripts/arrange_all.py) y los mismos ruteos (getSmoothStepPath
// / getBezierPath de React Flow son funciones puras). El resultado es una
// escena intermedia (rects/paths/textos con coordenadas absolutas) que
// serializan sceneSvg.ts y scenePdf.ts: solo el diagrama, cero metadata.
//
// Colores = tokens.css resueltos a literal (el export vive fuera del
// documento). Los rgba/opacity se pre-mezclan sobre su fondo real: la escena
// no maneja transparencia (simplifica el PDF).
import { Position, getBezierPath, getSmoothStepPath } from '@xyflow/react';
import type { CanonicalColumn, Cardinality } from '@/services/governance.service';
import type { Diagram, Drawing } from '@/features/modeler/services/modeler.service';
import type { View } from '@/services/views.service';
import { collapseComplexType } from './complexTypes';
import { orderColumns } from './columnOrder';
import { HEADER_H, ROW_H, fanSlots, fanSourceY } from './edgeFanout';
import { labelPlacement, relationshipLabel, wrapLabel } from './relationshipLabel';
import { relationshipDrift } from './relationshipPairs';
import { SYMBOL_SIZE, isSubcategory, subtypeGroups, symbolDefaultPos } from './subtypeGraph';
import { viewNodeRows, viewSourceIds } from './viewGraph';
import { boxHex } from './boxColor';
import { boxTints, themeIndex, type Theme } from '@/lib/colors';
import { drawingAlign, drawingFill, drawingFont, drawingStroke, hasText } from './drawingStyle';
import {
  STUB_BLOCK, STUB_SYMBOL, cleanRoutes, roundedPath, routeOf, routedGeometry, trunkRouteId,
  type RoutePoint, type RoutedGeometry, type WireRoutes,
} from './wireRoute';

// ── IR de la escena ────────────────────────────────────────────────────────
export type SceneItem =
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; sw?: number; rx?: number; dash?: string; rtop?: boolean }
  | { k: 'hatch'; x: number; y: number; w: number; h: number }
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: string; stroke?: string; sw?: number }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number; dash?: string; cap?: 'round' }
  | { k: 'poly'; pts: [number, number][]; fill?: string; stroke?: string; sw?: number; join?: 'round' }
  | { k: 'path'; d: string; stroke?: string; sw?: number; dash?: string; fill?: string }
  | { k: 'text'; x: number; y: number; s: string; size: number; color: string; mono?: boolean; bold?: boolean; italic?: boolean; anchor?: 'start' | 'middle' | 'end'; ls?: number;
      /** Ancho medio por carácter (× size) para anclar `middle`/`end` en el PDF,
       *  que no mide texto. Default: el de la fuente (scenePdf). */
      wf?: number;
      /** Familia elegida para el texto de un dibujo (null = la de la app)
       *  y subrayado. */
      font?: string | null; underline?: boolean };

export interface Scene { w: number; h: number; bg: string; items: SceneItem[] }

export interface SceneInput {
  diagram: Diagram | null;
  drawings: Drawing[];
  viewMode: 'logical' | 'physical';
  /** Dibuja las etiquetas de relación (frases). Default true; el
   *  toolbar pasa false cuando el usuario las tiene ocultas en el canvas. */
  relLabels?: boolean;
  /** Trazos manuales de wires a dibujar. Ausente = los del canvas
   *  (`diagram.subjectArea.routes`); el toolbar pasa los vivos del store (en
   *  edición pueden tener un guardado aún en vuelo). */
  routes?: WireRoutes;
  /** Colores de las cajas en el canvas (ausente = los del canvas,
   *  `diagram.subjectArea.colors`) y los themes del proyecto para resolverlos. */
  colors?: Record<string, string>;
  themes?: Theme[];
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
// Etiqueta de relación: texto de 11px en oración (no UPPER_SNAKE).
// Ancho medio por carácter = 0.5·size — Geist y Helvetica rondan 0.45 en
// español; el margen evita que el texto se salga de su fondo. El mismo factor
// viaja en el item (`wf`) para que el PDF centre con él.
const LABEL_SIZE = 11;
const LABEL_WF = 0.5;
const CHAR_LABEL = LABEL_WF * LABEL_SIZE;
const LABEL_PADX = 5, LABEL_PADY = 2, LABEL_LINE_H = 14;
const clampW = (chars: number) => Math.min(880, Math.max(240, Math.round(chars * 8 + 72)));

const trunc = (s: string, maxChars: number): string =>
  s.length <= maxChars ? s : `${s.slice(0, Math.max(1, maxChars - 1))}…`;

/** Texto de un dibujo en líneas de a lo más `budget` caracteres —
 *  respeta los saltos y corta por palabra (una palabra larga, por carácter).
 *  Conserva los espacios al principio (Erwin los usa para centrar). Pura. */
export function wrapText(text: string, budget: number): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    let line = '';
    for (const word of raw.split(/(\s+)/)) {
      if (!word) continue;
      if ((line + word).length <= budget) { line += word; continue; }
      if (line.trim()) out.push(line.replace(/\s+$/, ''));
      line = /^\s+$/.test(word) ? '' : word;
      while (line.length > budget) { out.push(line.slice(0, budget)); line = line.slice(budget); }
    }
    out.push(line.replace(/\s+$/, ''));
  }
  return out;
}

interface Box { x: number; y: number; w: number; h: number }

/** Bloque de texto de un dibujo (en las coordenadas del dibujo),
 *  como lo pinta el canvas (`.wk-shape-text`): margen 2×4 px, interlineado 1.3,
 *  corte por palabra al ancho de la caja y el texto que no entra se sigue
 *  viendo. `box` = lo que ocupa (puede salirse de la caja: entra en los
 *  límites del export). null = el dibujo no lleva texto. Pura. */
function drawingTextLayout(d: Drawing) {
  if (!hasText(d) || !(d.text || d.type === 'text')) return null;
  const f = drawingFont(d);
  const { align, valign } = drawingAlign(d);
  const size = f.size * (4 / 3);
  const lh = size * 1.3;
  const padX = 4, padY = 2;
  // Ancho medio por carácter de la letra con que el PDF la dibuja (`fontOf` de
  // scenePdf: monoespaciada → Courier 0.6; negrita 0.58; el resto 0.55).
  const wf = /courier|mono|consolas/i.test(f.family ?? '') ? 0.6 : f.bold ? 0.58 : 0.55;
  const budget = Math.max(4, Math.floor((d.w - 2 * padX) / (size * wf)));
  const lines = wrapText(d.text || 'Text', budget);
  const block = lines.length * lh;
  const top = valign === 'top' ? d.y + padY : valign === 'bottom' ? d.y + d.h - padY - block : d.y + (d.h - block) / 2;
  const anchor: 'start' | 'middle' | 'end' = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
  const x = align === 'center' ? d.x + d.w / 2 : align === 'right' ? d.x + d.w - padX : d.x + padX;
  const width = Math.max(...lines.map((ln) => ln.length), 1) * size * wf;
  const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  return { f, size, lh, wf, lines, top, anchor, x, box: { x: left, y: top, w: width, h: block } };
}

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
 *  alejándose del nodo (+1 derecha). Geometría espejo de CrowFootMarkers
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
  // Color de cada caja (excepción del canvas → color de la tabla).
  const canvasColors = input.colors ?? diagram?.subjectArea.colors ?? {};
  const themeIdx = themeIndex(input.themes ?? []);
  const tintOf = (id: string, own: string | null | undefined) => {
    const hex = boxHex(id, own, canvasColors, themeIdx);
    return hex ? boxTints(hex) : null;
  };
  const name = nameOf(viewMode);
  const items: SceneItem[] = [];

  // ── Fase 1: cajas de todos los nodos (coordenadas del canvas) ───────────
  const layout = diagram?.subjectArea.layout ?? {};
  const colsByTable = new Map<string, CanonicalColumn[]>();
  (diagram?.columns ?? []).forEach((c) => {
    const a = colsByTable.get(c.tableId); if (a) a.push(c); else colsByTable.set(c.tableId, [c]);
  });

  const tableBoxes = new Map<string, TableBox>();
  // Mismas filas que el canvas: el orden único (PK primero y cada bloque por
  // `ordinal`) en ambas facetas.
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
  // Vistas solo en modelo físico: paridad export ↔ canvas.
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

  // ── Wires crow-foot: geometría compartida por los bounds y el dibujo ────
  const pkIdsByTable = new Map<string, Set<string>>();
  (diagram?.columns ?? []).forEach((c) => {
    if (!c.isPrimaryKey) return;
    const s = pkIdsByTable.get(c.tableId); if (s) s.add(c.id); else pkIdsByTable.set(c.tableId, new Set([c.id]));
  });
  const stdRels = (diagram?.relationships ?? []).filter((r) => !isSubcategory(r) && tableBoxes.has(r.parentTableId) && tableBoxes.has(r.childTableId));
  // Reparto de salidas por padre: depende del orden relativo de los hijos, así
  // que la traslación no lo altera.
  const slots = fanSlots(stdRels.map((r) => {
    const tp = tableBoxes.get(r.childTableId)!;
    return { id: r.id, parentId: r.parentTableId, targetY: tp.y, targetX: tp.x };
  }));

  const sidesOf = (s: Box, t: Box) => {
    const facesRight = s.x + s.w / 2 <= t.x + t.w / 2;
    return {
      facesRight,
      sx: facesRight ? s.x + s.w : s.x,
      tx: facesRight ? t.x : t.x + t.w,
      sPos: facesRight ? Position.Right : Position.Left,
      tPos: facesRight ? Position.Left : Position.Right,
      awayS: (facesRight ? 1 : -1) as 1 | -1,
      awayT: (facesRight ? -1 : 1) as 1 | -1,
    };
  };

  // ── Trazos manuales ─────────────────────────────────────────────────────
  // El camino se calcula una vez, en coordenadas del canvas (la primera
  // pasada, antes de la traslación), y después solo se traslada: es el mismo
  // dibujo del canvas. Rutear de nuevo en las coordenadas de la escena (con un
  // origen que puede tener fracción) movería anclajes y puntos por separado.
  const routes = cleanRoutes(input.routes ?? diagram?.subjectArea.routes);
  const origin = { x: 0, y: 0 };
  const viaOf = (wireId: string): RoutePoint[] | null => routeOf(routes, wireId) ?? null;
  const routedCache = new Map<string, RoutedGeometry>();
  /** Wire con trazo entre dos cajas: mismo shape que `sidesOf` + camino. El
   *  lado de cada extremo lo decide el trazo (misma geometría que el canvas). */
  const routedWire = (
    wireId: string, sBox: Box, sy: number, sStub: number, tBox: Box, ty: number, tStub: number, via: RoutePoint[],
  ) => {
    let g = routedCache.get(wireId);
    if (!g) {
      g = routedGeometry({
        sBox: { x: sBox.x + origin.x, w: sBox.w }, sy: sy + origin.y, sStub,
        tBox: { x: tBox.x + origin.x, w: tBox.w }, ty: ty + origin.y, tStub, via,
      });
      routedCache.set(wireId, g);
    }
    const corners = g.corners.map((c) => ({ x: c.x - origin.x, y: c.y - origin.y }));
    return {
      facesRight: g.s.dir === 1, awayS: g.s.dir, awayT: g.t.dir,
      sx: g.s.x - origin.x, sy: g.s.y - origin.y, tx: g.t.x - origin.x, ty: g.t.y - origin.y,
      d: roundedPath(corners), midX: g.mid.x - origin.x, midY: g.mid.y - origin.y, corners,
    };
  };
  /** Caja que envuelve las esquinas de los wires trazados (para los bounds). */
  const routedBoxes: Box[] = [];
  const boundOf = (corners: RoutePoint[]) => {
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    routedBoxes.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
  };

  interface RelLabel { lines: string[]; cx: number; rect: Box }
  type Rel = (typeof stdRels)[number];
  /** Etiqueta de una relación para un tramo ya ruteado: misma regla
   *  que el canvas (`labelPlacement`) y parte línea al ancho disponible.
   *  `manual`: con trazo la etiqueta sigue al camino, también en una
   *  recursiva (su wire no corre necesariamente bajo el bloque). */
  const labelFor = (
    r: Rel, side: { facesRight: boolean; sx: number; tx: number }, midX: number, midY: number, from: Box, manual = false,
  ): RelLabel | null => {
    const text = input.relLabels === false ? null : relationshipLabel(r);
    if (!text) return null;
    const at = labelPlacement({
      recursive: !manual && r.parentTableId === r.childTableId && !isSubcategory(r), facesRight: side.facesRight,
      sx: side.sx, tx: side.tx, midX, midY, box: from,
    });
    const lines = wrapLabel(text, Math.floor((at.maxWidth - 2 * LABEL_PADX) / CHAR_LABEL));
    const w = Math.max(...lines.map((l) => [...l].length)) * CHAR_LABEL + 2 * LABEL_PADX;
    const h = lines.length * LABEL_LINE_H + 2 * LABEL_PADY;
    return { lines, cx: at.x, rect: { x: at.x - w / 2, y: at.anchor === 'bottom' ? at.y - h : at.y - h / 2, w, h } };
  };

  /** Wire de una relación con las coordenadas actuales de sus cajas: se llama
   *  antes de la traslación (la etiqueta entra a los bounds) y después (dibujo). */
  const wire = (r: Rel) => {
    const p = tableBoxes.get(r.parentTableId)!;
    const c = tableBoxes.get(r.childTableId)!;
    const side = sidesOf(p, c);
    const fan = slots.get(r.id);
    const sy = fanSourceY(p.y, p.h, p.pkRows, fan?.slot ?? 0, fan?.count ?? 1);
    const ty = rowCenterY(c, r.pairs[0]?.childColumnId);
    const via = viaOf(r.id);
    if (via) {
      const g = routedWire(r.id, p, sy, STUB_BLOCK, c, ty, STUB_BLOCK, via);
      return { ...g, label: labelFor(r, g, g.midX, g.midY, p, true) };
    }
    const [d, midX, midY] = getSmoothStepPath({ sourceX: side.sx, sourceY: sy, sourcePosition: side.sPos, targetX: side.tx, targetY: ty, targetPosition: side.tPos, borderRadius: 10 });
    return { ...side, sy, ty, d, corners: null, label: labelFor(r, side, midX, midY, p) };
  };

  /** Rama símbolo → subtipo de una subcategoría, con su etiqueta (la frase
   *  es la de la relación de esa rama). null si el subtipo no está en el
   *  canvas. */
  const branch = (sym: Box, r: Rel) => {
    const c = tableBoxes.get(r.childTableId);
    if (!c) return null;
    const via = viaOf(r.id);
    if (via) {
      const g = routedWire(r.id, sym, sym.y + sym.h / 2, STUB_SYMBOL, c, rowCenterY(c, r.pairs[0]?.childColumnId), STUB_BLOCK, via);
      return { d: g.d, corners: g.corners, label: labelFor(r, g, g.midX, g.midY, sym, true) };
    }
    const side = sidesOf(sym, c);
    const [d, midX, midY] = getSmoothStepPath({ sourceX: side.sx, sourceY: sym.y + sym.h / 2, sourcePosition: side.sPos, targetX: side.tx, targetY: rowCenterY(c, r.pairs[0]?.childColumnId), targetPosition: side.tPos, borderRadius: 10 });
    return { d, corners: null, label: labelFor(r, side, midX, midY, sym) };
  };

  /** Tronco supertipo → símbolo de una subcategoría (no es una relación: sin
   *  etiqueta). Su trazo manual va con la llave `subsym-{símbolo}`. */
  const trunk = (p: TableBox, sym: Box, symbolId: string) => {
    const sy = p.y + HEADER_H / 2;
    const ty = sym.y + sym.h / 2;
    const via = viaOf(trunkRouteId(symbolId));
    if (via) {
      const g = routedWire(trunkRouteId(symbolId), p, sy, STUB_BLOCK, sym, ty, STUB_SYMBOL, via);
      return { d: g.d, corners: g.corners };
    }
    const { sx, tx, sPos, tPos } = sidesOf(p, sym);
    const [d] = getSmoothStepPath({ sourceX: sx, sourceY: sy, sourcePosition: sPos, targetX: tx, targetY: ty, targetPosition: tPos, borderRadius: 10 });
    return { d, corners: null };
  };

  // ── Fase 2: bounds + traslación (padding 60) ────────────────────────────
  // Los wires con trazo manual aportan sus esquinas a los bounds (un
  // punto puede quedar fuera de la caja que envuelve a los bloques).
  const labelBoxes = [
    ...stdRels.map((r) => {
      const g = wire(r);
      if (g.corners) boundOf(g.corners);
      return g.label;
    }),
    ...subtypeGroups(subRels).flatMap((g) => {
      const sym = symbolBoxes.get(g.symbolId);
      const p = tableBoxes.get(g.parentTableId);
      if (!sym || !p) return [];
      const t = trunk(p, sym, g.symbolId);
      if (t.corners) boundOf(t.corners);
      return g.rels.map((r) => {
        const b = branch(sym, r);
        if (b?.corners) boundOf(b.corners);
        return b?.label ?? null;
      });
    }),
  ].flatMap((l) => (l ? [l.rect] : []));
  // El texto de un dibujo que desborda su caja también entra en los límites.
  const textBoxes = drawings.flatMap((d) => { const t = drawingTextLayout(d); return t ? [t.box] : []; });
  const boxes: Box[] = [...tableBoxes.values(), ...viewBoxes, ...symbolBoxes.values(), ...drawings, ...textBoxes,
    ...labelBoxes, ...routedBoxes];
  if (!boxes.length) return EMPTY_SCENE;
  const minX = Math.min(...boxes.map((b) => b.x)) - 60;
  const minY = Math.min(...boxes.map((b) => b.y)) - 60;
  const maxX = Math.max(...boxes.map((b) => b.x + b.w)) + 60;
  const maxY = Math.max(...boxes.map((b) => b.y + b.h)) + 60;
  for (const b of [...tableBoxes.values(), ...viewBoxes, ...symbolBoxes.values()]) { b.x -= minX; b.y -= minY; }
  origin.x = minX; origin.y = minY;      // desde acá los trazos salen trasladados a la escena
  const dwx = (d: Drawing): Box => ({ x: d.x - minX, y: d.y - minY, w: d.w, h: d.h });

  // ── Fase 3: shapes (capa de fondo, zIndex -1 en el canvas) ──────────────
  // Relleno, borde y texto con su formato (misma regla que el canvas,
  // `drawingStyle.ts`); la letra va en puntos → px (× 4/3).
  for (const d of drawings) {
    const b = dwx(d);
    const stroke = drawingStroke(d);
    const fill = drawingFill(d) ?? undefined;    // `#RRGGBBAA`: SVG y PDF mezclan el alfa
    switch (d.type) {
      case 'rect': case 'square':
        items.push({ k: 'rect', ...b, rx: 8, fill, stroke: stroke ?? undefined, sw: stroke ? 2 : undefined }); break;
      case 'text':
        if (fill || stroke) items.push({ k: 'rect', ...b, rx: 3, fill, stroke: stroke ?? undefined, sw: stroke ? 1 : undefined });
        break;
      case 'circle': case 'ellipse':
        items.push({ k: 'ellipse', cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2, fill, stroke: stroke ?? undefined, sw: stroke ? 2 : undefined }); break;
      case 'line': {
        const c = stroke ?? '#56607A';
        if (b.h > b.w) items.push({ k: 'line', x1: b.x + b.w / 2, y1: b.y, x2: b.x + b.w / 2, y2: b.y + b.h, stroke: c, sw: 2.4, cap: 'round' });
        else items.push({ k: 'line', x1: b.x, y1: b.y + b.h / 2, x2: b.x + b.w, y2: b.y + b.h / 2, stroke: c, sw: 2.4, cap: 'round' });
        break;
      }
      case 'diamond':
        items.push({ k: 'poly', pts: [[b.x + b.w / 2, b.y], [b.x + b.w, b.y + b.h / 2], [b.x + b.w / 2, b.y + b.h], [b.x, b.y + b.h / 2]], fill, stroke: stroke ?? undefined, sw: stroke ? 2 : undefined }); break;
      case 'star': {
        const pts: [number, number][] = [];
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? 0.48 : 0.19;
          const a = (Math.PI / 5) * i - Math.PI / 2;
          pts.push([b.x + b.w / 2 + r * b.w * Math.cos(a), b.y + b.h / 2 + r * b.h * Math.sin(a)]);
        }
        items.push({ k: 'poly', pts, fill, stroke: stroke ?? undefined, sw: stroke ? 2 : undefined, join: 'round' });
        break;
      }
    }
    const t = drawingTextLayout(d);
    if (!t) continue;
    const { f, size, lh, wf, anchor } = t;
    t.lines.forEach((ln, i) => items.push({
      k: 'text', x: t.x - minX, y: t.top - minY + i * lh + size * 0.92, s: ln, size, color: f.color,
      bold: f.bold, italic: f.italic, underline: f.underline, font: f.family, anchor, wf,
    }));
  }

  // ── Fase 4: edges (React Flow los pinta bajo los nodos) ─────────────────
  // Las etiquetas se juntan acá y se dibujan al cierre de la fase: encima de
  // todos los wires (ninguno las tacha) y debajo de los bloques.
  const relLabels: RelLabel[] = [];

  for (const r of stdRels) {
    const g = wire(r);
    const pkIds = [...(pkIdsByTable.get(r.parentTableId) ?? new Set<string>())];
    const color = relationshipDrift(r, pkIds) != null ? C.red : C.text;
    items.push({ k: 'path', d: g.d, stroke: color, sw: 1.5, dash: r.identifying ? undefined : '7 4' });
    crowfoot(items, g.sx, g.sy, g.awayS, r.parentCardinality ?? 'one', color);
    crowfoot(items, g.tx, g.ty, g.awayT, r.childCardinality ?? 'zero-many', color);
    if (g.label) relLabels.push(g.label);
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

  // Subcategorías (solo lógico): tronco y ramas con trazo doble
  // (ancho color + carve central color canvas).
  const dbl = (d: string, color: string) => {
    items.push({ k: 'path', d, stroke: color, sw: 4.4 });
    items.push({ k: 'path', d, stroke: C.bg, sw: 1.8 });
  };
  for (const g of subtypeGroups(subRels)) {
    const sym = symbolBoxes.get(g.symbolId);
    const p = tableBoxes.get(g.parentTableId);
    if (!sym || !p) continue;
    dbl(trunk(p, sym, g.symbolId).d, C.text);
    for (const r of g.rels) {
      const b = branch(sym, r);
      if (!b) continue;
      const pkIds = [...(pkIdsByTable.get(r.parentTableId) ?? new Set<string>())];
      dbl(b.d, relationshipDrift(r, pkIds) != null ? C.red : C.text);
      if (b.label) relLabels.push(b.label);
    }
  }

  // Etiquetas de relación: fondo color canvas (tapa el tramo de wire
  // bajo el texto) + una línea de texto centrada por renglón.
  for (const l of relLabels) {
    items.push({ k: 'rect', ...l.rect, rx: 4, fill: C.bg });
    l.lines.forEach((line, i) => items.push({
      k: 'text', x: l.cx, y: l.rect.y + LABEL_PADY + i * LABEL_LINE_H + 10.5, s: line,
      size: LABEL_SIZE, color: C.text, anchor: 'middle', wf: LABEL_WF,
    }));
  }

  // ── Fase 5: nodos tabla ─────────────────────────────────────────────────
  for (const b of tableBoxes.values()) {
    const { t, x, y, w, h } = b;
    const tinted = tintOf(t.id, t.color);
    items.push({ k: 'rect', x, y, w, h, rx: 11, fill: tinted?.body ?? C.surface });
    items.push({ k: 'rect', x, y, w, h: HEADER_H, rx: 11, rtop: true, fill: C.navy });
    if (b.pkRows > 0) {
      items.push({ k: 'rect', x, y: y + HEADER_H, w, h: b.pkRows * ROW_H, fill: tinted?.key ?? C.pkZone });
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

  // ── Fase 6: nodos vista ─────────────────────────────────────────────────
  for (const vb of viewBoxes) {
    const { v, x, y, w, h } = vb;
    const vTint = tintOf(v.id, v.color);
    items.push({ k: 'rect', x, y, w, h, rx: 12, fill: C.surface });
    items.push({ k: 'rect', x, y: y + HEADER_H, w, h: h - HEADER_H, fill: vTint?.body ?? C.vBody });
    items.push({ k: 'hatch', x, y: y + HEADER_H, w, h: h - HEADER_H });
    items.push({ k: 'rect', x, y, w, h: HEADER_H, rx: 12, rtop: true, fill: C.vHead });
    // Glyph Eye (contorno + pupila) + título + badge VISTA.
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
