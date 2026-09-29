/**
 * Trazos MANUALES de wires (doc 99): puntos de quiebre que el modelador pone a
 * mano sobre una relación o una subcategoría, guardados POR CANVAS en
 * `SubjectArea.routes`. Lógica PURA — la consumen CrowFootEdge, SubtypeEdge,
 * los tiradores del wire, el store y el export.
 *
 * Un wire SIN trazo no pasa por acá: se dibuja con el camino automático de
 * siempre (`getSmoothStepPath`). Con trazo, el camino es siempre ORTOGONAL:
 * sale y entra horizontal, pasa por todos los puntos en orden y entre dos
 * puntos desalineados dobla una sola vez, eligiendo el camino con menos
 * quiebres y sin volver sobre sí mismo. Todo en píxeles ENTEROS del canvas:
 * los puntos se guardan redondeados y los anclajes se redondean igual, así
 * «alineado» es una igualdad y no una tolerancia.
 */
import type { Relationship } from '@/services/governance.service';
import { isSubcategory } from './subtypeGraph';

export interface RoutePoint { x: number; y: number }
/** `SubjectArea.routes`: id del wire en el canvas → sus puntos, padre → hijo. */
export type WireRoutes = Record<string, RoutePoint[]>;

/** Topes — espejo de `MAX_ROUTE_POINTS` / `MAX_ROUTE_COORD` /
 *  `MAX_ROUTE_ID_LEN` del backend. */
export const MAX_ROUTE_POINTS = 32;
export const MAX_ROUTE_COORD = 1_000_000;
export const MAX_ROUTE_ID_LEN = 200;
/** Tramo fijo con que el wire sale/entra de un bloque: marcador crow's-foot
 *  (22) + margen. Mismo valor que deja libre la etiqueta (doc 98). */
export const STUB_BLOCK = 28;
/** Tramo fijo en el símbolo de subcategoría (no lleva marcador). */
export const STUB_SYMBOL = 10;
/** Radio de las esquinas — el mismo del camino automático. */
export const CORNER_RADIUS = 10;
/** Imán del arrastre, en px de PANTALLA (se divide entre el zoom). */
export const SNAP_PX = 6;
/** Largo mínimo de un tramo (px de canvas) para ofrecer «crear punto». */
export const MIN_HANDLE_SEGMENT = 36;

const EPS = 0.5;
/** Costo de volver sobre el tramo anterior: nunca se elige si hay alternativa. */
const BACKTRACK = 100;

/** Id del tronco supertipo → símbolo de una subcategoría (el de sus ramas es
 *  el id de cada relación). Espejo del id del edge en `subtypeGraph.ts`. */
export const trunkRouteId = (symbolId: string): string => `subsym-${symbolId}`;

// ── Saneo (lo que llega del backend) ───────────────────────────────────────

const validCoord = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_ROUTE_COORD;

/** Trazo válido (solo `x`/`y` de cada punto) o null. Un trazo con CUALQUIER
 *  punto inválido se descarta entero: el wire vuelve al camino automático. */
export function cleanRoute(raw: unknown): RoutePoint[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ROUTE_POINTS) return null;
  const out: RoutePoint[] = [];
  for (const p of raw) {
    if (typeof p !== 'object' || p === null) return null;
    const { x, y } = p as { x?: unknown; y?: unknown };
    if (!validCoord(x) || !validCoord(y)) return null;
    out.push({ x, y });
  }
  return out;
}

/** Id de wire utilizable como llave — espejo de `_wire_id_ok` del backend:
 *  texto no vacío, de largo acotado y sin caracteres de control. `__proto__`
 *  tampoco: asignarlo a un objeto cambia su prototipo en vez de crear la llave. */
export function validWireId(id: unknown): id is string {
  if (typeof id !== 'string' || !id.trim() || id.length > MAX_ROUTE_ID_LEN || id === '__proto__') return false;
  for (let i = 0; i < id.length; i++) {
    const code = id.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

/** Mapa de trazos saneado: nunca falla, descarta lo malformado. */
export function cleanRoutes(raw: unknown): WireRoutes {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: WireRoutes = {};
  for (const [id, points] of Object.entries(raw as Record<string, unknown>)) {
    if (!validWireId(id)) continue;
    const route = cleanRoute(points);
    if (route) out[id] = route;
  }
  return out;
}

/** Trazo guardado de un wire, o nada. Por llave PROPIA: `routes[id]` a secas
 *  devolvería lo heredado de Object (`constructor`, `toString`…) si un wire
 *  llegara a llamarse así. */
export function routeOf(routes: WireRoutes, id: string): RoutePoint[] | undefined {
  return Object.prototype.hasOwnProperty.call(routes, id) ? routes[id] : undefined;
}

// ── Qué wires existen ──────────────────────────────────────────────────────

/** Ids de TODOS los wires ruteables del diagrama, sin importar la faceta que
 *  se esté viendo (las subcategorías solo se dibujan en lógico, pero su trazo
 *  se conserva al editar en físico). */
export function routableWireIds(rels: Relationship[]): string[] {
  const ids = new Set<string>();
  for (const r of rels) {
    ids.add(r.id);
    if (isSubcategory(r)) ids.add(trunkRouteId(r.subtypeSymbolId as string));
  }
  return [...ids];
}

/** Wires que tocan una tabla: sus relaciones (como padre o hija) y el tronco de
 *  los grupos de subcategoría donde es SUPERTIPO. Si es subtipo solo sale su
 *  rama — el tronco sigue dibujado para los demás subtipos. */
export function wireIdsOfTable(rels: Relationship[], tableId: string): string[] {
  const ids = new Set<string>();
  for (const r of rels) {
    if (r.parentTableId !== tableId && r.childTableId !== tableId) continue;
    ids.add(r.id);
    if (isSubcategory(r) && r.parentTableId === tableId) ids.add(trunkRouteId(r.subtypeSymbolId as string));
  }
  return [...ids];
}

/** Solo los trazos de wires que existen (poda huérfanos). Devuelve el MISMO
 *  objeto cuando no hay nada que podar. */
export function pruneRoutes(routes: WireRoutes, validIds: Iterable<string>): WireRoutes {
  const valid = validIds instanceof Set ? validIds as Set<string> : new Set(validIds);
  const keys = Object.keys(routes);
  if (keys.every((k) => valid.has(k))) return routes;
  const out: WireRoutes = {};
  for (const k of keys) if (valid.has(k)) out[k] = routes[k];
  return out;
}

// ── Extremos ───────────────────────────────────────────────────────────────

/** Extremo del wire: punto de anclaje sobre el borde del nodo, hacia dónde
 *  sale (`dir` +1 derecha / −1 izquierda) y largo de su tramo fijo. */
export interface WireEnd { x: number; y: number; dir: 1 | -1; stub: number }

/** Nodo de un extremo: su caja (solo X y ancho) y la fila donde ancla el wire. */
type EndBox = { x: number; w: number };

/** El píxel entero de un punto: así se guardan los puntos del trazo. */
const rounded = (p: RoutePoint): RoutePoint => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** Extremo sobre el borde `dir` de la caja, en píxeles ENTEROS (el mismo
 *  redondeo de los puntos del trazo): un punto que el imán alineó con la fila
 *  queda EXACTAMENTE en ella. Medio píxel de diferencia bastaba para que el
 *  camino entero cambiara de forma. */
const endAt = (box: EndBox, y: number, dir: 1 | -1, stub: number): WireEnd => ({
  ...rounded({ x: dir === 1 ? box.x + box.w : box.x, y }), dir, stub,
});

/** Extremos de un wire CON trazo: el lado de salida lo decide el primer punto
 *  y el de entrada el último (a qué lado del centro del nodo quedan), no la
 *  posición del otro bloque. En el centro exacto gana la derecha.
 *  `routedGeometry` parte de estos lados y solo los cambia si por ellos el
 *  wire tendría que volver sobre sí mismo. */
export function wireEnds(a: {
  sBox: EndBox; sy: number; sStub: number;
  tBox: EndBox; ty: number; tStub: number;
  via: RoutePoint[];
}): { s: WireEnd; t: WireEnd } {
  const first = a.via[0];
  const last = a.via[a.via.length - 1];
  const sDir: 1 | -1 = first.x >= a.sBox.x + a.sBox.w / 2 ? 1 : -1;
  const tDir: 1 | -1 = last.x >= a.tBox.x + a.tBox.w / 2 ? 1 : -1;
  return { s: endAt(a.sBox, a.sy, sDir, a.sStub), t: endAt(a.tBox, a.ty, tDir, a.tStub) };
}

// ── Ruteo ortogonal ────────────────────────────────────────────────────────

/** Tramo recto del camino. `insertAt` = posición de la lista de puntos donde
 *  entra un punto nuevo creado sobre este tramo. `fixed` = es el tramo fijo de
 *  un extremo (donde va el marcador): ahí no se crean puntos. */
export interface WireSegment { a: RoutePoint; b: RoutePoint; insertAt: number; fixed?: boolean }

export interface RoutedWire {
  /** Esquinas del camino, padre → hijo, con los dos anclajes incluidos. */
  corners: RoutePoint[];
  /** Tramos rectos, partidos en cada punto del trazo (para los tiradores). */
  segments: WireSegment[];
  /** Path SVG con las esquinas redondeadas. */
  path: string;
  /** Punto a mitad del largo del camino (ancla de la etiqueta). */
  mid: RoutePoint;
  /** Veces que el camino vuelve sobre el tramo anterior. 0 en un trazo sano;
   *  más, solo cuando los puntos no dejan otra salida. */
  backtracks: number;
}

interface Dir { axis: 'h' | 'v'; sign: 1 | -1 }
interface Step { corner: RoutePoint | null; first: Dir; last: Dir }
type Tagged = RoutePoint & { leg: number };
/** `picks` = qué candidato se eligió en cada tramo (0 = el preferido). */
interface State { dir: Dir; cost: number; pts: Tagged[]; picks: number[] }

const dirKey = (d: Dir) => `${d.axis}${d.sign}`;
const signOf = (v: number): 1 | -1 => (v > 0 ? 1 : -1);

/** Formas de unir `a` con `b`: recto si están alineados; si no, los dos codos
 *  (horizontal-vertical y vertical-horizontal) en el orden de preferencia. */
function steps(a: RoutePoint, b: RoutePoint, verticalFirst: boolean): Step[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const flatX = Math.abs(dx) < EPS;
  const flatY = Math.abs(dy) < EPS;
  if (flatX && flatY) return [];
  if (flatY) { const d: Dir = { axis: 'h', sign: signOf(dx) }; return [{ corner: null, first: d, last: d }]; }
  if (flatX) { const d: Dir = { axis: 'v', sign: signOf(dy) }; return [{ corner: null, first: d, last: d }]; }
  const h: Dir = { axis: 'h', sign: signOf(dx) };
  const v: Dir = { axis: 'v', sign: signOf(dy) };
  const hv: Step = { corner: { x: b.x, y: a.y }, first: h, last: v };
  const vh: Step = { corner: { x: a.x, y: b.y }, first: v, last: h };
  return verticalFirst ? [vh, hv] : [hv, vh];
}

/** Costo de pasar de un tramo al siguiente: 1 si dobla, 0 si sigue derecho. */
const turn = (from: Dir, to: Dir): number =>
  (from.axis !== to.axis ? 1 : from.sign === to.sign ? 0 : BACKTRACK);

const samePoint = (a: RoutePoint, b: RoutePoint) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;

/** ¿`a` es mejor camino que `b`? Menos quiebres; a igual costo, el que eligió
 *  el candidato preferido en el tramo MÁS TEMPRANO en que difieren. Así, entre
 *  caminos EQUIVALENTES, agregar o mover un punto cerca del hijo no cambia los
 *  tramos que salen del padre. No es una garantía: si el cambio deja al
 *  arranque de siempre con más quiebres o volviendo sobre sí (pasa justo
 *  cuando un punto queda alineado con su vecino), gana el camino más limpio. */
function better(costA: number, picksA: number[], costB: number, picksB: number[]): boolean {
  if (costA !== costB) return costA < costB;
  for (let i = 0; i < picksA.length && i < picksB.length; i++) {
    if (picksA[i] !== picksB[i]) return picksA[i] < picksB[i];
  }
  return false;
}

/** ¿`b` está sobre el tramo recto a→c, ENTRE los dos? (punto de paso) */
function passThrough(a: RoutePoint, b: RoutePoint, c: RoutePoint): boolean {
  const between = (v: number, m: number, n: number) => v >= Math.min(m, n) - EPS && v <= Math.max(m, n) + EPS;
  if (Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS) return between(b.y, a.y, c.y);
  if (Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS) return between(b.x, a.x, c.x);
  return false;
}

/**
 * Camino ortogonal de un wire con trazo manual. Programación dinámica sobre
 * los tramos (a lo más `MAX_ROUTE_POINTS + 1`) con dos estados — con qué
 * sentido se llega a cada punto —: minimiza los quiebres y evita volver sobre
 * el tramo anterior. Determinista: ante un empate gana el camino que eligió el
 * candidato preferido en el tramo más temprano (`better`); el preferido es el
 * codo horizontal-vertical y, en el tramo que entra al hijo, el
 * vertical-horizontal.
 *
 * Los puntos que caen SOBRE el tramo fijo de un extremo (los primeros sobre el
 * del padre, los últimos sobre el del hijo) ya están en el camino: se rutean
 * como el fin de ese tramo, en vez de salir hasta él y volver.
 */
export function routeWire(s: WireEnd, t: WireEnd, via: RoutePoint[]): RoutedWire {
  const sOut = { x: s.x + s.dir * s.stub, y: s.y };
  const tOut = { x: t.x + t.dir * t.stub, y: t.y };
  const stops = [sOut, ...via.map((p) => ({ x: p.x, y: p.y })), tOut];
  for (let i = 1; i < stops.length - 1 && passThrough(s, stops[i], sOut); i++) stops[i] = { ...sOut };
  for (let i = stops.length - 2; i > 0 && passThrough(t, stops[i], tOut); i--) stops[i] = { ...tOut };
  const legs = stops.length - 1;

  const out: Dir = { axis: 'h', sign: s.dir };
  let states = new Map<string, State>([[dirKey(out), {
    dir: out, cost: 0, picks: [],
    pts: [{ x: s.x, y: s.y, leg: 0 }, { ...sOut, leg: 0 }],
  }]]);
  for (let k = 0; k < legs; k++) {
    const options = steps(stops[k], stops[k + 1], k === legs - 1);
    if (!options.length) continue;                       // punto repetido: no aporta tramo
    const next = new Map<string, State>();
    for (const st of states.values()) {
      options.forEach((o, pick) => {
        const cost = st.cost + turn(st.dir, o.first) + (o.corner ? 1 : 0);
        const picks = [...st.picks, pick];
        const key = dirKey(o.last);
        const seen = next.get(key);
        if (seen && !better(cost, picks, seen.cost, seen.picks)) return;
        next.set(key, {
          dir: o.last, cost, picks,
          pts: [...st.pts, ...(o.corner ? [{ ...o.corner, leg: k }] : []), { ...stops[k + 1], leg: k }],
        });
      });
    }
    states = next;
  }
  // El tramo fijo del hijo entra horizontal, hacia el bloque.
  const into: Dir = { axis: 'h', sign: (t.dir === 1 ? -1 : 1) };
  let best: State | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const st of states.values()) {
    const cost = st.cost + turn(st.dir, into);
    if (!best || better(cost, st.picks, bestCost, best.picks)) { best = st; bestCost = cost; }
  }
  const tagged: Tagged[] = [...(best as State).pts, { x: t.x, y: t.y, leg: legs - 1 }];

  // Tramos para los tiradores: partidos en cada punto, sin los de largo cero.
  // El primero y el último son los tramos fijos de cada extremo.
  const segments: WireSegment[] = [];
  for (let i = 1; i < tagged.length; i++) {
    const a = tagged[i - 1];
    const b = tagged[i];
    if (samePoint(a, b)) continue;
    const fixed = i === 1 || i === tagged.length - 1;
    segments.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, insertAt: b.leg, ...(fixed ? { fixed } : {}) });
  }

  // Esquinas para el dibujo: sin repetidos ni puntos de paso.
  const corners: RoutePoint[] = [];
  for (const p of tagged) {
    const point = { x: p.x, y: p.y };
    if (corners.length && samePoint(corners[corners.length - 1], point)) continue;
    while (corners.length >= 2 && passThrough(corners[corners.length - 2], corners[corners.length - 1], point)) {
      corners.pop();
    }
    corners.push(point);
  }

  return {
    corners, segments, path: roundedPath(corners), mid: pathMidpoint(corners),
    backtracks: Math.floor(bestCost / BACKTRACK),
  };
}

/** Wire con trazo, listo para dibujar: extremos (`wireEnds`) + camino
 *  (`routeWire`) + dónde termina cada tramo fijo. */
export interface RoutedGeometry extends RoutedWire {
  s: WireEnd;
  t: WireEnd;
  /** Fin del tramo fijo del padre / del hijo: vecinos del primer y del último
   *  punto del trazo (para el imán del arrastre). */
  sOut: RoutePoint;
  tOut: RoutePoint;
}

const pathLength = (pts: RoutePoint[]): number => {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  return total;
};

/**
 * Los lados los decide el trazo (`wireEnds`). Única excepción: si por esos
 * lados el wire tiene que volver sobre sí mismo — un punto en el corredor
 * entre dos bloques apilados, o bajo una relación recursiva — y cambiando el
 * lado de un extremo no, se cambia. Entre las combinaciones que sirven gana la
 * de menos quiebres, después la más corta y, en empate, la que conserva el
 * lado del padre. Si ninguna evita el retroceso (punto dentro de un bloque),
 * quedan los lados del trazo.
 *
 * Los puntos se rutean en su píxel entero: la pantalla los guarda así, pero el
 * backend acepta decimales de cualquier otro cliente.
 */
export function routedGeometry(a: Parameters<typeof wireEnds>[0]): RoutedGeometry {
  const via = a.via.map(rounded);
  const pref = wireEnds({ ...a, via });
  const build = (s: WireEnd, t: WireEnd): RoutedGeometry => ({
    ...routeWire(s, t, via), s, t,
    sOut: { x: s.x + s.dir * s.stub, y: s.y },
    tOut: { x: t.x + t.dir * t.stub, y: t.y },
  });
  const chosen = build(pref.s, pref.t);
  if (!chosen.backtracks) return chosen;

  const sAlt = endAt(a.sBox, a.sy, pref.s.dir === 1 ? -1 : 1, a.sStub);
  const tAlt = endAt(a.tBox, a.ty, pref.t.dir === 1 ? -1 : 1, a.tStub);
  let best: RoutedGeometry | null = null;
  for (const [s, t] of [[pref.s, tAlt], [sAlt, pref.t], [sAlt, tAlt]] as const) {
    const g = build(s, t);
    const wins = !best
      || g.backtracks < best.backtracks
      || (g.backtracks === best.backtracks && (g.corners.length < best.corners.length
        || (g.corners.length === best.corners.length && pathLength(g.corners) < pathLength(best.corners))));
    if (wins) best = g;
  }
  return best && best.backtracks < chosen.backtracks ? best : chosen;
}

/** Tiradores «crear punto»: el punto medio de cada tramo con largo suficiente.
 *  Los tramos fijos no ofrecen: un punto ahí no cambia el dibujo. */
export function handleSegments(
  segments: WireSegment[], minLength: number = MIN_HANDLE_SEGMENT,
): { x: number; y: number; insertAt: number }[] {
  const out: { x: number; y: number; insertAt: number }[] = [];
  for (const { a, b, insertAt, fixed } of segments) {
    if (fixed || !(Math.hypot(b.x - a.x, b.y - a.y) >= minLength)) continue;
    out.push({ x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), insertAt });
  }
  return out;
}

/** Punto a mitad del LARGO del camino. */
export function pathMidpoint(pts: RoutePoint[]): RoutePoint {
  if (!pts.length) return { x: 0, y: 0 };
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 0 && left <= len) {
      const f = left / len;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    left -= len;
  }
  return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
}

const fmt = (v: number): string => String(Math.round(v * 100) / 100);

/** Path SVG (M/L/Q absolutos, el mismo dialecto del camino automático) con las
 *  esquinas redondeadas; el radio nunca pasa de la mitad del tramo más corto. */
export function roundedPath(pts: RoutePoint[], radius: number = CORNER_RADIUS): string {
  if (pts.length < 2) return '';
  const parts = [`M ${fmt(pts[0].x)},${fmt(pts[0].y)}`];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const p = pts[i];
    const b = pts[i + 1];
    const la = Math.hypot(p.x - a.x, p.y - a.y);
    const lb = Math.hypot(b.x - p.x, b.y - p.y);
    const r = Math.min(radius, la / 2, lb / 2);
    const straight = (Math.abs(a.x - p.x) < EPS && Math.abs(p.x - b.x) < EPS)
      || (Math.abs(a.y - p.y) < EPS && Math.abs(p.y - b.y) < EPS);
    if (straight || !(r >= EPS)) { parts.push(`L ${fmt(p.x)},${fmt(p.y)}`); continue; }
    const inX = p.x + ((a.x - p.x) * r) / la;
    const inY = p.y + ((a.y - p.y) * r) / la;
    const outX = p.x + ((b.x - p.x) * r) / lb;
    const outY = p.y + ((b.y - p.y) * r) / lb;
    parts.push(`L ${fmt(inX)},${fmt(inY)} Q ${fmt(p.x)},${fmt(p.y)} ${fmt(outX)},${fmt(outY)}`);
  }
  const last = pts[pts.length - 1];
  parts.push(`L ${fmt(last.x)},${fmt(last.y)}`);
  return parts.join(' ');
}

// ── Edición ────────────────────────────────────────────────────────────────

/** Punto nuevo en la posición `index`. Con el tope alcanzado devuelve la MISMA lista. */
export function insertPoint(via: RoutePoint[], index: number, p: RoutePoint): RoutePoint[] {
  if (via.length >= MAX_ROUTE_POINTS) return via;
  const at = Math.max(0, Math.min(via.length, index));
  return [...via.slice(0, at), rounded(p), ...via.slice(at)];
}

export function movePoint(via: RoutePoint[], index: number, p: RoutePoint): RoutePoint[] {
  if (index < 0 || index >= via.length) return via;
  return via.map((q, i) => (i === index ? rounded(p) : q));
}

export function removePoint(via: RoutePoint[], index: number): RoutePoint[] {
  if (index < 0 || index >= via.length) return via;
  return via.filter((_, i) => i !== index);
}

/** Igualdad por valor; sin trazo ≡ trazo vacío. */
export function sameRoute(a: RoutePoint[] | null | undefined, b: RoutePoint[] | null | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((p, i) => p.x === y[i].x && p.y === y[i].y);
}

/** Imán: alinea `p` con el eje del vecino más cercano, por separado en X e Y,
 *  si queda dentro de `tol` (px de canvas). */
export function snapPoint(p: RoutePoint, neighbors: RoutePoint[], tol: number): RoutePoint {
  if (!(tol > 0)) return p;
  let x = p.x;
  let y = p.y;
  let bestX = tol;
  let bestY = tol;
  for (const n of neighbors) {
    const dx = Math.abs(p.x - n.x);
    const dy = Math.abs(p.y - n.y);
    if (dx <= bestX) { bestX = dx; x = n.x; }
    if (dy <= bestY) { bestY = dy; y = n.y; }
  }
  return { x, y };
}

/** Aviso del auto-arrange en edición (doc 99): mueve todos los bloques, así
 *  que los trazos manuales del canvas se reinician. null = nada que avisar. */
export function arrangeResetWarning(count: number): string | null {
  if (!(count > 0)) return null;
  const many = count !== 1;
  return `Auto-arrange moves every block, so the ${count} manual wire route${many ? 's' : ''} on this canvas `
    + `will be reset to the automatic path. You can bring ${many ? 'them' : 'it'} back with Undo.`;
}
