import { useLayoutEffect, useRef, useState, type CSSProperties, type DependencyList, type RefObject } from 'react';
import { viewportBounds, type Placement, type RectLike, type Size } from '@/lib/floating';

export interface FloatingOptions {
  /** Re-ubicar también con el scroll de cualquier contenedor (el ancla se mueve con él). */
  follow?: boolean;
  /** Ancho a imponer al cuadro (p. ej. el del control al que se ancla un desplegable). */
  matchWidth?: () => number | null | undefined;
}

/** Lo que se pinta: la ubicación y el ancho impuesto; `hidden` = sin lugar (el
 *  ancla salió de la vista). */
export type Placed = Placement & { width: number | null; hidden?: boolean };

/** Lo que se pinta tras medir: la ubicación con el ancho impuesto o, sin lugar,
 *  oculto CON el ancho impuesto y el lado de antes (para volver de ese lado).
 *  Ronda 2 de la revisión: sin el ancho, React lo borraba, el cuadro cambiaba
 *  de tamaño y el ResizeObserver lo volvía a escribir dentro de su propio aviso
 *  («ResizeObserver loop completed with undelivered notifications»). */
export function nextPlaced(at: Placement | null, width: number | null, last: Placed | null): Placed {
  return at ? { ...at, width } : { left: 0, top: 0, side: last?.side ?? 'bottom', maxHeight: null, width, hidden: true };
}

/** ¿Pintan lo mismo? (oculto no es lo mismo que a la vista en (0, 0)). */
export function samePlaced(a: Placed | null, b: Placed | null): boolean {
  return !!a && !!b && a.left === b.left && a.top === b.top && a.side === b.side
    && a.maxHeight === b.maxHeight && a.width === b.width && !!a.hidden === !!b.hidden;
}

/** Estilo del cuadro. Hasta medirlo (y mientras su ancla no se ve) queda
 *  transparente y sin eventos — NO con `visibility: hidden`: un `autoFocus` o el
 *  `focus()` del montaje no entran a un elemento oculto (revisión doc 113: el
 *  buscador del filtro de Reporting perdía lo tipeado y el selector de color no
 *  recibía el foco). */
export function floatingStyle(placed: Placed | null): CSSProperties {
  if (!placed || placed.hidden) {
    return { position: 'fixed', left: 0, top: 0, opacity: 0, pointerEvents: 'none', ...(placed?.width != null ? { width: placed.width } : {}) };
  }
  return {
    position: 'fixed', left: placed.left, top: placed.top,
    ...(placed.width != null ? { width: placed.width } : {}),
    ...(placed.maxHeight != null ? { maxHeight: placed.maxHeight, overflowY: 'auto' as const } : {}),
  };
}

/**
 * Doc 113 §5 — mide el cuadro flotante ANTES de pintarlo (layout effect) y lo
 * ubica con `compute` (`placeNextTo` / `placeAtPoint` de `lib/floating`; recibe
 * la ubicación anterior para conservar el lado mientras entre). Se re-ubica si
 * cambia el tamaño de la ventana o el del propio cuadro (ResizeObserver: ítems
 * que cargan después, una lista que se filtra) y, con `follow`, con el scroll de
 * cualquier contenedor. Devuelve el estilo `position: fixed` a aplicar.
 */
export function useFloating(
  ref: RefObject<HTMLElement | null>,
  compute: (box: Size, bounds: RectLike, prev: Placement | null) => Placement | null,
  deps: DependencyList,
  opts: FloatingOptions = {},
): CSSProperties {
  const [placed, setPlaced] = useState<Placed | null>(null);
  // La última ubicación sobrevive a los cambios de deps (p. ej. la lista que se
  // filtra al tipear): con ella `compute` conserva el lado y no salta.
  const lastRef = useRef<Placed | null>(null);
  const { follow = false } = opts;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const last = lastRef.current;
      const width = opts.matchWidth?.() ?? null;
      // El ancho impuesto ANTES de medir el alto: con otro ancho las filas envuelven distinto.
      if (width != null) el.style.width = `${width}px`;
      // Alto NATURAL: el contenido + bordes (sin el maxHeight de una medición anterior).
      const height = el.scrollHeight + (el.offsetHeight - el.clientHeight);
      const at = compute({ width: width ?? el.offsetWidth, height }, viewportBounds(), last);
      const next = nextPlaced(at, width, last);
      if (samePlaced(last, next)) return;
      lastRef.current = next;
      setPlaced(next);
    };
    // El scroll DENTRO del cuadro (su propia lista) no mueve el ancla.
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && el.contains(e.target))) measure(); };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    ro?.observe(el);
    window.addEventListener('resize', measure);
    if (follow) window.addEventListener('scroll', onScroll, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      if (follow) window.removeEventListener('scroll', onScroll, true);
    };
    // `compute` y `matchWidth` son nuevas en cada render: mandan los deps del llamador (el ancla).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, follow]);
  return floatingStyle(placed);
}
