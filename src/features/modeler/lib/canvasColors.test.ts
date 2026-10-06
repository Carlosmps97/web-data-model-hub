// Doc 112 — «Colors on this canvas» (ficha del canvas) y la línea del color en
// Properties: qué cajas pinta distinto ESTE canvas, de dónde sale el color que
// se ve en una caja, y a qué cajas se aplica «Paint on this canvas».
import { describe, expect, it } from 'vitest';
import { canvasBoxes, paintedHere, paintTargets, shownColor } from './canvasColors';

const diagram = {
  tables: [
    { id: 't1', physicalName: 'M_CUENTA', logicalName: 'Cuenta', color: 'theme:pri' },
    { id: 't2', physicalName: 'M_CLIENTE', logicalName: '', color: null },
    { id: 't3', physicalName: 'h_agencia', logicalName: 'agencia' },
  ],
  views: [{ id: 'v1', name: 'VW_CLIENTE', color: '#92D050' }],
} as never;

describe('canvasBoxes', () => {
  it('físico: tablas por su físico y también las vistas', () => {
    expect(canvasBoxes(diagram, 'physical')).toEqual([
      { id: 't1', kind: 'table', name: 'M_CUENTA', own: 'theme:pri' },
      { id: 't2', kind: 'table', name: 'M_CLIENTE', own: null },
      { id: 't3', kind: 'table', name: 'h_agencia', own: null },
      { id: 'v1', kind: 'view', name: 'VW_CLIENTE', own: '#92D050' },
    ]);
  });

  it('lógico: entidades por su lógico (o su físico si no tiene) y sin vistas (doc 63)', () => {
    expect(canvasBoxes(diagram, 'logical').map((b) => b.name)).toEqual(['Cuenta', 'M_CLIENTE', 'agencia']);
  });

  it('sin canvas abierto, ninguna', () => {
    expect(canvasBoxes(null, 'physical')).toEqual([]);
  });
});

describe('paintedHere', () => {
  it('sólo las cajas del canvas con excepción, ordenadas por nombre sin importar mayúsculas', () => {
    const boxes = canvasBoxes(diagram, 'physical');
    const rows = paintedHere(boxes, { t1: 'none', t3: '#FFC000', v1: 'theme:sec', gone: '#000000' });
    expect(rows.map((r) => [r.id, r.ref])).toEqual([['t3', '#FFC000'], ['t1', 'none'], ['v1', 'theme:sec']]);
  });

  it('una excepción inválida no cuenta', () => {
    expect(paintedHere(canvasBoxes(diagram, 'physical'), { t1: 'rojo' })).toEqual([]);
  });
});

describe('shownColor — lo que se ve en la caja y de dónde sale', () => {
  it('pintada en este canvas (también «sin color aquí») gana sobre el color de la tabla', () => {
    expect(shownColor('t1', 'theme:pri', { t1: '#FFC000' })).toEqual({ ref: '#FFC000', source: 'canvas' });
    expect(shownColor('t1', 'theme:pri', { t1: 'none' })).toEqual({ ref: 'none', source: 'canvas' });
  });

  it('sin excepción, el color de su tabla; sin ninguno, sin color', () => {
    expect(shownColor('t1', 'theme:pri', { t2: '#FFC000' })).toEqual({ ref: 'theme:pri', source: 'table' });
    expect(shownColor('t2', null, {})).toEqual({ ref: null, source: 'none' });
    expect(shownColor('t2', 'verde', { t2: 'rojo' })).toEqual({ ref: null, source: 'none' });
  });
});

describe('paintTargets — a qué cajas se aplica «Paint on this canvas»', () => {
  const visible = new Set(['t1', 't2', 'v1']);
  const node = (id: string, type: string, selected = true) => ({ id, type, selected });

  it('las tablas y vistas seleccionadas en el canvas (no los dibujos ni lo que no se ve)', () => {
    const nodes = [node('t1', 'table'), node('v1', 'view'), node('d1', 'shape'), node('t2', 'table', false), node('t9', 'table')];
    expect(paintTargets(nodes, ['t2'], visible)).toEqual(['t1', 'v1']);
  });

  it('sin selección en el canvas, la caja del panel Properties', () => {
    expect(paintTargets([node('t1', 'table', false)], ['t2', null], visible)).toEqual(['t2']);
    expect(paintTargets([], [null, 'v1'], visible)).toEqual(['v1']);
    expect(paintTargets([], ['t9'], visible)).toEqual([]);
  });
});
