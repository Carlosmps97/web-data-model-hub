/**
 * Regla única para ubicar ventanas flotantes (tooltips, menús, popovers): las
 * prácticas de Floating UI / Popper, sin librería.
 *  · flip  — si no entra del lado pedido, se abre del lado opuesto;
 *  · shift — se corre sobre el otro eje para quedar dentro, con margen (`pad`);
 *  · size  — si no entra en ningún lado, toma el lado con más espacio y limita
 *            el alto (`maxHeight`: scroll interno).
 * Puras: reciben el tamaño medido del cuadro y el área donde debe quedar
 * (la ventana: `viewportBounds`). El hook `useFloating` mide y aplica.
 */

export interface Size { width: number; height: number }
/** Rectángulo en coordenadas de la ventana (un `DOMRect` sirve). */
export interface RectLike { left: number; top: number; right: number; bottom: number }
export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Align = 'start' | 'center' | 'end';
export interface Placement {
  left: number;
  top: number;
  /** Lado final (tras el flip). */
  side: Side;
  /** Alto máximo cuando no entra entero (null = entra). */
  maxHeight: number | null;
}
export interface PlaceOptions {
  side?: Side;
  align?: Align;
  /** Separación con el ancla. */
  gap?: number;
  /** Margen con el borde del área. */
  pad?: number;
}

const PAD = 8;

/** Corre `pos` para que [pos, pos+size] quede dentro de [min, max]; si no
 *  cabe, queda pegado al inicio. */
function shift(pos: number, size: number, min: number, max: number): number {
  if (size > max - min) return min;
  return Math.min(Math.max(pos, min), max - size);
}

/** Cuadro junto a un ancla (botón, fila, celda). Por defecto debajo y
 *  alineado al inicio del ancla. */
export function placeNextTo(anchor: RectLike, box: Size, bounds: RectLike, opts: PlaceOptions = {}): Placement {
  const { side = 'bottom', align = 'start', gap = 6, pad = PAD } = opts;
  const vertical = side === 'bottom' || side === 'top';
  const opposite: Side = side === 'bottom' ? 'top' : side === 'top' ? 'bottom' : side === 'right' ? 'left' : 'right';
  const room = (s: Side) => {
    if (s === 'bottom') return bounds.bottom - pad - (anchor.bottom + gap);
    if (s === 'top') return anchor.top - gap - (bounds.top + pad);
    if (s === 'right') return bounds.right - pad - (anchor.right + gap);
    return anchor.left - gap - (bounds.left + pad);
  };
  const need = vertical ? box.height : box.width;
  let chosen: Side = side;
  let capped = false;
  if (need > room(side)) {
    if (need <= room(opposite)) chosen = opposite;
    else {
      chosen = room(opposite) > room(side) ? opposite : side;
      capped = vertical;          // solo el alto se limita (el ancho se corre)
    }
  }
  if (vertical) {
    const maxHeight = capped ? Math.max(0, Math.floor(room(chosen))) : null;
    const h = maxHeight ?? box.height;
    const top = chosen === 'bottom' ? anchor.bottom + gap : anchor.top - gap - h;
    const base = align === 'start' ? anchor.left
      : align === 'center' ? anchor.left + (anchor.right - anchor.left - box.width) / 2
        : anchor.right - box.width;
    const left = shift(base, box.width, bounds.left + pad, bounds.right - pad);
    return { left: Math.round(left), top: Math.round(top), side: chosen, maxHeight };
  }
  const x = chosen === 'right' ? anchor.right + gap : anchor.left - gap - box.width;
  const left = shift(x, box.width, bounds.left + pad, bounds.right - pad);
  const avail = bounds.bottom - bounds.top - 2 * pad;
  const base = align === 'start' ? anchor.top
    : align === 'center' ? anchor.top + (anchor.bottom - anchor.top - box.height) / 2
      : anchor.bottom - box.height;
  if (box.height > avail) {
    return { left: Math.round(left), top: Math.round(bounds.top + pad), side: chosen, maxHeight: Math.max(0, Math.floor(avail)) };
  }
  const top = shift(base, box.height, bounds.top + pad, bounds.bottom - pad);
  return { left: Math.round(left), top: Math.round(top), side: chosen, maxHeight: null };
}

/** Al costado (`right` / `left`, el otro si no entra) y, si no entra en
 *  ninguno, abajo: corrido sobre su propio ancla, un tooltip taparía el nombre
 *  del botón. */
export function placeBeside(anchor: RectLike, box: Size, bounds: RectLike, opts: PlaceOptions = {}): Placement {
  const p = placeNextTo(anchor, box, bounds, opts);
  const beside = p.side === 'right' || p.side === 'left';
  if (beside && p.left < anchor.right && p.left + box.width > anchor.left) return placeNextTo(anchor, box, bounds, { ...opts, side: 'bottom' });
  return p;
}

/** Menú contextual en el cursor: abajo a la derecha; a la izquierda y/o arriba
 *  del cursor si no entra; corrido o con alto máximo si tampoco. */
export function placeAtPoint(point: { x: number; y: number }, box: Size, bounds: RectLike, opts: { pad?: number } = {}): Placement {
  const pad = opts.pad ?? PAD;
  let left: number;
  if (point.x + box.width <= bounds.right - pad) left = point.x;
  else if (point.x - box.width >= bounds.left + pad) left = point.x - box.width;
  else left = shift(point.x, box.width, bounds.left + pad, bounds.right - pad);
  const below = bounds.bottom - pad - point.y;
  const above = point.y - (bounds.top + pad);
  const avail = bounds.bottom - bounds.top - 2 * pad;
  let top: number;
  let side: Side = 'bottom';
  let maxHeight: number | null = null;
  if (box.height <= below) top = point.y;
  else if (box.height <= above) { top = point.y - box.height; side = 'top'; }
  else if (box.height <= avail) { top = bounds.bottom - pad - box.height; side = below >= above ? 'bottom' : 'top'; }
  else { top = bounds.top + pad; maxHeight = Math.max(0, Math.floor(avail)); }
  // Con el cursor dentro del margen, igual respeta los 8 px del borde.
  left = shift(left, box.width, bounds.left + pad, bounds.right - pad);
  if (maxHeight === null) top = shift(top, box.height, bounds.top + pad, bounds.bottom - pad);
  return { left: Math.round(left), top: Math.round(top), side, maxHeight };
}

/** Intersección de rectángulos (vacía si no se cruzan: ancho o alto ≤ 0). */
export function intersectRects(rects: RectLike[]): RectLike {
  return rects.reduce((a, b) => ({
    left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom),
  }));
}

/** ¿El rectángulo `a` está por completo fuera de `clip`? (un control que el
 *  scroll de su panel sacó de la vista). */
export function outside(a: RectLike, clip: RectLike): boolean {
  return a.bottom <= clip.top || a.top >= clip.bottom || a.right <= clip.left || a.left >= clip.right;
}

/** El desplegable de un control que vive dentro de paneles con scroll: se
 *  ubica en la ventana (`viewport`), como cualquier desplegable (si abajo no
 *  entra, arriba, sobre lo que haya), y se oculta (null) solo cuando el control
 *  salió de la vista de sus paneles (`clip`, ver `clipRect`). Limitado al panel
 *  recortado quedaría de 60 px en ventanas bajas. */
export function placeAnchored(anchor: RectLike, clip: RectLike, box: Size, viewport: RectLike, opts: PlaceOptions = {}): Placement | null {
  return outside(anchor, clip) ? null : placeNextTo(anchor, box, viewport, opts);
}

/** El área de los desplegables del contenido: la ventana sin la barra superior
 *  de la app (`.dmh-topnav`, z-index 40), que queda por encima de ellos (abiertos
 *  hacia arriba en ventanas bajas se esconderían debajo). Con la barra fuera de
 *  la vista (o sin ella), la ventana. */
export function contentBounds(viewport: RectLike): RectLike {
  if (typeof document === 'undefined') return viewport;
  const bar = document.querySelector('.dmh-topnav')?.getBoundingClientRect();
  if (!bar || bar.bottom <= viewport.top) return viewport;
  return { ...viewport, top: Math.min(bar.bottom, viewport.bottom) };
}

/** La parte de la ventana donde se ve un control que está dentro de
 *  contenedores con scroll: la ventana recortada por cada ancestro que recorta
 *  su contenido (overflow distinto de visible). Si el control sale de ahí, su
 *  desplegable se oculta (`placeAnchored`). */
export function clipRect(el: Element): RectLike {
  const rects: RectLike[] = [viewportBounds()];
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (/(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) rects.push(p.getBoundingClientRect());
  }
  return intersectRects(rects);
}

/** El área visible de la ventana (sin barras de scroll). En node (tests),
 *  un área vacía. */
export function viewportBounds(): RectLike {
  if (typeof window === 'undefined' || typeof document === 'undefined') return { left: 0, top: 0, right: 0, bottom: 0 };
  const html = document.documentElement;
  return { left: 0, top: 0, right: html.clientWidth || window.innerWidth, bottom: html.clientHeight || window.innerHeight };
}
