import type { ReactNode } from 'react';

// Marcadores crow's-foot (notación ER). Se referencian como url(#cf-<card>) en
// markerStart/markerEnd del edge. orient="auto" los rota según la dirección de la línea.
const STROKE = 'var(--ink-2)';

// viewBox 0..20 x 0..20; la línea llega desde x=0; el nodo está hacia x=20.
// Barra "uno" hacia x=13; pata de gallo abriendo hacia el nodo (x=20); círculo "cero" hacia afuera.
function marker(card: string): ReactNode {
  const many = card === 'many' || card === 'one-many' || card === 'zero-many';
  const zero = card === 'zero-one' || card === 'zero-many';
  const dbl = card === 'one-only';
  const one = card === 'one' || card === 'one-only' || card === 'one-many';
  const els: ReactNode[] = [];
  if (one) els.push(<line key="o" x1={13} y1={5} x2={13} y2={15} stroke={STROKE} strokeWidth={1.5} />);
  if (dbl) els.push(<line key="o2" x1={10} y1={5} x2={10} y2={15} stroke={STROKE} strokeWidth={1.5} />);
  if (many) {
    els.push(<line key="m1" x1={20} y1={10} x2={12} y2={4} stroke={STROKE} strokeWidth={1.5} />);
    els.push(<line key="m2" x1={20} y1={10} x2={12} y2={16} stroke={STROKE} strokeWidth={1.5} />);
    els.push(<line key="m3" x1={20} y1={10} x2={12} y2={10} stroke={STROKE} strokeWidth={1.5} />);
  }
  if (zero) els.push(<circle key="z" cx={6} cy={10} r={3} fill="var(--surface)" stroke={STROKE} strokeWidth={1.4} />);
  return <g>{els}</g>;
}

const CARDS = ['one', 'many', 'one-only', 'zero-one', 'one-many', 'zero-many'];

export default function CrowFootMarkers() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
      <defs>
        {CARDS.map((c) => (
          <marker key={c} id={`cf-${c}`} markerWidth={22} markerHeight={20} refX={20} refY={10}
            orient="auto-start-reverse" markerUnits="userSpaceOnUse">
            {marker(c)}
          </marker>
        ))}
      </defs>
    </svg>
  );
}
