// Cuadro de selección del canvas (doc 134 §3.2): lo calcula la app con la caja de
// cada tabla (la medida o, sin dibujar, la estimada): solo tablas completamente
// dentro. El gesto empieza recién pasados unos píxeles (menos es un clic en el
// fondo) y, al soltar, avisa para atajar el clic que el navegador manda después.
import { describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import { BOX_DRAG_PX, applySelection, createBoxGesture, selectedTables, tablesInBox, toggleGroup } from './boxSelect';

const node = (id: string, type: string, x: number, y: number, size?: { width: number; height: number }, extra: Partial<Node> = {}): Node =>
  ({ id, type, position: { x, y }, data: {}, ...(size ? { measured: size } : {}), ...extra });
/** La caja medida, o 300×200 si el nodo no se dibujó todavía. */
const boxOf = (n: Node) => ({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? 300, h: n.measured?.height ?? 200 });
const BOX = { x: 0, y: 0, w: 200, h: 200 };

describe('tablesInBox', () => {
  it('toma la tabla completamente dentro y no la que sale por un borde', () => {
    const nodes = [node('a', 'table', 10, 10, { width: 100, height: 80 }), node('b', 'table', 150, 10, { width: 100, height: 80 })];
    expect(tablesInBox(nodes, BOX, boxOf)).toEqual(['a']);
  });
  it('nunca vistas, dibujos ni el símbolo de subcategoría', () => {
    const nodes = [node('v', 'view', 10, 10, { width: 50, height: 50 }), node('s', 'shape', 10, 10, { width: 50, height: 50 }),
      node('x', 'subcat', 10, 10, { width: 20, height: 20 })];
    expect(tablesInBox(nodes, BOX, boxOf)).toEqual([]);
  });
  it('una tabla sin dibujar se mide con su caja estimada (lejos o grande, no entra)', () => {
    expect(tablesInBox([node('far', 'table', 5000, 5000)], BOX, boxOf)).toEqual([]);
    expect(tablesInBox([node('big', 'table', 10, 10)], BOX, boxOf)).toEqual([]);
    expect(tablesInBox([node('fits', 'table', 10, 10)], { x: 0, y: 0, w: 400, h: 400 }, boxOf)).toEqual(['fits']);
  });
  it('las ocultas no cuentan', () => {
    expect(tablesInBox([node('h', 'table', 10, 10, { width: 50, height: 50 }, { hidden: true })], BOX, boxOf)).toEqual([]);
  });
});

// Lo que React Flow tiene seleccionado (y arrastra junto) sale de la app: el grupo
// o, sin grupo, la tabla seleccionada.
describe('applySelection / toggleGroup / selectedTables', () => {
  it('con grupo: solo sus tablas, y nada que no sea tabla (no viaja con el grupo)', () => {
    const nodes = [node('a', 'table', 0, 0), node('b', 'table', 0, 0, undefined, { selected: true }),
      node('v', 'view', 0, 0, undefined, { selected: true }), node('s', 'shape', 0, 0, undefined, { selected: true })];
    const out = applySelection(nodes, new Set(['a', 'c']), 'b');
    expect(out.map((n) => [n.id, !!n.selected])).toEqual([['a', true], ['b', false], ['v', false], ['s', false]]);
    expect(selectedTables(out)).toEqual(['a']);
  });
  it('sin grupo: solo la tabla seleccionada; lo que no es tabla queda como estaba', () => {
    const nodes = [node('a', 'table', 0, 0, undefined, { selected: true }), node('b', 'table', 0, 0),
      node('v', 'view', 0, 0, undefined, { selected: true })];
    expect(applySelection(nodes, new Set(), 'b').map((n) => [n.id, !!n.selected])).toEqual([['a', false], ['b', true], ['v', true]]);
    expect(applySelection(nodes, new Set(), null).map((n) => [n.id, !!n.selected])).toEqual([['a', false], ['b', false], ['v', true]]);
  });
  it('sin cambios devuelve el mismo arreglo', () => {
    const nodes = [node('a', 'table', 0, 0, undefined, { selected: true }), node('b', 'table', 0, 0)];
    expect(applySelection(nodes, new Set(['a', 'x']), null)).toBe(nodes);
    expect(applySelection(nodes, new Set(), 'a')).toBe(nodes);
  });
  it('Ctrl/Cmd + clic suma o saca la tabla; sin grupo, parte de la tabla seleccionada', () => {
    expect(toggleGroup([], 'a', 'b')).toEqual(['a', 'b']);
    expect(toggleGroup(['a', 'b'], null, 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleGroup(['a', 'b'], null, 'b')).toEqual(['a']);
    expect(toggleGroup([], 'a', 'a')).toEqual([]);
    expect(toggleGroup([], null, 'a')).toEqual(['a']);
  });
});

describe('createBoxGesture', () => {
  const setup = () => {
    const onSelect = vi.fn();
    const pick = vi.fn(() => ['a', 'b']);
    const g = createBoxGesture({ toFlow: (p) => ({ x: p.x * 2, y: p.y * 2 }), pick, onSelect });
    return { g, onSelect, pick };
  };
  it(`hasta ${BOX_DRAG_PX} px es un clic: sin cuadro ni selección`, () => {
    const { g, onSelect } = setup();
    g.down({ x: 10, y: 10 });
    expect(g.move({ x: 13, y: 10 })).toBeNull();
    expect(g.up({ x: 13, y: 10 })).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('pasado el umbral dibuja el rectángulo y al soltar selecciona lo de la caja de flujo', () => {
    const { g, onSelect, pick } = setup();
    g.down({ x: 40, y: 30 });
    expect(g.move({ x: 10, y: 50 })).toEqual({ left: 10, top: 30, width: 30, height: 20 });
    expect(g.up({ x: 10, y: 60 })).toBe(true);
    expect(pick).toHaveBeenCalledWith({ x: 20, y: 60, w: 60, h: 60 });
    expect(onSelect).toHaveBeenCalledWith(['a', 'b']);
  });
  it('cancelado no selecciona; sin down, nada', () => {
    const { g, onSelect } = setup();
    g.down({ x: 0, y: 0 });
    g.move({ x: 50, y: 50 });
    g.cancel();
    expect(g.up({ x: 60, y: 60 })).toBe(false);
    expect(g.move({ x: 70, y: 70 })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
