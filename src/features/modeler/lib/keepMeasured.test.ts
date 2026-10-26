// Al re-armar los nodos con cada carga del diagrama, cada bloque conserva su
// tamaño medido mientras no cambien sus anclas ni su caja; si cambiaron, si
// cambió la faceta, si es extremo de un wire nuevo o re-apuntado, o si ancla un
// wire de relación con la medida del otro modo (compacto o detallado), vuelve a
// medirse (solo ese).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { adoptUserNodes, Position } from '@xyflow/system';
import { anchorLayout, keepMeasured, measureOptions, measuredCompact, wireChanges } from './keepMeasured';
import { tableLodSize } from './lodSize';

const col = (id: string, ordinal: number, pk = false) =>
  ({ id, tableId: 't1', physicalName: id.toUpperCase(), logicalName: id, dataType: 'STRING', ordinal, isPrimaryKey: pk });
const table = (columns: ReturnType<typeof col>[], extra: Record<string, unknown> = {}): Node => ({
  id: 't1', type: 'table', position: { x: 0, y: 0 },
  data: { table: { id: 't1', physicalName: 'M_T1', logicalName: 'T1' }, columns, lod: false, refCols: [], ...extra },
});
const measured = (n: Node): Node => ({ ...n, measured: { width: 300, height: 120 } });
const BASE = [col('a', 0, true), col('b', 1), col('c', 2)];
const PHYS = { viewMode: 'physical' as const, prevViewMode: 'physical' };

describe('keepMeasured', () => {
  it('mismas filas con objetos nuevos (una recarga): conserva el tamaño medido', () => {
    const next = keepMeasured([measured(table(BASE))], [table(BASE.map((c) => ({ ...c, description: 'otra' })))], PHYS);
    expect(next[0].measured).toEqual({ width: 300, height: 120 });
  });

  it.each([
    ['baja de una columna', [BASE[0], BASE[2]]],
    ['alta de una columna', [...BASE, col('d', 3)]],
    ['reorden (mismo largo)', [BASE[0], { ...BASE[1], ordinal: 2 }, { ...BASE[2], ordinal: 1 }]],
    ['una columna entra a la llave', [BASE[0], { ...BASE[1], isPrimaryKey: true }, BASE[2]]],
    ['otra columna en el mismo lugar', [BASE[0], col('x', 1), BASE[2]]],
    ['un nombre más largo (caja más ancha)', [BASE[0], { ...BASE[1], physicalName: 'B'.repeat(60) }, BASE[2]]],
  ])('%s: ese bloque vuelve a medirse', (_name, columns) => {
    const next = keepMeasured([measured(table(BASE))], [table(columns)], PHYS);
    expect(next[0].measured).toBeUndefined();
  });

  it('cambio de faceta: todos vuelven a medirse (otro nombre, otro ancho)', () => {
    const next = keepMeasured([measured(table(BASE))], [table(BASE)], { viewMode: 'logical', prevViewMode: 'physical' });
    expect(next[0].measured).toBeUndefined();
  });

  it('extremo de un wire nuevo o re-apuntado: vuelve a medirse', () => {
    const next = keepMeasured([measured(table(BASE))], [table(BASE)], { ...PHYS, remeasure: new Set(['t1']) });
    expect(next[0].measured).toBeUndefined();
  });

  it('modo compacto: las anclas son las columnas con wires', () => {
    const lod = (refCols: string[]) => table(BASE, { lod: true, refCols });
    expect(keepMeasured([measured(lod(['b']))], [lod(['b'])], PHYS)[0].measured).toBeDefined();
    expect(keepMeasured([measured(lod(['b']))], [lod(['b', 'c'])], PHYS)[0].measured).toBeUndefined();
    expect(keepMeasured([measured(table(BASE))], [lod([])], PHYS)[0].measured).toBeUndefined();
  });

  it('las vistas anclan en la cabecera: conservan el tamaño mientras su caja no cambie', () => {
    const view = (sources: { column: string }[]): Node => ({
      id: 'v1', type: 'view', position: { x: 0, y: 0 }, data: { view: { id: 'v1', name: 'V1', sources }, colTypes: {} },
    });
    const ab = [{ column: 'A' }, { column: 'B' }];
    expect(keepMeasured([measured(view(ab))], [view(ab.map((s) => ({ ...s })))], PHYS)[0].measured).toBeDefined();
    expect(keepMeasured([measured(view(ab))], [view([{ column: 'A' }])], PHYS)[0].measured).toBeUndefined();
  });

  it('sin medida previa, otro tipo de nodo o nodo nuevo: sin cambios', () => {
    expect(keepMeasured([table(BASE)], [table(BASE)], PHYS)[0].measured).toBeUndefined();
    expect(keepMeasured([{ ...measured(table(BASE)), type: 'view' }], [table(BASE)], PHYS)[0].measured).toBeUndefined();
    expect(keepMeasured([], [table(BASE)], PHYS)[0].measured).toBeUndefined();
  });

  it('la disposición de una tabla sigue el orden del bloque (llave primero, luego ordinal)', () => {
    expect(anchorLayout(table([col('c', 2), col('a', 0, true), col('b', 1)]), 'physical')).toBe(anchorLayout(table(BASE), 'physical'));
  });
});

describe('wireChanges', () => {
  const wire = (id: string, source: string, target: string, targetHandle: string): Edge =>
    ({ id, source, target, sourceHandle: '__hdr_src', targetHandle });

  it('marca los extremos de los wires nuevos o re-apuntados; los iguales no', () => {
    const first = wireChanges(new Map(), [wire('r1', 'p', 'c', 'x__tgt'), wire('r2', 'p', 'd', 'y__tgt')]);
    expect(first.remeasure).toEqual(new Set(['p', 'c', 'd']));
    const again = wireChanges(first.wires, [wire('r1', 'p', 'c', 'x__tgt'), wire('r2', 'p', 'd', 'z__tgt'), wire('r3', 'q', 'e', 'w__tgt')]);
    expect(again.remeasure).toEqual(new Set(['p', 'd', 'q', 'e']));
  });

  it('tras salir del modo compacto, un wire re-apuntado a una tabla fuera de pantalla la vuelve a medir', () => {
    // React Flow: la tabla C se midió compacta (solo el handle fantasma de c1);
    // al acercar el zoom nadie la vuelve a medir (no está montada).
    const lookup = new Map(); const parents = new Map();
    const cols = [{ ...col('c1', 0, true), tableId: 'C' }, { ...col('c2', 1), tableId: 'C' }];
    const cLod: Node = { id: 'C', type: 'table', position: { x: 0, y: 0 }, measured: { width: 240, height: 88 },
      data: { table: { id: 'C', physicalName: 'C', logicalName: 'C' }, columns: cols, lod: true, refCols: ['c1'] } };
    adoptUserNodes([cLod], lookup, parents);
    lookup.get('C').internals.handleBounds = { source: [], target: [{ id: 'c1__tgt', type: 'target', nodeId: 'C', x: 0, y: 44, width: 1, height: 1, position: Position.Left }] };
    const afterExit: Node = { ...cLod, data: { ...cLod.data, lod: false } };
    // Recarga: el par 0 de la relación pasa a c2.
    const before = wireChanges(new Map(), [wire('r1', 'P', 'C', 'c1__tgt')]).wires;
    const { remeasure } = wireChanges(before, [wire('r1', 'P', 'C', 'c2__tgt')]);
    const fresh: Node = { id: 'C', type: 'table', position: { x: 0, y: 0 }, data: { ...cLod.data, lod: false, refCols: ['c2'] } };
    const [next] = keepMeasured([afterExit], [fresh], { ...PHYS, remeasure });
    adoptUserNodes([next], lookup, parents);
    expect(next.measured).toBeUndefined();
    expect(lookup.get('C').internals.handleBounds).toBeUndefined();   // React Flow lo dibuja y lo mide
  });
});

describe('medidas del modo compacto', () => {
  // La caja compacta mide exactamente su tamaño estimado (estilo fijo, border-box).
  const lodBox = (columns = BASE) => { const { w, h } = tableLodSize(table(columns).data.table as never, columns as never, 'physical'); return { width: w, height: h }; };
  const withLod = (lod: boolean, measuredAs?: { width: number; height: number }): Node =>
    ({ ...table(BASE, { lod, refCols: ['b'] }), ...(measuredAs ? { measured: measuredAs } : {}) });
  const DETAILED = { width: 262, height: 121 };
  const ANCHORED = { ...PHYS, anchored: new Set(['t1']) };

  it('reconoce la medida compacta por su caja exacta', () => {
    expect(measuredCompact(withLod(true, lodBox()), 'physical')).toBe(true);
    expect(measuredCompact(withLod(false, DETAILED), 'physical')).toBe(false);
    // Mismo ancho (el mínimo) o mismo alto que la caja compacta no alcanza.
    expect(measuredCompact(withLod(false, { ...lodBox(), height: lodBox().height + 3 }), 'physical')).toBe(false);
    expect(measuredCompact(withLod(false, { ...lodBox(), width: lodBox().width + 5 }), 'physical')).toBe(false);
    expect(measuredCompact(withLod(false), 'physical')).toBe(false);
    expect(measuredCompact({ id: 's', type: 'subcat', position: { x: 0, y: 0 }, data: {}, measured: { width: 28, height: 28 } }, 'physical')).toBe(false);
  });

  it('extremo de una relación medido compacto que ahora se dibuja detallado: vuelve a medirse', () => {
    expect(keepMeasured([withLod(false, lodBox())], [withLod(false)], ANCHORED)[0].measured).toBeUndefined();
  });

  it('extremo de una relación medido detallado y dibujado detallado: conserva la medida', () => {
    expect(keepMeasured([withLod(false, DETAILED)], [withLod(false)], ANCHORED)[0].measured).toEqual(DETAILED);
  });

  it('al revés: medido detallado y ahora compacto vuelve a medirse; medido compacto y compacto, no', () => {
    expect(keepMeasured([withLod(true, DETAILED)], [withLod(true)], ANCHORED)[0].measured).toBeUndefined();
    expect(keepMeasured([withLod(true, lodBox())], [withLod(true)], ANCHORED)[0].measured).toEqual(lodBox());
  });

  it('en lógico, la caja compacta es la de los nombres lógicos', () => {
    const t = { id: 't1', physicalName: 'M_T1', logicalName: 'Tabla con un nombre lógico bastante largo' };
    const node = (measuredAs?: { width: number; height: number }): Node =>
      ({ id: 't1', type: 'table', position: { x: 0, y: 0 }, data: { table: t, columns: BASE, lod: false, refCols: ['b'] }, ...(measuredAs ? { measured: measuredAs } : {}) });
    const box = (facet: 'logical' | 'physical') => { const { w, h } = tableLodSize(t as never, BASE as never, facet); return { width: w, height: h }; };
    expect(box('logical')).not.toEqual(box('physical'));
    const LOGICAL = { viewMode: 'logical' as const, prevViewMode: 'logical', anchored: new Set(['t1']) };
    expect(keepMeasured([node(box('logical'))], [node()], LOGICAL)[0].measured).toBeUndefined();
    expect(keepMeasured([node(box('physical'))], [node()], LOGICAL)[0].measured).toEqual(box('physical'));
  });

  it('un bloque que no ancla relaciones conserva la medida compacta (solo la caja; se corrige al dibujarse)', () => {
    expect(keepMeasured([withLod(false, lodBox())], [withLod(false)], PHYS)[0].measured).toEqual(lodBox());
  });

  it('React Flow: tras salir del compacto, la recarga vuelve a medir al hijo de la relación fuera de pantalla', () => {
    // Al abrir un canvas gigante todo se ve y se mide compacto; al acercar el zoom
    // el efecto LOD solo cambia `data.lod` y conserva la medida.
    const lookup = new Map(); const parents = new Map();
    const ghost = { id: 'b__tgt', type: 'target' as const, nodeId: 't1', x: 0, y: lodBox().height / 2, width: 1, height: 1, position: Position.Left };
    adoptUserNodes([withLod(true, lodBox())], lookup, parents);
    lookup.get('t1').internals.handleBounds = { source: [], target: [ghost] };
    const afterExit = withLod(false, lodBox());
    adoptUserNodes([afterExit], lookup, parents);
    expect(lookup.get('t1').internals.handleBounds.target[0]).toBe(ghost);   // ancla a media altura
    const edges: Edge[] = [{ id: 'r1', source: 'p', target: 't1', sourceHandle: '__hdr_src', targetHandle: 'b__tgt', type: 'crowfoot' }];
    const first = measureOptions({ wires: new Map() }, edges, 'physical');
    const { keep } = measureOptions(first.memo, edges, 'physical');   // recarga: mismos wires
    const [next] = keepMeasured([afterExit], [withLod(false)], keep);
    adoptUserNodes([next], lookup, parents);
    expect(lookup.get('t1').internals.handleBounds).toBeUndefined();         // React Flow lo dibuja y lo mide
  });
});

describe('measureOptions', () => {
  const crow: Edge = { id: 'r1', source: 'p', target: 'c', sourceHandle: '__hdr_src', targetHandle: 'x__tgt', type: 'crowfoot' };
  const sub: Edge = { id: 'subsym-1', source: 's', target: 'c', type: 'subcat' };
  const deriv: Edge = { id: 'deriv__v__t', source: 't', target: 'v', sourceHandle: '__hdr_src', targetHandle: '__hdr_tgt', type: 'derivation' };

  it('compara contra el armado anterior y devuelve lo que este deja al siguiente', () => {
    const first = measureOptions({ wires: new Map() }, [crow, deriv], 'physical');
    expect(first.keep.prevViewMode).toBeUndefined();
    expect(first.keep.remeasure).toEqual(new Set(['p', 'c', 't', 'v']));
    expect(first.memo.viewMode).toBe('physical');
    const second = measureOptions(first.memo, [crow, deriv], 'logical');
    expect(second.keep.prevViewMode).toBe('physical');    // la faceta del armado anterior, no la nueva
    expect(second.keep.viewMode).toBe('logical');
    expect(second.keep.remeasure).toEqual(new Set());      // mismos wires
    expect(second.memo.viewMode).toBe('logical');
  });

  it('anclan las relaciones y las subcategorías; la derivación ancla en las cabeceras', () => {
    const { keep } = measureOptions({ wires: new Map() }, [crow, sub, deriv], 'physical');
    expect(keep.anchored).toEqual(new Set(['p', 'c', 's']));
  });
});

it('el canvas arma sus nodos con las opciones del armado anterior', () => {
  const src = readFileSync(new URL('../components/ModelerCanvas.tsx', import.meta.url), 'utf8');
  expect(src).toMatch(/measureOptions\(\s*lastBuild\.current\s*,\s*nextEdges\s*,\s*viewMode\s*\)/);
  expect(src).toMatch(/lastBuild\.current\s*=\s*memo\s*;/);
  expect(src).toMatch(/keepMeasured\(\s*prev\s*,[^;]*,\s*keep\s*\)/);
});
