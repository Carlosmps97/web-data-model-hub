import { describe, expect, it } from 'vitest';
import { planCanvasDrop } from './canvasDrop';

// Un solo orden (PK primero, cada bloque por ordinal).
// orden: k1(0) k2(1) · a(2) b(3) c(4)
const col = (id: string, ordinal: number, pk = false) => ({ id, ordinal, isPrimaryKey: pk });
const COLS = [col('k1', 0, true), col('k2', 1, true), col('a', 2), col('b', 3), col('c', 4)];

describe('planCanvasDrop', () => {
  it('entre filas no-llave: reordena las columnas', () => {
    const plan = planCanvasDrop(COLS, 'c', { kind: 'row', id: 'a', after: false });
    expect(plan.order).toEqual(['k1', 'k2', 'c', 'a', 'b']);
    expect(plan.key).toEqual([]);
  });
  it('sin cambio efectivo → nada', () => {
    expect(planCanvasDrop(COLS, 'b', { kind: 'row', id: 'a', after: true })).toEqual({ order: null, key: [] });
    expect(planCanvasDrop(COLS, 'b', { kind: 'row', id: 'b', after: true })).toEqual({ order: null, key: [] });
    expect(planCanvasDrop(COLS, 'k1', { kind: 'row', id: 'k2', after: false })).toEqual({ order: null, key: [] });
    expect(planCanvasDrop(COLS, 'zz', { kind: 'pkzone' })).toEqual({ order: null, key: [] });
  });
  it('soltar en la zona de llave: entra a la llave y queda al final del bloque de PK', () => {
    const plan = planCanvasDrop(COLS, 'b', { kind: 'pkzone' });
    expect(plan).toEqual({ order: ['k1', 'k2', 'b', 'a', 'c'], key: [{ id: 'b', isPrimaryKey: true }] });
    expect(planCanvasDrop(COLS, 'k1', { kind: 'pkzone' })).toEqual({ order: null, key: [] });   // ya es PK
  });
  it('soltar sobre una PK: entra a la llave en esa posición del bloque', () => {
    const plan = planCanvasDrop(COLS, 'a', { kind: 'row', id: 'k2', after: false });
    expect(plan).toEqual({ order: ['k1', 'a', 'k2', 'b', 'c'], key: [{ id: 'a', isPrimaryKey: true }] });
  });
  it('PK sobre otra PK: reordena dentro del bloque (orden normal, sin orden de llave aparte)', () => {
    const plan = planCanvasDrop(COLS, 'k2', { kind: 'row', id: 'k1', after: false });
    expect(plan).toEqual({ order: ['k2', 'k1', 'a', 'b', 'c'], key: [] });
  });
  it('PK arrastrada a la lista: sale de la llave y se ubica donde cayó (nunca queda una PK debajo de una no-PK)', () => {
    const plan = planCanvasDrop(COLS, 'k2', { kind: 'row', id: 'b', after: true });
    expect(plan).toEqual({ order: ['k1', 'a', 'b', 'k2', 'c'], key: [{ id: 'k2', isPrimaryKey: false }] });
  });
  it('datos con ordinal desordenado: el plan sale PK primero', () => {
    const legacy = [col('a', 0), col('k', 1, true), col('b', 2)];
    expect(planCanvasDrop(legacy, 'b', { kind: 'row', id: 'a', after: false }).order).toEqual(['k', 'b', 'a']);
  });
});
