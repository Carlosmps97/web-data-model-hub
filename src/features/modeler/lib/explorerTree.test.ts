// Doc 71 §1: helpers puros del Explorer unificado.
import { describe, expect, it } from 'vitest';
import {
  canvasesWithTable, canvasesWithView, groupBySchema, matchesFilter, pickCanvas, projectTableIds, schemaSummary,
} from './explorerTree';

const CANV = [
  { id: 'a', name: 'Finanzas', tableIds: ['t1', 't2'], viewIds: ['v1'] },
  { id: 'b', name: 'Pricing', tableIds: ['t2', 't3'], viewIds: null },
  { id: 'c', name: 'Vacío', tableIds: [] },
];

describe('explorerTree', () => {
  it('projectTableIds: unión ordenada sin duplicados', () => {
    expect(projectTableIds(CANV)).toEqual(['t1', 't2', 't3']);
    expect(projectTableIds([])).toEqual([]);
  });

  it('canvasesWithTable / canvasesWithView', () => {
    expect(canvasesWithTable(CANV, 't2').map((c) => c.id)).toEqual(['a', 'b']);
    expect(canvasesWithView(CANV, 'v1', ['t3']).map((c) => c.id)).toEqual(['a']);          // membresía explícita manda
    expect(canvasesWithView(CANV, 'v9', ['t3']).map((c) => c.id)).toEqual(['b']);          // fallback por fuente
    expect(canvasesWithView(CANV, 'v9', ['t9'])).toEqual([]);
  });

  it('pickCanvas: activo > único > elegir (null) > ninguno (undefined)', () => {
    const two = CANV.slice(0, 2);
    expect(pickCanvas(two, 'b')?.id).toBe('b');
    expect(pickCanvas(two, 'zzz')).toBeNull();
    expect(pickCanvas([CANV[0]], null)?.id).toBe('a');
    expect(pickCanvas([], 'a')).toBeUndefined();
  });

  it('groupBySchema ordena esquemas e ítems, y agrupa los sin esquema', () => {
    const rows = [
      { schema: 'core', name: 'Z' }, { schema: 'Analytics', name: 'b' }, { schema: null, name: 'x' }, { schema: 'core', name: 'a' },
    ];
    const g = groupBySchema(rows, (r) => r.schema, (r) => r.name);
    expect(g.map((x) => x.schema)).toEqual(['(no schema)', 'Analytics', 'core']);
    expect(g[2].items.map((r) => r.name)).toEqual(['a', 'Z']);
  });

  it('matchesFilter / schemaSummary', () => {
    expect(matchesFilter('M_CLIENTE', 'cli')).toBe(true);
    expect(matchesFilter('M_CLIENTE', '')).toBe(true);
    expect(matchesFilter(undefined, 'x')).toBe(false);
    expect(schemaSummary([{ schema: 'core' }, { schema: 'core' }, { schema: null }], [{ schema: 'core_vu' }]))
      .toEqual([{ schema: '(no schema)', tables: 1, views: 0 }, { schema: 'core', tables: 2, views: 0 }, { schema: 'core_vu', tables: 0, views: 1 }]);
  });
});
