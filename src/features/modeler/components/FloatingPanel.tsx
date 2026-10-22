import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { placeAtPoint, placeNextTo } from '@/lib/floating';
import { useFloating } from '@/components/ui/useFloating';

/**
 * Panel flotante (selector de color, opciones de texto) anclado a un botón o a
 * un punto de la pantalla. Va por portal con `position: fixed` (el toolbar y
 * los paneles recortan lo absoluto) y se acomoda para no salirse de la ventana
 * con la regla única de flotantes (flip, corrimiento y alto máximo). Se cierra
 * con un clic afuera, Esc o la rueda fuera del panel. No se cierra al perder la
 * ventana el foco: el selector de color del sistema (More colors…) abre su
 * propia ventana y el panel tiene que seguir ahí.
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
   *  afuera lo cerraría y el mismo clic lo volvería a abrir). */
  owner?: Element | null;
  /** Dentro de un diálogo se dibuja ahí (sin portal) para que su
   *  trampa de Tab lo incluya; igual queda fijo encima (no agranda el diálogo). */
  inPlace?: boolean;
}

export default function FloatingPanel({ anchor, onClose, children, side = 'below', owner, inPlace }: FloatingPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const place = useFloating(ref, (box, bounds) => {
    if (!('width' in anchor)) return placeAtPoint(anchor, box, bounds);
    // Flyout de menú: a la derecha del ítem (a su izquierda si no entra), 6 px más arriba.
    if (side === 'right') {
      const item = { left: anchor.left, right: anchor.right, top: anchor.top - 6, bottom: anchor.bottom - 6 };
      return placeNextTo(item, box, bounds, { side: 'right', align: 'start', gap: 4 });
    }
    return placeNextTo(anchor, box, bounds, { side: 'bottom', align: 'start', gap: 6 });
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
      style={place}
      onMouseDown={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
  return inPlace ? panel : createPortal(panel, document.body);
}
