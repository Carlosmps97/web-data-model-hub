// Orden de pintado de los bloques del canvas: el seleccionado al frente (10);
// lo nuevo de esta sesión por delante de lo que ya había, cada tanda (carga
// Excel, tabla nueva, importada, CTAS, pegada) encima de las anteriores (1 + su
// rango); el resto, 0. Los dibujos van detrás (−1, aparte).
import { describe, expect, it } from 'vitest';
import { FRESH_GENERATIONS, freshRanks, nodeZ } from './nodeZ';

describe('nodeZ', () => {
  const ranks = freshRanks([['n1', 'v1'], ['n2']]);

  it('seleccionado > lo nuevo, por tanda (la última encima) > el resto', () => {
    expect(nodeZ('t1', 't1', ranks)).toBe(10);
    expect(nodeZ('n1', null, ranks)).toBe(1);
    expect(nodeZ('v1', null, ranks)).toBe(1);
    expect(nodeZ('n2', null, ranks)).toBe(2);
    expect(nodeZ('n1', 'n1', ranks)).toBe(10);
    expect(nodeZ('t2', 't1', ranks)).toBe(0);
    expect(nodeZ('t2', null, undefined)).toBe(0);
  });

  it('con todas las tandas que se guardan, lo nuevo sigue debajo del seleccionado', () => {
    const gens = Array.from({ length: FRESH_GENERATIONS }, (_, i) => [`g${i}`]);
    const r = freshRanks(gens);
    expect(nodeZ(`g${FRESH_GENERATIONS - 1}`, null, r)).toBeLessThan(10);
    expect(nodeZ('g0', null, r)).toBeGreaterThan(nodeZ('viejo', null, r));
  });
});
