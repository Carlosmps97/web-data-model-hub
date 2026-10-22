// Lo que trajo la carga Excel (y lo último creado: tabla nueva, importada, CTAS o
// pegada) queda encima de lo que ya había en el canvas: `freshNodes` guarda por
// canvas las tandas de lo nuevo, de la más antigua a la más reciente (una tanda no
// sustituye a la anterior; si lo hiciera, lo de la carga quedaría empatado con lo
// existente). Es de la sesión: abrir otra versión (o cerrar sesión) la limpia.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/modeler/services/modeler.service', () => ({}));
import { FRESH_GENERATIONS, freshRanks, nodeZ } from '@/features/modeler/lib/nodeZ';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { resetAppState } from './resetAppState';

const st = () => useModelerStore.getState();

beforeEach(() => {
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useModelerStore.setState({ freshNodes: {} });
});

describe('freshNodes', () => {
  it('markFresh anota lo nuevo por canvas; cada llamada es una tanda encima de las anteriores', () => {
    st().markFresh({ sa1: ['t1', 'v1'], sa2: ['t2'] });
    st().markFresh({ sa1: ['t3', 't3'] });
    expect(st().freshNodes).toEqual({ sa1: [['t1', 'v1'], ['t3']], sa2: [['t2']] });
  });

  it('un bloque que vuelve a marcarse sube a la tanda más reciente (sale de la anterior)', () => {
    st().markFresh({ sa1: ['a', 'b'] });
    st().markFresh({ sa1: ['b'] });
    expect(st().freshNodes.sa1).toEqual([['a'], ['b']]);
    st().markFresh({ sa1: ['a'] });
    expect(st().freshNodes.sa1).toEqual([['b'], ['a']]);
  });

  it(`con más de ${FRESH_GENERATIONS} tandas se funden las más antiguas: lo de la sesión sigue encima de lo existente`, () => {
    for (let i = 0; i < FRESH_GENERATIONS + 2; i++) st().markFresh({ sa1: [`g${i}`] });
    expect(st().freshNodes.sa1).toHaveLength(FRESH_GENERATIONS);
    expect(st().freshNodes.sa1![0]).toEqual(['g0', 'g1', 'g2']);
    const r = freshRanks(st().freshNodes.sa1);
    expect(nodeZ('g0', null, r)).toBeGreaterThan(nodeZ('existente', null, r));
    expect(nodeZ(`g${FRESH_GENERATIONS + 1}`, null, r)).toBeGreaterThan(nodeZ('g0', null, r));
    expect(nodeZ(`g${FRESH_GENERATIONS + 1}`, null, r)).toBeLessThan(10);
  });

  it('con el orden de pintado del canvas: lo de la carga sigue sobre lo que ya había aunque después se cree otra tabla', () => {
    const z = (id: string, sel: string | null = null) => nodeZ(id, sel, freshRanks(st().freshNodes.sa1));
    st().markFresh({ sa1: ['g1'] });             // carga Excel
    st().markFresh({ sa1: ['g2'] });             // otra carga
    expect(z('g2')).toBeGreaterThan(z('g1'));
    st().markFresh({ sa1: ['nueva'] });          // lo que hace New table / Import / CTAS / pegar
    expect(z('nueva')).toBeGreaterThan(z('g2'));
    expect(z('g1')).toBeGreaterThan(z('existente'));
    expect(z('nueva', 'nueva')).toBe(10);
  });

  it('un canvas sin nada nuevo no se anota', () => {
    st().markFresh({ sa1: [] });
    expect(st().freshNodes).toEqual({});
  });

  it('abrir otra versión la limpia (es de la sesión)', () => {
    st().markFresh({ sa1: ['t1'] });
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    expect(st().freshNodes).toEqual({});
  });

  it('cerrar sesión la limpia', () => {
    // resetAppState barre el sessionStorage: en node no hay ventana.
    vi.stubGlobal('window', { sessionStorage: { length: 0, key: () => null, removeItem: () => {} } });
    try {
      st().markFresh({ sa1: ['t1'] });
      resetAppState();
      expect(st().freshNodes).toEqual({});
    } finally { vi.unstubAllGlobals(); }
  });
});
