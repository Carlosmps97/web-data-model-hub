// «Colors on this canvas» (ficha del canvas) y la línea del color en
// Properties: qué cajas pinta distinto este canvas, de dónde sale el color que
// se ve en una caja, y a qué cajas se aplica «Paint on this canvas».
import { describe, expect, it } from 'vitest';
import { canvasBoxes, paintedHere, paintTargets, pendingChanges, shownColor, stage, withPending } from './canvasColors';

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

  it('lógico: entidades por su lógico (o su físico si no tiene) y sin vistas', () => {
    expect(canvasBoxes(diagram, 'logical').map((b) => b.name)).toEqual(['Cuenta', 'M_CLIENTE', 'agencia']);
  });

  it('sin canvas abierto, ninguna', () => {
    expect(canvasBoxes(null, 'physical')).toEqual([]);
  });
});

describe('paintedHere', () => {
  it('solo las cajas del canvas con excepción, ordenadas por nombre sin importar mayúsculas', () => {
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

describe('cambios pendientes de la ficha (Save graba, Cancel descarta)', () => {
  const canvas = { t1: 'theme:pri', t2: 'none' };

  it('withPending: los colores del canvas con lo pendiente encima (null = vuelve al de su tabla)', () => {
    expect(withPending(canvas, { t1: null, t3: '#FF0000' })).toEqual({ t2: 'none', t3: '#FF0000' });
    expect(withPending(canvas, {})).toEqual(canvas);
  });

  it('pendingChanges: solo lo que de verdad cambia respecto de lo grabado', () => {
    expect(pendingChanges(canvas, { t1: 'theme:pri', t2: null, t3: null, t4: '#00B050' })).toEqual({ t2: null, t4: '#00B050' });
    expect(pendingChanges(canvas, {})).toEqual({});
  });

  it('stage: pinta o vuelve al color de su tabla varias cajas a la vez', () => {
    expect(stage({ t1: '#000000' }, ['t2', 't3'], 'theme:sec')).toEqual({ t1: '#000000', t2: 'theme:sec', t3: 'theme:sec' });
    expect(stage({ t1: '#000000' }, ['t1'], null)).toEqual({ t1: null });
  });
});
