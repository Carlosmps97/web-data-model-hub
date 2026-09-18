// Doc 61: helpers puros del panel de Properties de vista.
import { describe, expect, it } from 'vitest';
import { moveSource, syncViewTypeUdp } from './viewPanelLogic';
import type { ViewSource } from '@/services/views.service';

const srcs: ViewSource[] = [
  { column: 'A', tableId: 't1' },
  { column: 'B', tableId: 't1' },
  { column: 'C', tableId: 't2' },
];

describe('moveSource', () => {
  it('mueve hacia adelante y hacia atrás (índices post-remoción)', () => {
    expect(moveSource(srcs, 0, 2).map((s) => s.column)).toEqual(['B', 'C', 'A']);
    expect(moveSource(srcs, 2, 0).map((s) => s.column)).toEqual(['C', 'A', 'B']);
  });
  it('clampa fuera de rango y no muta el original', () => {
    const out = moveSource(srcs, 1, 99);
    expect(out.map((s) => s.column)).toEqual(['A', 'C', 'B']);
    expect(srcs.map((s) => s.column)).toEqual(['A', 'B', 'C']);
    expect(moveSource(srcs, -1, 0).map((s) => s.column)).toEqual(['A', 'B', 'C']);
  });
});

describe('syncViewTypeUdp', () => {
  it('setea Personalizada/Regular en la key del def', () => {
    expect(syncViewTypeUdp({ x: '1' }, 'vt', true)).toEqual({ x: '1', vt: 'Personalizada' });
    expect(syncViewTypeUdp(undefined, 'vt', false)).toEqual({ vt: 'Regular' });
  });
  it('sin def sembrado devuelve los valores tal cual', () => {
    const vals = { x: '1' };
    expect(syncViewTypeUdp(vals, null, true)).toBe(vals);
    expect(syncViewTypeUdp(undefined, undefined, true)).toBeUndefined();
  });
});
