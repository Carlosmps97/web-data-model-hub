// Iconos ER (crow's-foot) para los presets de relación. Línea horizontal con el
// símbolo de cardinalidad en cada extremo. kind: tipo de preset.
import type { ReactNode } from 'react';

export type RelKind = '1:N' | '1:1' | '0:N' | 'N:M' | 'ID';

const S = 'currentColor';

function endGlyph(side: 'l' | 'r', kind: 'one' | 'many' | 'zero-one' | 'zero-many') {
  const x = side === 'l' ? 2 : 22;     // extremo
  const dir = side === 'l' ? 1 : -1;   // hacia adentro
  const many = kind === 'many' || kind === 'zero-many';
  const zero = kind === 'zero-one' || kind === 'zero-many';
  const els: ReactNode[] = [];
  // "uno" (barra) o base de la pata
  const bx = x + dir * 5;
  if (!many) els.push(<line key="o" x1={bx} y1={4} x2={bx} y2={12} stroke={S} strokeWidth={1.4} />);
  if (many) {
    els.push(<line key="m1" x1={x} y1={8} x2={bx} y2={3} stroke={S} strokeWidth={1.4} />);
    els.push(<line key="m2" x1={x} y1={8} x2={bx} y2={13} stroke={S} strokeWidth={1.4} />);
    els.push(<line key="m3" x1={x} y1={8} x2={bx} y2={8} stroke={S} strokeWidth={1.4} />);
  }
  if (zero) els.push(<circle key="z" cx={x + dir * 9} cy={8} r={2.4} fill="none" stroke={S} strokeWidth={1.2} />);
  return <g>{els}</g>;
}

export default function RelIcon({ kind, size = 16 }: { kind: RelKind; size?: number }) {
  // mapeo preset → (origen, destino)
  const map: Record<RelKind, ['one' | 'many' | 'zero-one' | 'zero-many', 'one' | 'many' | 'zero-one' | 'zero-many', boolean]> = {
    '1:N': ['one', 'many', false],
    '1:1': ['one', 'one', false],
    '0:N': ['zero-one', 'zero-many', false],
    'N:M': ['many', 'many', false],
    'ID': ['one', 'many', true],
  };
  const [src, tgt, ident] = map[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 24 16" fill="none" aria-hidden>
      <line x1={4} y1={8} x2={20} y2={8} stroke={S} strokeWidth={1.4} strokeDasharray={ident ? undefined : '3 2'} />
      {endGlyph('l', src)}
      {endGlyph('r', tgt)}
    </svg>
  );
}
