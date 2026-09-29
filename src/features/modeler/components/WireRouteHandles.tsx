import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { EdgeLabelRenderer, useReactFlow, useStore } from '@xyflow/react';
import { RotateCcw } from 'lucide-react';
import {
  MAX_ROUTE_POINTS, MIN_HANDLE_SEGMENT, SNAP_PX,
  handleSegments, insertPoint, movePoint, removePoint, snapPoint,
  type RoutePoint, type WireSegment,
} from '../lib/wireRoute';

/** Movimiento mínimo (px de pantalla) para que un gesto cuente como arrastre:
 *  un clic o un doble clic sobre un tirador no crea ni mueve nada. El mismo
 *  umbral con que el canvas separa el temblor del trackpad de un arrastre. */
const DRAG_THRESHOLD = 4;
/** Pausa después de la última flecha para grabar: varias flechas seguidas son
 *  UN movimiento (una escritura, una entrada de Undo). */
const NUDGE_SAVE_MS = 600;
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};
interface Drag {
  index: number;
  base: RoutePoint[];
  x0: number;
  y0: number;
  moved: boolean;
  last: RoutePoint[] | null;
  /** El gesto ya terminó (soltó, canceló o se desmontó); puede faltar el pointerup. */
  over: boolean;
  /** Termina el gesto SIN guardar y suelta los listeners. */
  stop: () => void;
}

/** El `click` que el navegador despacha al soltar un arrastre cae donde quedó
 *  el cursor — sobre el fondo, si el imán o un Esc dejaron el punto lejos — y
 *  deseleccionaría el wire. Se descarta ese clic, y solo ese. */
function swallowNextClick(): void {
  const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener('click', swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);
}

/**
 * Tiradores del trazo manual de un wire (doc 99). Solo se montan sobre el wire
 * SELECCIONADO, en sesión de edición y con zoom de detalle. Van en la capa HTML
 * de etiquetas de React Flow y quedan ENCIMA de los bloques (un punto soltado
 * sobre un bloque se puede volver a agarrar), con `nodrag nopan nokey`: sus
 * gestos no mueven el canvas, no hacen zoom ni abren un rectángulo de selección.
 *
 *  · punto lleno  — arrastrar lo mueve (imán a los ejes de sus vecinos), doble
 *                   clic o Supr lo quita, las flechas lo mueven de a 1 px.
 *  · punto hueco  — en la mitad de cada tramo: arrastrar crea un punto ahí
 *                   (un doble clic sobre él abre el popup del wire, como
 *                   sobre el wire mismo).
 *  · botón ↺      — vuelve al camino automático.
 *
 * Mientras se arrastra el trazo vive en el estado local del wire (`onDraft`);
 * se guarda UNA vez, al soltar (`onCommit`). El arrastre escucha en `window`:
 * el tirador que lo inició puede desmontarse cuando el trazo cambia de forma.
 *
 * Los tiradores aparecen BAJO el cursor de quien acaba de seleccionar el wire:
 * el segundo clic de un doble clic sobre el wire puede caer en uno. Por eso un
 * punto solo se quita con un doble clic cuyos DOS clics fueron sobre él, y ↺
 * solo responde a un clic simple; lo demás sigue hasta el wire y abre su popup.
 */
export default function WireRouteHandles({ via, segments, center, ends, onDraft, onCommit }: {
  /** Trazo vigente (el guardado o el que se está arrastrando); [] = automático. */
  via: RoutePoint[];
  /** Tramos del camino trazado; null = camino automático. */
  segments: WireSegment[] | null;
  /** Centro del camino: único tirador «crear punto» de un wire automático. */
  center: RoutePoint;
  /** Vecinos de los extremos para el imán: dónde termina cada tramo fijo. */
  ends: { s: RoutePoint; t: RoutePoint };
  onDraft: (via: RoutePoint[] | null) => void;
  onCommit: (via: RoutePoint[] | null) => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const [dragging, setDragging] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  /** Movimiento con flechas todavía sin grabar, y el reloj que lo graba. */
  const nudged = useRef<RoutePoint[] | null>(null);
  const nudgeTimer = useRef<number | null>(null);
  /** Punto que recibió el PRIMER clic de un posible doble clic. */
  const firstClickOn = useRef<number | null>(null);
  // Lo último que recibió el componente, para los listeners de `window`.
  const live = useRef({ ends, zoom, onDraft, onCommit });
  useEffect(() => { live.current = { ends, zoom, onDraft, onCommit }; });
  // Al desmontar con un gesto a medias (el zoom cruzó a LOD compacto, cambió
  // el canvas) se suelta SIN guardar y el borrador se descarta: el wire no
  // puede quedar mostrando un trazo que nunca se grabó.
  useEffect(() => () => {
    if (nudgeTimer.current != null) window.clearTimeout(nudgeTimer.current);
    const pending = !!drag.current || !!nudged.current;
    drag.current?.stop();
    drag.current = null;
    nudged.current = null;
    if (pending) live.current.onDraft(null);
  }, []);

  const startDrag = useCallback((e: ReactPointerEvent, index: number, base: RoutePoint[], focus = false) => {
    // Ctrl+clic en macOS abre el menú contextual y su pointerup nunca llega.
    if (e.button !== 0 || e.ctrlKey) return;
    e.stopPropagation();
    e.preventDefault();
    // `preventDefault` también cancela el foco: se da a mano, para que Supr y
    // las flechas respondan sobre el punto que se acaba de tocar.
    if (focus) (e.currentTarget as HTMLElement).focus({ preventScroll: true });
    drag.current?.stop();
    const pointerId = e.pointerId;
    const release = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      if (drag.current === d) drag.current = null;
    };
    const end = (commit: boolean) => {
      if (d.over) return;
      d.over = true;
      setDragging(null);
      if (commit && d.moved && d.last) live.current.onCommit(d.last);
      else live.current.onDraft(null);
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      // El botón ya no está apretado y nadie avisó (menú contextual, otra
      // ventana): el arrastre termina acá, sin guardar.
      if ((ev.buttons & 1) === 0) { release(); end(false); return; }
      if (d.over) return;
      if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < DRAG_THRESHOLD) return;
      if (!d.moved) { d.moved = true; setDragging(d.index); }
      const at = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const prev = d.index === 0 ? live.current.ends.s : d.base[d.index - 1];
      const next = d.index === d.base.length - 1 ? live.current.ends.t : d.base[d.index + 1];
      d.last = movePoint(d.base, d.index, snapPoint(at, [prev, next], SNAP_PX / live.current.zoom));
      live.current.onDraft(d.last);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      release();
      if (d.moved) swallowNextClick();
      end(true);
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      release();
      end(false);
    };
    // Esc cancela, pero el botón sigue apretado: los listeners quedan hasta el
    // pointerup, que es el que descarta el clic de soltar.
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') end(false); };
    const d: Drag = {
      index, base, x0: e.clientX, y0: e.clientY, moved: false, last: null, over: false,
      stop: () => { release(); end(false); },
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    drag.current = d;
  }, [screenToFlowPosition]);

  /** Graba el movimiento con flechas que esté pendiente. */
  const commitNudge = () => {
    if (nudgeTimer.current != null) { window.clearTimeout(nudgeTimer.current); nudgeTimer.current = null; }
    const moved = nudged.current;
    if (!moved) return;
    nudged.current = null;
    onCommit(moved);
  };

  /** Solo se quedan con el evento las teclas que el punto usa; las demás —
   *  Esc, modificadores, deshacer, buscar — siguen hasta los atajos del canvas
   *  y hasta el popup que esté abierto. */
  const onPointKey = (e: ReactKeyboardEvent, index: number) => {
    const remove = e.key === 'Delete' || e.key === 'Backspace';
    const step = ARROWS[e.key];
    if (!remove && !step) return;
    e.stopPropagation();
    e.preventDefault();
    if (remove) {
      // Al quitar un punto el foco queda en el mismo tirador, que pasa a ser
      // el punto siguiente: la tecla mantenida no los quita en cadena.
      if (e.repeat) return;
      if (nudgeTimer.current != null) { window.clearTimeout(nudgeTimer.current); nudgeTimer.current = null; }
      nudged.current = null;
      onCommit(removePoint(via, index));
      return;
    }
    if (nudgeTimer.current != null) { window.clearTimeout(nudgeTimer.current); nudgeTimer.current = null; }
    const by = e.shiftKey ? 10 : 1;
    const next = movePoint(via, index, { x: via[index].x + step[0] * by, y: via[index].y + step[1] * by });
    nudged.current = next;
    onDraft(next);
  };
  /** Las flechas mueven en borrador; se graba tras una pausa o al perder el foco. */
  const onPointKeyUp = (e: ReactKeyboardEvent) => {
    if (!ARROWS[e.key]) return;
    e.stopPropagation();
    if (!nudged.current) return;
    if (nudgeTimer.current != null) window.clearTimeout(nudgeTimer.current);
    nudgeTimer.current = window.setTimeout(() => { nudgeTimer.current = null; commitNudge(); }, NUDGE_SAVE_MS);
  };

  const place = (p: RoutePoint, extra = '') => ({
    transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px) scale(${1 / zoom})${extra}`,
  });
  const swallow = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const onPointClick = (e: ReactMouseEvent, index: number) => {
    e.stopPropagation();
    if (e.detail <= 1) firstClickOn.current = index;
  };
  const onPointDoubleClick = (e: ReactMouseEvent, index: number) => {
    // Doble clic que empezó sobre el wire, antes de que existiera el tirador:
    // es del wire (abre su popup).
    if (firstClickOn.current !== index) return;
    firstClickOn.current = null;
    e.stopPropagation();
    commitNudge();
    onCommit(removePoint(via, index));
  };

  const adders = dragging != null || via.length >= MAX_ROUTE_POINTS
    ? []
    : segments
      ? handleSegments(segments, MIN_HANDLE_SEGMENT / zoom)
      : [{ x: center.x, y: center.y, insertAt: 0 }];

  return (
    <EdgeLabelRenderer>
      {adders.map((a) => (
        <button
          key={`add-${a.insertAt}-${a.x}-${a.y}`}
          type="button"
          className="wk-wire-add nodrag nopan nokey"
          style={place(a)}
          title="Drag to add a bend point"
          aria-label="Add a bend point — drag to place it"
          tabIndex={-1}
          onPointerDown={(e) => startDrag(e, a.insertAt, insertPoint(via, a.insertAt, a))}
          onClick={swallow}
          // El doble clic NO se detiene: burbujea hasta el wire y abre su popup
          // (este tirador suele quedar bajo el cursor de quien hace doble clic
          // sobre la etiqueta o sobre el centro del wire).
        />
      ))}
      {via.map((p, i) => (
        <button
          // Los puntos no tienen id: su identidad ES la posición en el trazo.
          key={`pt-${i}`}
          type="button"
          className={`wk-wire-pt nodrag nopan nokey${dragging === i ? ' on' : ''}`}
          style={place(p)}
          title="Drag to move · double-click to remove"
          aria-label={`Bend point ${i + 1} of ${via.length} — drag or use the arrow keys to move, Delete to remove`}
          onPointerDown={(e) => startDrag(e, i, via, true)}
          onClick={(e) => onPointClick(e, i)}
          onDoubleClick={(e) => onPointDoubleClick(e, i)}
          onKeyDown={(e) => onPointKey(e, i)}
          onKeyUp={onPointKeyUp}
          onBlur={commitNudge}
        />
      ))}
      {via.length > 0 && dragging == null && (
        <button
          type="button"
          className="wk-wire-reset nodrag nopan nokey"
          style={place(via[0], ' translate(18px, -18px)')}
          title="Reset to automatic route"
          aria-label="Reset to automatic route"
          onPointerDown={swallow}
          // Solo un clic simple (o el teclado): el segundo clic de un doble
          // clic sobre el wire sigue de largo y abre su popup.
          onClick={(e) => { if (e.detail > 1) return; e.stopPropagation(); commitNudge(); onCommit(null); }}
        >
          <RotateCcw size={11} strokeWidth={2.4} aria-hidden />
        </button>
      )}
    </EdgeLabelRenderer>
  );
}
