import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { placeBeside, placeNextTo, type RectLike } from '@/lib/floating';
import { useFloating } from './useFloating';

/** `side`: dónde prefiere aparecer (debajo por defecto; doc 114: a la derecha en
 *  los menús de lista de la barra, para no tapar la herramienta de abajo). */
export default function Tooltip({ label, children, side }: { label: string; children: ReactNode; side?: 'bottom' | 'right' }) {
  const [anchor, setAnchor] = useState<RectLike | null>(null);
  return (
    <span
      style={{ display: 'inline-flex' }}
      onMouseEnter={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setAnchor(null)}
    >
      {children}
      {anchor && label && createPortal(<Bubble anchor={anchor} label={label} side={side ?? 'bottom'} />, document.body)}
    </span>
  );
}

/** Doc 113 §5: debajo y centrado en el botón; arriba si abajo no entra, y
 *  corrido para no salirse por los costados (antes se cortaba a la izquierda,
 *  p. ej. en «Logical» o «Model properties»). Un texto largo envuelve. */
function Bubble({ anchor, label, side }: { anchor: RectLike; label: string; side: 'bottom' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  // Revisión 2 doc 114: al costado sin lugar en ninguno, abajo (corrido, tapaba su botón).
  const place = useFloating(ref, (box, bounds) => (side === 'right' ? placeBeside : placeNextTo)(anchor, box, bounds, { side, align: 'center', gap: 6 }), [anchor, label, side]);
  return (
    <div ref={ref} role="tooltip" style={{
      ...place,
      // `100%` de un fixed = la ventana SIN la barra de scroll (100vw la incluye).
      width: 'max-content', maxWidth: 'min(420px, calc(100% - 16px))', whiteSpace: 'normal',
      background: 'var(--ink)', color: 'var(--inverse)', fontSize: 11, fontWeight: 600,
      padding: '4px 8px', borderRadius: 6, pointerEvents: 'none',
      zIndex: 1000, boxShadow: 'var(--shadow-md)',
    }}>{label}</div>
  );
}
