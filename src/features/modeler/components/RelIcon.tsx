// Símbolos crow's-foot (notación estándar) para los extremos de una relación.
// Misma geometría que CrowFootMarkers (doc 19): la pata ABRE hacia la tabla
// (vértice del lado de la línea); min (interior: círculo=0, barra=1) + max
// (contra la tabla: barra=1, pata=muchos):
//   one        → Exactly one          ──┤
//   one-only   → One and only one     ──╫
//   zero-one   → Zero or one          ─○┤
//   many       → Many                 ──<
//   one-many   → One or more          ─┼<
//   zero-many  → Zero or many         ─○<
import type { ReactNode } from 'react';
import type { Cardinality } from '@/services/governance.service';

const S = 'currentColor';

/** Un extremo crow's-foot, orientado hacia la "tabla" a la derecha (x=28). */
export function EndIcon({ cardinality, size = 16 }: { cardinality: Cardinality; size?: number }) {
  const many = cardinality === 'many' || cardinality === 'one-many' || cardinality === 'zero-many';
  const zero = cardinality === 'zero-one' || cardinality === 'zero-many';
  const els: ReactNode[] = [<line key="l" x1={2} y1={10} x2={28} y2={10} />];

  if (many) {
    // pata: vértice en la línea, puntas tocando la tabla (x=28).
    els.push(<line key="f1" x1={19} y1={10} x2={28} y2={4} />);
    els.push(<line key="f2" x1={19} y1={10} x2={28} y2={16} />);
    els.push(<line key="f3" x1={19} y1={10} x2={28} y2={10} />);
    if (cardinality === 'one-many') els.push(<line key="bm" x1={15} y1={4} x2={15} y2={16} />);
  } else {
    els.push(<line key="b" x1={23} y1={4} x2={23} y2={16} />);
    if (cardinality === 'one-only') els.push(<line key="b2" x1={19} y1={4} x2={19} y2={16} />);
  }
  if (zero) els.push(<circle key="c" cx={10} cy={10} r={2.8} fill="none" />);

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

/** Ícono de las herramientas de dibujo del toolbar: wire sólido (identifying)
 *  o punteado (non-identifying), como las líneas reales del canvas. */
export function RelLineIcon({ dashed = false, size = 17 }: { dashed?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" aria-hidden>
      <path d="M2 14 C 7 14, 11 4, 16 4" strokeDasharray={dashed ? '3.2 2.6' : undefined} />
    </svg>
  );
}

/** Ícono de la herramienta SUBCATEGORÍA (doc 53): línea del supertipo, ROMBO
 *  con barra discriminadora (rediseño 2026-08-23) y patas a los subtipos. */
export function SubcatIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor"
      strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="9" y1="1.2" x2="9" y2="3.2" />
      <path d="M9 3.2 L14.2 8.4 L9 13.6 L3.8 8.4 Z" />
      <line x1="6.4" y1="8.4" x2="11.6" y2="8.4" />
      <line x1="9" y1="13.6" x2="3.6" y2="17" />
      <line x1="9" y1="13.6" x2="14.4" y2="17" />
    </svg>
  );
}
