// Símbolos crow's-foot (notación estándar) para los extremos de una relación.
// Cada extremo combina min (interior: barra=1, círculo=0) + max (en la tabla:
// barra=1, pata=muchos):
//   one        → Exactly one        ─┤
//   zero-one   → Zero or one        ─○┤
//   many       → One or more        ─┼<
//   zero-many  → Zero, one or more  ─○<
import type { ReactNode } from 'react';
import type { Cardinality } from '@/features/governance/services/governance.service';

const S = 'currentColor';

/** Un extremo crow's-foot, orientado hacia la "tabla" a la derecha (x=28). */
export function EndIcon({ cardinality, size = 16 }: { cardinality: Cardinality; size?: number }) {
  const many = cardinality === 'many' || cardinality === 'zero-many';
  const zero = cardinality === 'zero-one' || cardinality === 'zero-many';
  const els: ReactNode[] = [<line key="l" x1={2} y1={10} x2={28} y2={10} />];

  // max (en la tabla): pata de muchos, o barra de uno.
  if (many) {
    els.push(<line key="f1" x1={28} y1={10} x2={20} y2={4} />);
    els.push(<line key="f2" x1={28} y1={10} x2={20} y2={16} />);
    els.push(<line key="f3" x1={28} y1={10} x2={20} y2={10} />);
  } else {
    els.push(<line key="b" x1={24} y1={4} x2={24} y2={16} />);
  }

  // min (interior): círculo = 0, barra = 1 (sólo cuando aporta info: zero-* y many).
  if (zero) els.push(<circle key="c" cx={15} cy={10} r={2.8} fill="none" />);
  else if (many) els.push(<line key="bm" x1={15} y1={4} x2={15} y2={16} />);

  return (
    <svg
      width={(size * 30) / 20}
      height={size}
      viewBox="0 0 30 20"
      fill="none"
      stroke={S}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {els}
    </svg>
  );
}
