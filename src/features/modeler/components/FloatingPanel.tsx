import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Doc 109 — panel flotante (selector de color, opciones de texto) anclado a un
 * botón o a un punto de la pantalla. Va por portal con `position: fixed` (el
 * toolbar y los paneles recortan lo absoluto — doc 52) y se acomoda para no
 * salirse de la ventana. Se cierra con un clic afuera, Esc o la rueda fuera
 * del panel. NO al perder la ventana el foco: el selector de color del sistema
 * (More colors…) abre su propia ventana y el panel tiene que seguir ahí.
 */
export interface FloatingPanelProps {
  /** Dónde abrir: el rectángulo del botón (abre debajo, o arriba si no entra)
   *  o un punto (abre a su derecha). */
  anchor: DOMRect | { x: number; y: number };
  onClose: () => void;
  children: ReactNode;
  /** Abrir a la izquierda del ancla si no entra a la derecha (flyout de menú). */
  side?: 'below' | 'right';
  /** El botón que lo abrió: su clic lo cierra él mismo (sin esto, el clic
   *  afuera lo cerraba y el mismo clic lo volvía a abrir). */
  owner?: Element | null;
  /** Doc 112: dentro de un diálogo, se dibuja AHÍ (sin portal) para que su
   *  trampa de Tab lo incluya; igual queda fijo encima (no agranda el diálogo). */
  inPlace?: boolean;
}

export default function FloatingPanel({ anchor, onClose, children, side = 'below', owner, inPlace }: FloatingPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left: number, top: number;
    if ('width' in anchor) {
      if (side === 'right') {
        left = anchor.right + 4 + w <= vw - 8 ? anchor.right + 4 : anchor.left - 4 - w;
        top = anchor.top - 6;
      } else {
        left = anchor.left;
        top = anchor.bottom + 6 + h <= vh - 8 ? anchor.bottom + 6 : anchor.top - 6 - h;
      }
    } else {
      left = anchor.x; top = anchor.y;
    }
    setPos({ left: Math.max(8, Math.min(left, vw - w - 8)), top: Math.max(8, Math.min(top, vh - h - 8)) });
  }, [anchor, side]);

  useEffect(() => {
    const inside = (e: Event) => !!ref.current && ref.current.contains(e.target as Node);
    const onDown = (e: Event) => { if (!inside(e) && !owner?.contains(e.target as Node)) onClose(); };
    const onWheel = (e: Event) => { if (!inside(e)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('wheel', onWheel, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, owner]);

  const panel = (
    <div ref={ref} className="wk-float nodrag nopan nowheel"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      onMouseDown={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
  return inPlace ? panel : createPortal(panel, document.body);
}
