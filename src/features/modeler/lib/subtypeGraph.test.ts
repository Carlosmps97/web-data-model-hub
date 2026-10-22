import { describe, it, expect } from 'vitest';
import type { Relationship } from '@/services/governance.service';
import {
  SYMBOL_SIZE, buildSubtypeGraph, childSubtypeMembership, isSubcategory,
  subtypeGroups, symbolDefaultPos, symbolsOfParent,
} from './subtypeGraph';

const rel = (id: string, parent: string, child: string, symbol?: string | null): Relationship => ({
  id, parentTableId: parent, childTableId: child,
  pairs: [{ parentColumnId: `${parent}-pk`, childColumnId: `${child}-fk` }],
  parentCardinality: 'one', childCardinality: 'one', identifying: true,
  ...(symbol !== undefined ? { subcategory: true, subtypeSymbolId: symbol } : {}),
});

describe('subtypeGraph', () => {
  const rels: Relationship[] = [
    rel('r1', 'party', 'individuo', 'sym1'),
    rel('r2', 'party', 'organizacion', 'sym1'),
    rel('r3', 'cuenta', 'cuenta-ahorro', 'sym2'),
    rel('std', 'party', 'party-rol'),          // relación normal — no entra
  ];

  it('isSubcategory exige flag y símbolo', () => {
    expect(isSubcategory(rels[0])).toBe(true);
    expect(isSubcategory(rels[3])).toBe(false);
    expect(isSubcategory(rel('x', 'a', 'b', null))).toBe(false);
  });

  it('agrupa por símbolo con el supertipo del grupo', () => {
    const groups = subtypeGroups(rels);
    expect(groups.map((g) => g.symbolId)).toEqual(['sym1', 'sym2']);
    expect(groups[0].parentTableId).toBe('party');
    expect(groups[0].rels.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(groups[1].rels.map((r) => r.id)).toEqual(['r3']);
  });

  it('membership: un subtipo pertenece a un grupo', () => {
    expect(childSubtypeMembership(rels, 'individuo')).toBe('sym1');
    expect(childSubtypeMembership(rels, 'party-rol')).toBe(null);  // std no cuenta
    expect(childSubtypeMembership(rels, 'party')).toBe(null);
  });

  it('symbolsOfParent filtra por supertipo', () => {
    expect(symbolsOfParent(rels, 'party').map((g) => g.symbolId)).toEqual(['sym1']);
    expect(symbolsOfParent(rels, 'individuo')).toEqual([]);
  });

  it('posición default: centrado entre el padre y el promedio de hijos', () => {
    const p = { x: 100, y: 100, w: 200, h: 100 };       // borde inferior centro: (200, 200)
    const pos = symbolDefaultPos(p, [{ x: 100, y: 400 }, { x: 300, y: 400 }]);
    // promedio hijos (200, 400) → punto medio (200, 300) − mitad del símbolo
    expect(pos).toEqual({ x: 200 - SYMBOL_SIZE / 2, y: 300 - SYMBOL_SIZE / 2 });
    // sin hijos presentes: debajo del padre
    expect(symbolDefaultPos(p, [])).toEqual({ x: 200 - SYMBOL_SIZE / 2, y: 200 + 48 });
  });

  it('buildSubtypeGraph: nodo por símbolo + tronco + una arista por hijo', () => {
    const layout = { sym1: { x: 7, y: 8 } };
    const tablePos = new Map([
      ['party', { x: 0, y: 0 }], ['individuo', { x: 0, y: 300 }],
      ['organizacion', { x: 300, y: 300 }],
      ['cuenta', { x: 900, y: 0 }],           // sym2 sin su hijo en canvas
    ]);
    const { nodes, edges } = buildSubtypeGraph(
      rels, layout, tablePos, () => ({ w: 230, h: 120 }), (r) => r.id === 'r2');

    expect(nodes.map((n) => n.id)).toEqual(['sym1', 'sym2']);
    expect(nodes[0].type).toBe('subcat');
    expect(nodes[0].position).toEqual({ x: 7, y: 8 });      // layout persiste
    expect(nodes[1].position.y).toBeGreaterThan(0);          // derivada

    const trunk = edges.find((e) => e.id === 'subsym-sym1');
    expect(trunk).toMatchObject({
      source: 'party', target: 'sym1', type: 'subcat',
      sourceHandle: '__hdr_src', targetHandle: '__sym_tgt',
    });
    expect(trunk?.data).toMatchObject({ trunk: true, symbolId: 'sym1' });

    const child = edges.find((e) => e.id === 'r1');
    expect(child).toMatchObject({
      source: 'sym1', target: 'individuo',
      sourceHandle: '__sym_src', targetHandle: 'individuo-fk__tgt',
    });
    expect(child?.data).toMatchObject({ drifted: false, symbolId: 'sym1' });
    expect(edges.find((e) => e.id === 'r2')?.data).toMatchObject({ drifted: true });
    // hijo ausente del canvas → sin arista; el tronco de sym2 sí existe
    expect(edges.find((e) => e.id === 'r3')).toBeUndefined();
    expect(edges.find((e) => e.id === 'subsym-sym2')).toBeDefined();
  });

  it('grupo cuyo supertipo no está en el canvas no se dibuja', () => {
    const tablePos = new Map([['individuo', { x: 0, y: 0 }]]);
    const { nodes, edges } = buildSubtypeGraph(
      rels, {}, tablePos, () => ({ w: 230, h: 120 }), () => false);
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });
});

describe('subtypeGraph · frases de relación', () => {
  const tablePos = new Map([['party', { x: 0, y: 0 }], ['individuo', { x: 0, y: 300 }], ['organizacion', { x: 300, y: 300 }]]);
  const build = (rels: Relationship[]) => buildSubtypeGraph(rels, {}, tablePos, () => ({ w: 230, h: 100 }), () => false);

  it('cada rama lleva la frase de su relación; el tronco no lleva ninguna', () => {
    const { edges } = build([
      { ...rel('r1', 'party', 'individuo', 'sym1'), parentToChildPhrase: 'Party es un Individuo' },
      { ...rel('r2', 'party', 'organizacion', 'sym1'),
        parentToChildPhrase: 'Organizacion es un tipo de', childToParentPhrase: 'Party' },
    ]);
    const data = (id: string) => edges.find((e) => e.id === id)!.data as { label?: string | null };
    expect(data('r1').label).toBe('Party es un Individuo');
    expect(data('r2').label).toBe('Organizacion es un tipo de / Party');
    expect(data('subsym-sym1').label).toBeUndefined();
  });

  it('rama sin frases: sin etiqueta', () => {
    const { edges } = build([rel('r1', 'party', 'individuo', 'sym1')]);
    expect((edges.find((e) => e.id === 'r1')!.data as { label?: string | null }).label).toBeNull();
  });

  it('el texto completo viaja aparte para el tooltip cuando el dibujo se corta', () => {
    const largo = 'x'.repeat(90);
    const { edges } = build([{ ...rel('r1', 'party', 'individuo', 'sym1'), parentToChildPhrase: largo }]);
    const d = edges.find((e) => e.id === 'r1')!.data as { label: string; labelTitle: string };
    expect(d.label).toBe(`${'x'.repeat(79)}…`);
    expect(d.labelTitle).toBe(largo);
  });
});

