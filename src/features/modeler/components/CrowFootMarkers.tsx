import type { ReactNode } from 'react';

// Marcadores crow's-foot (notación ER estándar). Se referencian como
// url(#cf-<card>) en markerStart/markerEnd del edge. orient="auto-start-reverse"
// los rota según la dirección de la línea.
//
// GEOMETRÍA (doc 19): la "pata de muchos" ABRE hacia la tabla — el vértice
// queda del lado de la línea (x=12) y las puntas TOCAN el borde del nodo
// (x=20). La versión anterior estaba invertida (vértice pegado a la tabla),
// por eso los símbolos se leían como flechas.
const STROKE = 'var(--ink-2)';

// viewBox 0..20 x 0..20; la línea llega desde x=0; el nodo está hacia x=20.
// min (interior, hacia la línea): círculo=0 / barra=1 · max (contra el nodo):
// pata=muchos / barra=uno.
function marker(card: string): ReactNode {
  const many = card === 'many' || card === 'one-many' || card === 'zero-many';
  const zero = card === 'zero-one' || card === 'zero-many';
  const dbl = card === 'one-only';
  const els: ReactNode[] = [];
  if (many) {
    els.push(<line key="m1" x1={11} y1={10} x2={20} y2={4} stroke={STROKE} strokeWidth={1.5} />);
    els.push(<line key="m2" x1={11} y1={10} x2={20} y2={16} stroke={STROKE} strokeWidth={1.5} />);
    els.push(<line key="m3" x1={11} y1={10} x2={20} y2={10} stroke={STROKE} strokeWidth={1.5} />);
    // min: barra "al menos uno" (one-many) — el círculo "cero" va aparte abajo.
    if (card === 'one-many') els.push(<line key="bm" x1={8} y1={5} x2={8} y2={15} stroke={STROKE} strokeWidth={1.5} />);
  } else {
    // barra "uno" perpendicular cerca del nodo; one-only lleva doble barra.
    els.push(<line key="o" x1={13.5} y1={5} x2={13.5} y2={15} stroke={STROKE} strokeWidth={1.5} />);
    if (dbl) els.push(<line key="o2" x1={10.5} y1={5} x2={10.5} y2={15} stroke={STROKE} strokeWidth={1.5} />);
  }
  if (zero) els.push(<circle key="z" cx={5.5} cy={10} r={3} fill="var(--surface)" stroke={STROKE} strokeWidth={1.4} />);
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
