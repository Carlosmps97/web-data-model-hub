// Recarga por tablas: qué tablas tocó lo escrito en el draft y cómo un recorte
// del servidor se funde en el diagrama abierto. La propiedad central: si el
// servidor cambió solo lo del lote, fundir su recorte en el diagrama anterior da
// el diagrama completo nuevo, y lo que no es del lote conserva su objeto.
import { describe, expect, it } from 'vitest';
import type { BulkChange } from '@/services/changeset.service';
import type { Diagram } from '../services/modeler.service';
import { editedTables, isSlice, membershipChanged, mergeSlice, noEdits, viewSources, type DiagramSlice } from './diagramSlice';

const sa = (extra: object = {}) => ({ id: 'sa1', projectId: 'p1', name: 'C', tableIds: ['t1', 't2', 't3'], viewIds: ['v1'], layout: {}, ...extra });
const dia = (): Diagram => ({
  subjectArea: sa(),
  tables: [{ id: 't1', physicalName: 'A' }, { id: 't2', physicalName: 'B' }, { id: 't3', physicalName: 'C' }] as never,
  columns: [
    { id: 'c1', tableId: 't1', ordinal: 0 }, { id: 'c2', tableId: 't2', ordinal: 0 }, { id: 'c3', tableId: 't2', ordinal: 1 },
  ] as never,
  relationships: [{ id: 'r1', parentTableId: 't1', childTableId: 't2', pairs: [] }] as never,
  views: [{ id: 'v1', name: 'V', sourceTableIds: ['t2'] }] as never,
  productionStamp: '1:a',
});
const touched = (changes: BulkChange[], d: Diagram | null = dia()) => { const e = noEdits(); editedTables(d, changes, e); return e; };

describe('editedTables', () => {
  it('columnas: la tabla del payload y la actual (una mudanza deja de estar en la suya)', () => {
    expect(touched([{ collection: 'canonical_columns', entityId: 'c1', op: 'upsert', payload: { tableId: 't3' } }]))
      .toEqual({ tables: new Set(['t3', 't1']), full: false });
    expect(touched([{ collection: 'canonical_columns', entityId: 'c2', op: 'delete' }])).toEqual({ tables: new Set(['t2']), full: false });
    // Una columna que el canvas no tiene y se borra: nada que recargar aquí.
    expect(touched([{ collection: 'canonical_columns', entityId: 'cx', op: 'delete' }])).toEqual({ tables: new Set(), full: false });
  });

  it('cada llamada ubica con su diagrama', () => {
    const moved = { ...dia(), columns: [{ id: 'c2', tableId: 't3', ordinal: 0 }] as never };
    expect(touched([{ collection: 'canonical_columns', entityId: 'c2', op: 'delete' }]).tables).toEqual(new Set(['t2']));
    expect(touched([{ collection: 'canonical_columns', entityId: 'c2', op: 'delete' }], moved).tables).toEqual(new Set(['t3']));
  });

  it('mientras se abre el canvas (strict), una columna, relación o vista que el diagrama no tiene pide el completo', () => {
    const strict = (changes: BulkChange[]) => { const e = noEdits(); editedTables(dia(), changes, e, true); return e; };
    expect(strict([{ collection: 'canonical_columns', entityId: 'c9', op: 'delete' }]).full).toBe(true);
    expect(strict([{ collection: 'canonical_columns', entityId: 'c9', op: 'upsert', payload: { tableId: 't9' } }]).full).toBe(true);
    expect(strict([{ collection: 'relationships', entityId: 'r9', op: 'delete' }]).full).toBe(true);
    expect(strict([{ collection: 'views', entityId: 'v9', op: 'upsert', payload: { sourceTableIds: ['t9'] } }]).full).toBe(true);
    // Lo que tiene se ubica igual.
    expect(strict([{ collection: 'canonical_columns', entityId: 'c2', op: 'delete' }, { collection: 'relationships', entityId: 'r1', op: 'delete' },
      { collection: 'views', entityId: 'v1', op: 'upsert', payload: { sourceTableIds: ['t3'] } }]))
      .toEqual({ tables: new Set(['t2', 't1', 't3']), full: false });
  });

  it('sin canvas en pantalla: una baja no es de ninguno; lo que trae payload se ubica por él', () => {
    expect(touched([{ collection: 'canonical_columns', entityId: 'c2', op: 'delete' }], null)).toEqual({ tables: new Set(), full: false });
    expect(touched([{ collection: 'canonical_columns', entityId: 'c2', op: 'upsert', payload: { tableId: 't2' } },
      { collection: 'relationships', entityId: 'r1', op: 'upsert', payload: { parentTableId: 't1', childTableId: 't3' } }], null))
      .toEqual({ tables: new Set(['t2', 't1', 't3']), full: false });
  });

  it('relaciones: los extremos del payload (también legacy) y los actuales', () => {
    expect(touched([{ collection: 'relationships', entityId: 'r1', op: 'upsert', payload: { parentTableId: 't3', childTableId: 't2' } }]).tables)
      .toEqual(new Set(['t3', 't2', 't1']));
    expect(touched([{ collection: 'relationships', entityId: 'rx', op: 'upsert', payload: { sourceTableId: 't9', targetTableId: 't8' } }]).tables)
      .toEqual(new Set(['t9', 't8']));
    expect(touched([{ collection: 'relationships', entityId: 'r1', op: 'delete' }]).tables).toEqual(new Set(['t1', 't2']));
  });

  it('vistas: las fuentes del payload y las actuales; una baja va completa', () => {
    expect(touched([{ collection: 'views', entityId: 'v1', op: 'upsert', payload: { sourceTableIds: ['t3'] } }]).tables)
      .toEqual(new Set(['t3', 't2']));
    expect(touched([{ collection: 'views', entityId: 'vx', op: 'upsert', payload: { tableId: 't1' } }]).tables).toEqual(new Set(['t1']));
    expect(touched([{ collection: 'views', entityId: 'v1', op: 'delete' }]).full).toBe(true);
  });

  it('tablas: un cambio es esa tabla; una baja va completa (sale de los canvases)', () => {
    expect(touched([{ collection: 'canonical_tables', entityId: 't2', op: 'upsert', payload: {} }])).toEqual({ tables: new Set(['t2']), full: false });
    expect(touched([{ collection: 'canonical_tables', entityId: 't2', op: 'delete' }]).full).toBe(true);
  });

  it('el canvas abierto: solo la membresía cuenta', () => {
    const layout = { collection: 'subject_areas', entityId: 'sa1', op: 'upsert' as const, payload: { ...sa(), layout: { t1: { x: 5, y: 5 } } } };
    expect(touched([layout])).toEqual({ tables: new Set(), full: false });
    expect(touched([{ ...layout, payload: { ...sa(), tableIds: ['t1', 't2'] } }]).full).toBe(true);
    expect(touched([{ ...layout, payload: { ...sa(), viewIds: [] } }]).full).toBe(true);
    expect(touched([{ ...layout, op: 'delete', payload: undefined }]).full).toBe(true);
    expect(touched([{ ...layout, op: 'delete', payload: undefined }], { ...dia(), subjectArea: sa({ tableIds: [], viewIds: [] }) as never }).full)
      .toBe(true);                                                     // también uno vacío
    expect(touched([{ ...layout, entityId: 'sa9', payload: { tableIds: [] } }])).toEqual({ tables: new Set(), full: false });
  });

  it('proyectos y carpetas no tocan el canvas; lo demás (esquemas, desconocido) va completo', () => {
    expect(touched([{ collection: 'folders', entityId: 'f1', op: 'upsert', payload: {} }])).toEqual({ tables: new Set(), full: false });
    expect(touched([{ collection: 'projects', entityId: 'p1', op: 'delete' }])).toEqual({ tables: new Set(), full: false });
    expect(touched([{ collection: 'schemas', entityId: 's1', op: 'upsert', payload: {} }]).full).toBe(true);
    expect(touched([{ collection: 'otra', entityId: 'x', op: 'upsert', payload: {} }]).full).toBe(true);
  });
});

describe('mergeSlice', () => {
  const part = (extra: Partial<DiagramSlice> = {}): DiagramSlice => ({
    subjectArea: sa({ layout: { t2: { x: 9, y: 9 } } }) as never,
    tables: [{ id: 't2', physicalName: 'B2' }] as never,
    columns: [{ id: 'c3', tableId: 't2', ordinal: 0 }, { id: 'c4', tableId: 't2', ordinal: 1 }] as never,
    relationships: [] as never,
    views: [{ id: 'v1', name: 'V2', sourceTableIds: ['t2'] }] as never,
    productionStamp: '2:b',
    slice: { tableIds: ['t2'] },
    ...extra,
  });

  it('reemplaza lo del lote, quita lo que ya no viene y conserva el objeto de lo demás', () => {
    const before = dia();
    const out = mergeSlice(before, part());
    expect(out.tables.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    expect(out.tables[0]).toBe(before.tables[0]);
    expect(out.tables[1].physicalName).toBe('B2');
    expect(out.columns.map((c) => c.id)).toEqual(['c1', 'c3', 'c4']);    // c2 se borró
    expect(out.columns[0]).toBe(before.columns[0]);
    expect(out.relationships).toEqual([]);                                // r1 tocaba t2 y ya no viene
    expect(out.views.map((v) => v.name)).toEqual(['V2']);
    expect(out.subjectArea.layout).toEqual({ t2: { x: 9, y: 9 } });      // el canvas es el del recorte
    expect(out.productionStamp).toBe('1:a');                              // el de la última carga completa
    expect('slice' in out).toBe(false);
  });

  it('lo nuevo del recorte va al final y lo que sigue conserva su lugar (relaciones y vistas no se reordenan)', () => {
    const before = { ...dia(), relationships: [{ id: 'ra', parentTableId: 't2', childTableId: 't3', pairs: [] },
      { id: 'rb', parentTableId: 't1', childTableId: 't3', pairs: [] }] as never };
    const out = mergeSlice(before, part({ relationships: [{ id: 'rn', parentTableId: 't1', childTableId: 't2', pairs: [] },
      { id: 'ra', parentTableId: 't2', childTableId: 't3', pairs: [], label: 'x' }] as never }));
    expect(out.relationships.map((r) => r.id)).toEqual(['ra', 'rb', 'rn']);
  });

  it('orden del contrato: tablas por nombre físico sin mayúsculas, aunque un nombre cambie de lugar', () => {
    const before = { ...dia(), tables: [{ id: 't1', physicalName: 'alfa' }, { id: 't2', physicalName: 'Beta' }, { id: 't3', physicalName: 'gamma' }] as never };
    const out = mergeSlice(before, part({ tables: [{ id: 't2', physicalName: 'ZETA' }] as never }));
    expect(out.tables.map((t) => t.physicalName)).toEqual(['alfa', 'gamma', 'ZETA']);
  });

  it('una vista de varias fuentes es del lote si alguna fuente lo es', () => {
    const before = { ...dia(), views: [{ id: 'vm', name: 'M', sourceTableIds: ['t1', 't2'] }, { id: 'vo', name: 'O', sourceTableIds: ['t3'] }] as never };
    const out = mergeSlice(before, part({ views: [] as never }));      // ya no viene: se quita
    expect(out.views.map((v) => v.id)).toEqual(['vo']);
    expect(mergeSlice(before, part({ views: [{ id: 'vm', name: 'M2', sourceTableIds: ['t1', 't2'] }] as never })).views.map((v) => v.name))
      .toEqual(['M2', 'O']);
  });

  it('lo que el servidor manda en el recorte es lo que se quita del lote (mismos criterios)', () => {
    // Columnas por su tabla; relaciones si tocan el lote por cualquier extremo;
    // vistas por cualquier fuente (o `tableId` si no tienen lista).
    const before = {
      ...dia(),
      relationships: [{ id: 'rp', parentTableId: 't2', childTableId: 't3', pairs: [] }, { id: 'rc', parentTableId: 't1', childTableId: 't2', pairs: [] },
                      { id: 'rx', parentTableId: 't1', childTableId: 't3', pairs: [] }] as never,
      views: [{ id: 'vt', name: 'T', tableId: 't2' }, { id: 'vs', name: 'S', sourceTableIds: ['t3'], tableId: 't2' }] as never,
    };
    const out = mergeSlice(before, part({ relationships: [] as never, views: [] as never }));
    expect(out.relationships.map((r) => r.id)).toEqual(['rx']);
    expect(out.views.map((v) => v.id)).toEqual(['vs']);   // con lista de fuentes, `tableId` no cuenta
  });

  it('canvas sin lista explícita: la lista de vistas sale de las que quedan', () => {
    const out = mergeSlice(dia(), part({ subjectArea: sa({ viewIds: null }) as never, views: [{ id: 'v2', name: 'N', sourceTableIds: ['t2'] }] as never }));
    expect(out.subjectArea.viewIds).toEqual(['v2']);
  });

  it('isSlice y membershipChanged', () => {
    expect(isSlice(dia())).toBe(false);
    expect(isSlice(part())).toBe(true);
    expect(membershipChanged(dia(), part())).toBe(false);
    expect(membershipChanged(dia(), part({ subjectArea: sa({ tableIds: ['t1', 't2'] }) as never }))).toBe(true);
    expect(membershipChanged(dia(), part({ subjectArea: sa({ viewIds: ['v1', 'v9'] }) as never }))).toBe(true);
    expect(membershipChanged(dia(), part({ subjectArea: sa({ viewIds: null }) as never }))).toBe(false);
  });

  it('fuzz: si el servidor cambió solo lo del lote, el recorte fundido da el diagrama completo nuevo', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    for (let round = 0; round < 300; round++) {
      const ids = ['t1', 't2', 't3', 't4', 't5'].filter(() => rnd() < 0.8);
      if (ids.length < 2) continue;
      const lot = new Set(ids.filter(() => rnd() < 0.4));
      if (!lot.size) lot.add(ids[0]);
      const make = (gen: string, touch: (t: string) => boolean): Diagram => {
        const live = (t: string) => !touch(t) || rnd() < 0.85;     // del lote: alguna se borra
        const name = (t: string) => (touch(t) ? `${t}-${gen}` : t);
        return {
          subjectArea: sa({ tableIds: ids, viewIds: null }) as never,
          tables: ids.filter(live).map((t) => ({ id: t, physicalName: name(t).toUpperCase() })) as never,
          // Orden del contrato del servidor: por tabla y `ordinal`.
          columns: ids.flatMap((t) => [0, 1, 2].filter(() => !touch(t) || rnd() < 0.7)
            .map((k) => ({ id: `${t}c${k}`, tableId: t, ordinal: touch(t) ? 2 - k : k, physicalName: name(t) }))
            .sort((a, b) => a.ordinal - b.ordinal)) as never,
          relationships: ids.flatMap((p) => ids.filter((c) => (p < c) && (!(touch(p) || touch(c)) || rnd() < 0.6))
            .map((c) => ({ id: `r-${p}-${c}`, parentTableId: p, childTableId: c, pairs: [], label: touch(p) || touch(c) ? gen : '' }))) as never,
          views: ids.filter((t) => !touch(t) || rnd() < 0.7)
            .map((t) => ({ id: `v-${t}`, name: name(t), sourceTableIds: [t] })) as never,
          productionStamp: '1:a',
        };
      };
      const before = make('old', () => false);
      const after = make(pick(['new', 'newer']), (t) => lot.has(t));
      const slice: DiagramSlice = {
        subjectArea: { ...after.subjectArea, viewIds: null },
        tables: after.tables.filter((t) => lot.has(t.id)),
        columns: after.columns.filter((c) => lot.has(c.tableId)),
        relationships: after.relationships.filter((r) => lot.has(r.parentTableId) || lot.has(r.childTableId)),
        views: after.views.filter((v) => viewSources(v).some((t) => lot.has(t))),
        productionStamp: '1:a',
        slice: { tableIds: [...lot] },
      };
      const out = mergeSlice(before, slice);
      expect(out.tables).toEqual(after.tables);
      expect(out.columns).toEqual(after.columns);
      const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x]));
      expect(byId(out.relationships)).toEqual(byId(after.relationships));
      expect(byId(out.views)).toEqual(byId(after.views));
      expect(new Set(out.subjectArea.viewIds)).toEqual(new Set(after.views.map((v) => v.id)));
      for (const t of before.tables) if (!lot.has(t.id)) expect(out.tables.find((x) => x.id === t.id)).toBe(t);
    }
  });
});
