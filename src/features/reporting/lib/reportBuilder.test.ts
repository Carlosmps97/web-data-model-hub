// Report Designer → Builder: piezas puras (doc 105, revisión ronda 4).
import { describe, expect, it } from 'vitest';
import type { FieldDef, ReportSpec, ResultColumn } from '../query.service';
import { betweenPart, cellText, conditionDefaultValue, regroup, toBuilderSpec, withoutUnsortableOrder } from './reportBuilder';

const spec = (over: Partial<ReportSpec> = {}): ReportSpec => ({
  projectId: 'p1', from: 'columns', select: ['physicalName'], groupBy: [], aggregations: [], orderBy: [], limit: 100,
  where: { op: 'and', conditions: [] }, ...over,
});
const field = (over: Partial<FieldDef>): FieldDef => ({
  key: 'x', label: 'X', type: 'string', ops: ['eq'], sortable: true, groupable: true, indexed: false,
  enumValues: null, udp: false, hydrated: false, ...over,
});

describe('«Validate → builder» / abrir un reporte en el Builder', () => {
  it('sin el tope TOTAL del LIMIT (el Builder no lo muestra ni lo deja quitar) y con la página de siempre', () => {
    const validated = spec({ from: 'tables', select: ['physicalName', 'schema'], limit: 3, maxRows: 3, orderBy: [{ field: 'physicalName', dir: 'asc' }] });
    const out = toBuilderSpec(validated, 'p9');
    expect(out).toEqual({ ...validated, projectId: 'p9', limit: 100, maxRows: undefined });
    expect('maxRows' in out).toBe(false);                     // ni siquiera viaja como clave
  });

  it('sin el orden de columnas del SQL (`resultColumns`): con otro agrupado desde el Builder daría 422 (doc 105, ronda 5)', () => {
    const validated = spec({ groupBy: ['dataType'], aggregations: [{ fn: 'count', as: 'n' }], resultColumns: ['n', 'dataType'] });
    const out = toBuilderSpec(validated, 'p1');
    expect('resultColumns' in out).toBe(false);
  });
});

describe('agrupar / desagrupar', () => {
  it('al agrupar se quita el orden por fila que el agrupado ignora (antes: aviso en cada Run, sin forma de quitarlo)', () => {
    const out = regroup(spec({ orderBy: [{ field: 'physicalName', dir: 'desc' }] }), 'dataType');
    expect(out).toMatchObject({ groupBy: ['dataType'], aggregations: [{ fn: 'count', as: 'count' }], orderBy: [] });
  });
  it('se conserva un orden válido en el agrupado (campo agrupado o el conteo)', () => {
    expect(regroup(spec({ orderBy: [{ field: 'dataType', dir: 'asc' }] }), 'dataType').orderBy).toEqual([{ field: 'dataType', dir: 'asc' }]);
    expect(regroup(spec({ groupBy: ['schema'], aggregations: [{ fn: 'count', as: 'count' }], orderBy: [{ field: 'count', dir: 'desc' }] }), 'dataType').orderBy)
      .toEqual([{ field: 'count', dir: 'desc' }]);
  });
  it('al desagrupar del todo, se van el conteo y su orden', () => {
    const out = regroup(spec({ groupBy: ['dataType'], aggregations: [{ fn: 'count', as: 'count' }], orderBy: [{ field: 'count', dir: 'desc' }] }), 'dataType');
    expect(out).toMatchObject({ groupBy: [], aggregations: [], orderBy: [] });
  });
});

describe('filtros', () => {
  it('una condición booleana nace con el valor que muestra el combo (true); sin valor filtraba `null`', () => {
    expect(conditionDefaultValue(field({ type: 'boolean', ops: ['eq', 'ne', 'exists'] }), 'eq')).toBe(true);
    expect(conditionDefaultValue(field({ type: 'boolean' }), 'exists')).toBeUndefined();   // «is set» no lleva valor
    expect(conditionDefaultValue(field({ type: 'string' }), 'eq')).toBeUndefined();
    expect(conditionDefaultValue(undefined, 'eq')).toBeUndefined();
  });
  it('between arma [desde, hasta] con dos entradas', () => {
    expect(betweenPart(undefined, 0, '10')).toEqual(['10', '']);
    expect(betweenPart(['10', ''], 1, '20')).toEqual(['10', '20']);
    expect(betweenPart('5', 1, '9')).toEqual(['', '9']);             // un valor suelto de antes no es un rango
  });
});

describe('celdas', () => {
  const bool: ResultColumn = { key: 'b', label: 'B', type: 'boolean' };
  const num: ResultColumn = { key: 'n', label: 'N', type: 'number' };
  it('un booleano «false» (UDP guardado como texto) no se pinta como ✓', () => {
    expect(cellText('false', bool)).toBe('·');
    expect(cellText('False', bool)).toBe('·');
    expect(cellText('true', bool)).toBe('✓');
    expect(cellText(true, bool)).toBe('✓');
    expect(cellText(false, bool)).toBe('·');
    expect(cellText('Sí', bool)).toBe('Sí');                          // otro texto: tal cual
    expect(cellText(null, bool)).toBe('—');
    expect(cellText(0, num)).toBe('0');
  });
});

// Doc 105 (rondas 6–7): un orden por un campo sin índice da 422 en consultas de
// FILAS (reportes guardados antes de que la grilla sólo ofreciera los
// ordenables). `view_columns` ordena por cualquier campo y un agregado no se
// ordena por índice: esos quedan como están.
describe('withoutUnsortableOrder', () => {
  const CAT = [field({ key: 'physicalName', sortable: true }), field({ key: 'logicalName', sortable: false })];
  const ord = (f: string) => ({ field: f, dir: 'asc' as const });

  it('quita de una consulta de filas el orden por un campo no ordenable', () => {
    const out = withoutUnsortableOrder(spec({ orderBy: [ord('logicalName'), ord('physicalName')] }), CAT);
    expect(out.removed).toEqual(['logicalName']);
    expect(out.spec.orderBy).toEqual([ord('physicalName')]);
  });

  it('no toca view_columns, un agrupado ni un agregado sin GROUP BY, ni si el catálogo no llegó', () => {
    for (const s0 of [
      spec({ from: 'view_columns', orderBy: [ord('sourceColumn')] }),
      spec({ groupBy: ['dataType'], orderBy: [ord('dataType')] }),
      spec({ aggregations: [{ fn: 'count', as: 'total' }], orderBy: [ord('total')] }),
    ]) {
      expect(withoutUnsortableOrder(s0, CAT)).toEqual({ spec: s0, removed: [] });
    }
    const rows = spec({ orderBy: [ord('logicalName')] });
    expect(withoutUnsortableOrder(rows, [])).toEqual({ spec: rows, removed: [] });
  });
});
