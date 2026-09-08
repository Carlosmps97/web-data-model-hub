import { describe, expect, it } from 'vitest';
import { planCanvasDrop } from './canvasDrop';

// orden: k1(0) k2(1) a(2) b(3) c(4) · llave: k2 (pos 0), k1 (pos 1)
const col = (id: string, ordinal: number, pk = false, pkPosition: number | null = null) =>
  ({ id, ordinal, isPrimaryKey: pk, pkPosition });
const COLS = [col('k1', 0, true, 1), col('k2', 1, true, 0), col('a', 2), col('b', 3), col('c', 4)];

describe('planCanvasDrop (doc 73 §10.4 · doc 74)', () => {
  it('entre filas no-llave: reordena las columnas', () => {
    const plan = planCanvasDrop(COLS, 'c', { kind: 'row', id: 'a', after: false });
    expect(plan.order).toEqual(['k1', 'k2', 'c', 'a', 'b']);
    expect(plan.key).toEqual([]);
  });
  it('sin cambio efectivo → nada', () => {
    expect(planCanvasDrop(COLS, 'b', { kind: 'row', id: 'a', after: true })).toEqual({ order: null, key: [] });
    expect(planCanvasDrop(COLS, 'b', { kind: 'row', id: 'b', after: true })).toEqual({ order: null, key: [] });
    expect(planCanvasDrop(COLS, 'zz', { kind: 'pkzone' })).toEqual({ order: null, key: [] });
  });
  it('soltar en la zona de llave: entra al FINAL de la llave, el orden no se toca', () => {
    const plan = planCanvasDrop(COLS, 'b', { kind: 'pkzone' });
    expect(plan).toEqual({ order: null, key: [{ id: 'b', isPrimaryKey: true, pkPosition: 2 }] });
    expect(planCanvasDrop(COLS, 'k1', { kind: 'pkzone' }).key).toEqual([]);   // ya es PK
  });
  it('soltar sobre una PK: entra en esa posición de la llave y renumera las demás', () => {
    const plan = planCanvasDrop(COLS, 'a', { kind: 'row', id: 'k2', after: false });
    expect(plan.order).toBeNull();
    expect(plan.key).toEqual([
      { id: 'a', isPrimaryKey: true, pkPosition: 0 },
      { id: 'k2', isPrimaryKey: true, pkPosition: 1 },
      { id: 'k1', isPrimaryKey: true, pkPosition: 2 },
    ]);
  });
  it('PK sobre otra PK: reordena la llave (k1 antes de k2)', () => {
    const plan = planCanvasDrop(COLS, 'k1', { kind: 'row', id: 'k2', after: false });
    expect(plan.key).toEqual([{ id: 'k1', isPrimaryKey: true, pkPosition: 0 }, { id: 'k2', isPrimaryKey: true, pkPosition: 1 }]);
  });
  it('PK arrastrada a la lista: sale de la llave, renumera y se ubica donde cayó', () => {
    const plan = planCanvasDrop(COLS, 'k2', { kind: 'row', id: 'b', after: true });
    expect(plan.order).toEqual(['k1', 'a', 'b', 'k2', 'c']);
    expect(plan.key).toEqual([{ id: 'k1', isPrimaryKey: true, pkPosition: 0 }, { id: 'k2', isPrimaryKey: false, pkPosition: null }]);
  });
});
