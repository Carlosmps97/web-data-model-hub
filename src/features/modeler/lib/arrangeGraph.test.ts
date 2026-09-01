// Armado PURO del grafo del Autoarrange (doc 55 §3.5): tablas + vistas
// visibles como nodos (tamaño medido si existe, si no la estimación LOD),
// relaciones + derivaciones como edges. Lo comparten el botón Autoarrange
// (nodos medidos) y el arrange headless de la carga masiva (sin DOM).
import { describe, it, expect } from 'vitest';
import { buildArrangeGraph } from './arrangeGraph';
import type { Diagram } from '@/features/modeler/services/modeler.service';

const table = (id: string) => ({ id, physicalName: id.toUpperCase(), logicalName: id, schema: 'ddv' });
const column = (tableId: string, i: number) => ({
  id: `${tableId}.c${i}`, tableId, physicalName: `C${i}`, logicalName: `c ${i}`, dataType: 'STRING',
  typeOverridden: false, ordinal: i,
});

function diagram(): Diagram {
  return {
    subjectArea: { id: 'sa', projectId: 'p', name: 'D', tableIds: ['a', 'b'], layout: {} },
    tables: [table('a'), table('b')],
    columns: [column('a', 0), column('a', 1), column('a', 2), column('b', 0)],
    relationships: [{
      id: 'r1', parentTableId: 'a', childTableId: 'b',
      pairs: [{ parentColumnId: 'a.c0', childColumnId: 'b.c0' }],
      parentCardinality: 'one', childCardinality: 'zero-many', identifying: false,
    }],
    views: [
      { id: 'v1', name: 'V1', sourceTableIds: ['a'], showOnCanvas: true, sources: [{ column: 'C0' }] },
      { id: 'v9', name: 'V9', sourceTableIds: ['zzz'], showOnCanvas: true, sources: [] },
    ],
  } as unknown as Diagram;
}

describe('buildArrangeGraph', () => {
  it('sizes tables with the LOD estimate when nothing is measured', () => {
    const g = buildArrangeGraph(diagram(), () => undefined, 'physical');
    const a = g.nodes.find((n) => n.id === 'a')!;
    const b = g.nodes.find((n) => n.id === 'b')!;
    expect(a.height).toBe(32 + 3 * 28);
    expect(b.height).toBe(32 + 1 * 28);
    expect(a.width).toBeGreaterThanOrEqual(240);
  });

  it('prefers measured sizes when provided', () => {
    const g = buildArrangeGraph(diagram(), (id) => (id === 'a' ? { width: 500, height: 700 } : undefined), 'physical');
    expect(g.nodes.find((n) => n.id === 'a')).toEqual({ id: 'a', width: 500, height: 700 });
    expect(g.nodes.find((n) => n.id === 'b')!.height).toBe(60);
  });

  it('adds visible views as nodes with derivation edges and skips views without a source in the canvas', () => {
    const g = buildArrangeGraph(diagram(), () => undefined, 'physical');
    expect(g.nodes.map((n) => n.id)).toEqual(['a', 'b', 'v1']);
    expect(g.edges).toEqual([
      { id: 'r1', source: 'a', target: 'b' },
      { id: 'deriv__v1__a', source: 'a', target: 'v1' },
    ]);
    expect(g.viewIds).toEqual(['v1']);
  });

  it('leaves views OUT of the graph in logical mode (doc 63)', () => {
    const g = buildArrangeGraph(diagram(), () => undefined, 'logical');
    expect(g.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(g.edges).toEqual([{ id: 'r1', source: 'a', target: 'b' }]);
    expect(g.viewIds).toEqual([]);
  });
});
