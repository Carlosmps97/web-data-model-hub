/**
 * «El centro de lo que el usuario está viendo del canvas»: ahí nacen la tabla
 * nueva (New table / Import existing / CTAS / pegar sin el original a la
 * vista), los dibujos y lo que trae la carga Excel. Ubicar la tabla por número
 * de orden (`60 + (i % 4)·260`, `60 + ⌊i/4⌋·220`) la dejaría, en un modelo de
 * cientos de tablas, miles de píxeles más abajo.
 */
import type { ReactFlowInstance } from '@xyflow/react';
import type { RectLike } from '@/lib/floating';

export interface PaneRect { left: number; top: number; width: number; height: number }
export interface Point { x: number; y: number }

/** Centro (en pantalla) del área del canvas. `panelOpening`: lo que el panel de
 *  Properties le quitará por la derecha al abrirse (0 si no se abre o ya está;
 *  negativo si se cerrará y el canvas se ensanchará). */
export function visibleCenter(pane: PaneRect, panelOpening = 0): Point {
  const width = Math.max(0, pane.width - panelOpening);
  return { x: pane.left + width / 2, y: pane.top + pane.height / 2 };
}

/** Esquina superior izquierda para que un bloque `w`×`h` quede centrado en `c`. */
export function centeredAt(c: Point, size: { w: number; h: number }): Point {
  return { x: Math.round(c.x - size.w / 2), y: Math.round(c.y - size.h / 2) };
}

/** Ancho del panel de Properties: el que dejó el usuario al redimensionarlo
 *  (`--props-w`, lo fija WorkspaceScreen) o el default de `.wk.has-props` en
 *  modeler.css: `min(472px, 38vw)`. */
export function propsPanelWidth(cssVar: string, viewportWidth: number): number {
  const v = parseFloat(cssVar);
  return Number.isFinite(v) && v > 0 ? v : Math.min(472, viewportWidth * 0.38);
}

/** ¿`p` cae dentro de `r` (bordes incluidos)? */
export function insideRect(p: Point, r: RectLike): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

/** Lo que el usuario ve del canvas, en coordenadas del flujo: el centro y el
 *  rectángulo visible. */
export interface CanvasView { center: Point; rect: RectLike }

/** Dónde nace un bloque nuevo de `w`×`h`: centrado en lo que se ve; si es más
 *  alto que lo visible, con su cabecera (el nombre) a la vista; si es más ancho
 *  (zoom alto, nombre largo), con su nombre — a la izquierda — a la vista. */
export function blockSpot(view: CanvasView, size: { w: number; h: number }, margin = 24): Point {
  const p = centeredAt(view.center, size);
  const x = size.w > view.rect.right - view.rect.left ? Math.round(view.rect.left + margin) : p.x;
  return { x, y: Math.max(p.y, Math.round(view.rect.top + margin)) };
}

/** Alto de la cabecera de un bloque (la fila con su nombre). */
const HEADER_H = 32;
/** Lo que debe asomar de un bloque reciente: la esquina con su nombre. */
const GRIP_W = 36;

/** Un bloque del canvas para la cascada: su esquina y su ancho (240 si no se conoce). */
export interface StackBox { x: number; y: number; w?: number }

/** Desplazamientos (en pasos) donde buscar el lugar libre más cercano
 *  cuando la cascada sale de lo visible — hasta 10 pasos por lado, del más
 *  cercano al más lejano (empates: arriba antes que abajo, izquierda antes que
 *  derecha). */
const NEAREST: readonly [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let dx = -10; dx <= 10; dx++) for (let dy = -10; dy <= 10; dy++) if (dx || dy) out.push([dx, dy]);
  return out.sort((a, b) => (a[0] ** 2 + a[1] ** 2) - (b[0] ** 2 + b[1] ** 2) || a[1] - b[1] || a[0] - b[0]);
})();

/** Altas seguidas en el mismo centro (importar varias tablas una tras otra, dos
 *  tablas en blanco) no deben quedar exactamente una encima de la otra. El
 *  bloque nuevo (`size`) baja en cascada (`step` en diagonal) mientras:
 *   · arranque a la misma altura (±`tol`) que un bloque del canvas (`others`) y
 *     se cruce en horizontal (quedaría justo encima); o
 *   · tape la esquina con el nombre (36 × 32) de un bloque reciente (`recent`:
 *     lo creado en esta sesión, también lo pendiente de pintar); así una
 *     CTAS más alta, centrada más arriba, no tapa entera a la tabla anterior.
 *  Un bloque existente a otra altura puede quedar detrás, a propósito.
 *  Con `keepIn` (lo visible): si en la cascada su cabecera saldría de ahí, nace
 *  en el lugar libre más cercano a `spot` con la cabecera a la vista (volver a
 *  `spot` lo dejaría exactamente encima del primero); null solo si no queda
 *  ninguno (el llamador decide). */
export function avoidStacking(
  spot: Point, size: { w: number; h?: number }, others: StackBox[], recent: StackBox[] = [],
  keepIn?: RectLike, step = 36, tol = 4,
): Point | null {
  const h = size.h ?? HEADER_H;
  const blocked = (p: Point) =>
    others.some((o) => Math.abs(o.y - p.y) <= tol && o.x < p.x + size.w && p.x < o.x + (o.w ?? 240))
    || recent.some((r) => r.x < p.x + size.w && p.x < r.x + GRIP_W && r.y < p.y + h && p.y < r.y + HEADER_H);
  // «A la vista» = la cabecera entera; la de un bloque más ancho que lo visible
  // nunca entra: basta la esquina con el nombre.
  const fits = !keepIn || size.w <= keepIn.right - keepIn.left;
  const shownW = (p: Point, w: number) => !keepIn
    || (insideRect(p, keepIn) && insideRect({ x: p.x + w, y: p.y + HEADER_H }, keepIn));
  const shown = (p: Point) => shownW(p, fits ? size.w : GRIP_W);
  const nearest = (ok: (q: Point) => boolean): Point | null => {
    for (const [dx, dy] of NEAREST) {
      const q = { x: spot.x + dx * step, y: spot.y + dy * step };
      if (ok(q) && !blocked(q)) return q;
    }
    return null;
  };
  let p = { ...spot };
  for (let i = 0; i < 200 && blocked(p); i++) {
    p = { x: p.x + step, y: p.y + step };
    // Sin lugar con la cabecera entera a la vista: con la esquina del nombre.
    if (!shown(p)) return nearest(shown) ?? (fits ? nearest((q) => shownW(q, GRIP_W)) : null);
  }
  return p;
}

/** Último recurso cuando no queda ningún lugar libre a la vista: la cascada
 *  diagonal sigue (aunque salga de la vista) antes que tapar entero a un bloque
 *  reciente; volver al centro lo dejaría exactamente encima del primero. */
export function cascade(spot: Point, size: { w: number; h?: number }, others: StackBox[], recent: StackBox[] = []): Point {
  return avoidStacking(spot, size, others, recent) ?? spot;
}

/** Lo que se ve del canvas abierto (flujo). `panel`: el panel de Properties
 *  se abrirá (la acción selecciona una tabla: se descuenta si no está abierto)
 *  o se cerrará (la carga Excel recarga el canvas sin selección: se suma si
 *  está abierto). null sin canvas montado (o en node, sin DOM). */
export function canvasView(
  rf: Pick<ReactFlowInstance, 'screenToFlowPosition'> | null, opts: { panel?: 'opens' | 'closes' } = {},
): CanvasView | null {
  if (!rf || typeof document === 'undefined') return null;
  const pane = document.querySelector<HTMLElement>('.wk-canvas .react-flow');
  if (!pane) return null;
  const r = pane.getBoundingClientRect();
  const wk = pane.closest<HTMLElement>('.wk');
  const open = !!wk?.classList.contains('has-props');
  const width = () => propsPanelWidth(getComputedStyle(wk!).getPropertyValue('--props-w'), window.innerWidth);
  const opening = !wk ? 0 : opts.panel === 'opens' && !open ? width() : opts.panel === 'closes' && open ? -width() : 0;
  const box = { left: r.left, top: r.top, width: r.width, height: r.height };
  const tl = rf.screenToFlowPosition({ x: box.left, y: box.top });
  const br = rf.screenToFlowPosition({ x: box.left + Math.max(0, box.width - opening), y: box.top + box.height });
  return { center: rf.screenToFlowPosition(visibleCenter(box, opening)), rect: { left: tl.x, top: tl.y, right: br.x, bottom: br.y } };
}

/** Un bloque del canvas (flujo): esquina, ancho y alto. */
export interface FlowBox { x: number; y: number; w: number; h: number }
/** Viewport de React Flow: traslación en píxeles del canvas y zoom. */
export interface FlowViewport { x: number; y: number; zoom: number }

/** Hasta dónde se acerca al enfocar (100 %, el tamaño real) y el zoom
 *  mínimo al que se lee (por debajo, la tabla sola o desde su cabecera). */
const FOCUS_CAP = 1;
const FOCUS_MIN = 0.6;

/** Al seleccionar una tabla (se abre el panel de Properties) el canvas se
 *  acerca y centra la tabla con sus vistas en `area`: lo que se ve del canvas,
 *  que ya descuenta el panel. Se acerca hasta 100 %; si el usuario ya estaba
 *  más cerca y el grupo entra, no aleja. Las vistas se suman de la más cercana
 *  a la más lejana mientras el grupo entre legible (60 %): una vista lejísimos
 *  no descarta a la de al lado. Una tabla más alta que el área se muestra desde
 *  su cabecera (con una vista encima, alinear el grupo arriba la dejaría
 *  fuera), con las vistas que entren a lo ancho y se vean. Margen: 8 % del lado
 *  menor, hasta 48 px. Puro. */
export function focusViewport(table: FlowBox, views: FlowBox[], area: { width: number; height: number }, currentZoom: number): FlowViewport {
  const pad = Math.min(48, Math.round(0.08 * Math.min(area.width, area.height)));
  const aw = Math.max(1, area.width - 2 * pad);
  const ah = Math.max(1, area.height - 2 * pad);
  const up = Math.max(currentZoom, FOCUS_CAP);
  const fitW = (b: FlowBox) => aw / Math.max(1, b.w);
  const fit = (b: FlowBox) => Math.min(fitW(b), ah / Math.max(1, b.h));
  const union = (a: FlowBox, b: FlowBox): FlowBox => {
    const l = Math.min(a.x, b.x), t = Math.min(a.y, b.y);
    return { x: l, y: t, w: Math.max(a.x + a.w, b.x + b.w) - l, h: Math.max(a.y + a.h, b.y + b.h) - t };
  };
  const center = (b: FlowBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const c = center(table);
  const near = [...views].sort((a, b) => Math.hypot(center(a).x - c.x, center(a).y - c.y) - Math.hypot(center(b).x - c.x, center(b).y - c.y));
  const centered = (b: FlowBox, zoom: number): FlowViewport =>
    ({ x: area.width / 2 - (b.x + b.w / 2) * zoom, y: area.height / 2 - (b.y + b.h / 2) * zoom, zoom });
  let all = table;
  if (fit(table) >= FOCUS_MIN) {
    for (const v of near) {
      const u = union(all, v);
      if (fit(u) >= FOCUS_MIN) all = u;
    }
    return centered(all, Math.min(fit(all), up));
  }
  // La tabla no entra legible: zoom por el ancho del grupo (60 % como mínimo);
  // en cada eje, el grupo centrado si entra o, si no, la tabla desde su cabecera
  // / su borde izquierdo (una tabla ancha y baja queda centrada en vertical).
  // Una vista solo se suma si se va a ver (una encima de la cabecera o muy abajo
  // bajaría el zoom y correría la tabla sin dibujarse).
  const place = (g: FlowBox): FlowViewport => {
    const zoom = Math.min(Math.max(fitW(g), FOCUS_MIN), up);
    const x = g.w * zoom <= aw ? area.width / 2 - (g.x + g.w / 2) * zoom : pad - table.x * zoom;
    const y = g.h * zoom <= ah ? area.height / 2 - (g.y + g.h / 2) * zoom : pad - table.y * zoom;
    return { x, y, zoom };
  };
  const seen = (b: FlowBox, vp: FlowViewport) => {
    const l = b.x * vp.zoom + vp.x, t = b.y * vp.zoom + vp.y;
    return l < area.width - pad && l + b.w * vp.zoom > pad && t < area.height - pad && t + b.h * vp.zoom > pad;
  };
  for (const v of near) {
    const u = union(all, v);
    if (fitW(u) >= FOCUS_MIN && seen(v, place(u))) all = u;
  }
  return place(all);
}

/** Lo que se ve del canvas para encuadrar: sin la franja del minimapa (abajo a
 *  la derecha; en una laptop taparía parte de la vista encuadrada), con 8 px de
 *  aire; nunca menos de la mitad del canvas. */
export function usableArea(pane: RectLike & { width: number; height: number }, minimap: RectLike | null): { width: number; height: number } {
  if (!minimap) return { width: pane.width, height: pane.height };
  return { width: pane.width, height: Math.max(pane.height / 2, Math.min(pane.height, minimap.top - pane.top - 8)) };
}

/** Tamaño del área del canvas abierto para encuadrar (`usableArea`: ya sin el
 *  panel de Properties si está abierto, ni el minimapa). null sin canvas
 *  montado (o en node, sin DOM). */
export function paneSize(): { width: number; height: number } | null {
  if (typeof document === 'undefined') return null;
  const pane = document.querySelector<HTMLElement>('.wk-canvas .react-flow');
  if (!pane) return null;
  const r = pane.getBoundingClientRect();
  const mini = pane.querySelector<HTMLElement>('.react-flow__minimap')?.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? usableArea(r, mini && mini.height > 0 ? mini : null) : null;
}
