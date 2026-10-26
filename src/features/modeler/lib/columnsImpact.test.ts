// Impacto de borrar varias columnas de una tabla, armado con una sola lectura de
// sus links (todas sus relaciones en cualquier canvas, con nombres): una fila
// por relación con algún par de esas columnas, vista desde su lado, como la del
// diálogo de borrar una columna.
import { describe, expect, it } from 'vitest';
import type { TableLinkRow } from '@/services/governance.service';
import { columnsImpactFromLinks } from './columnsImpact';

type Pair = [parentId: string, parentName: string, childId: string, childName: string];
const link = (id: string, parent: [string, string], child: [string, string], pairs: Pair[],
  canvases: { id: string; name: string }[] = []): TableLinkRow => ({
  id, parentTableId: parent[0], parentTableName: parent[1], childTableId: child[0], childTableName: child[1],
  parentCardinality: 'one', childCardinality: 'many', identifying: false,
  pairs: pairs.map(([parentColumnId, parentColumnName, childColumnId, childColumnName]) =>
    ({ parentColumnId, parentColumnName, childColumnId, childColumnName })),
  canvases,
});
const R1 = link('r1', ['tP', 'P'], ['tH', 'H'], [['pa', 'PA', 'ha', 'HA'], ['pb', 'PB', 'hb', 'HB']], [{ id: 'sa1', name: 'Canvas 1' }]);
const R2 = link('r2', ['tQ', 'Q'], ['tP', 'P'], [['qa', 'QA', 'c1', 'C1']]);
const RA = link('rA', ['tP', 'P'], ['tP', 'P'], [['pa', 'PA', 'c2', 'C2']]);

describe('impacto de borrar varias columnas, desde los links de su tabla', () => {
  it('una de las columnas de una llave compuesta: la fila nombra solo la otra punta de ese par', () => {
    expect(columnsImpactFromLinks(['pb'], [R1])).toEqual({ total: 1, relationships: [{
      relId: 'r1', otherTableId: 'tH', otherTableName: 'H', otherColumnId: 'hb', otherColumnName: 'HB',
      thisSide: 'parent', parentCardinality: 'one', childCardinality: 'many', identifying: false,
      canvases: [{ id: 'sa1', name: 'Canvas 1' }],
    }] });
  });

  it('las dos columnas de la llave: una sola fila con las dos puntas', () => {
    const { relationships } = columnsImpactFromLinks(['pa', 'pb'], [R1]);
    expect(relationships.map((r) => [r.relId, r.otherColumnId, r.otherColumnName])).toEqual([['r1', 'ha', 'HA, HB']]);
  });

  it('una columna del lado hijo: la otra punta es el padre', () => {
    expect(columnsImpactFromLinks(['c1'], [R2]).relationships.map((r) => [r.thisSide, r.otherTableId, r.otherTableName, r.otherColumnName]))
      .toEqual([['child', 'tQ', 'Q', 'QA']]);
  });

  it('relación recursiva: la otra punta es la misma tabla', () => {
    expect(columnsImpactFromLinks(['pa'], [RA]).relationships.map((r) => [r.thisSide, r.otherTableId, r.otherColumnName]))
      .toEqual([['parent', 'tP', 'C2']]);
  });

  it('recursiva compuesta con una punta elegida de cada lado: cada par nombra su otra punta', () => {
    const RC = link('rC', ['tP', 'P'], ['tP', 'P'], [['a1', 'A1', 'c1', 'C1'], ['a2', 'A2', 'c2', 'C2']]);
    expect(columnsImpactFromLinks(['a1', 'c2'], [RC]).relationships[0].otherColumnName).toBe('C1, A2');
  });

  it('las relaciones sin pares de esas columnas no cuentan', () => {
    expect(columnsImpactFromLinks(['c9'], [R1, R2, RA])).toEqual({ relationships: [], total: 0 });
    expect(columnsImpactFromLinks(['pa', 'c1'], [R1, R2, RA]).total).toBe(3);
  });
});
