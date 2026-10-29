// Borrar un grupo de tablas en un solo lote (doc 134 §3.9): la cascada de una
// tabla aplicada al conjunto — cada vista, relación y columna una sola vez, el FK
// apagado solo en las hijas de AFUERA del grupo, cada canvas en el mismo envío —
// y un solo Undo que repone todo. Contra el mismo backend en memoria que la
// prueba de una tabla (`useModelerStore.deleteTableLot.test.ts`); el resultado
// es el mismo que borrar las tablas de a una.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn(), info: vi.fn() } }));
vi.mock('@/services/changeset.service', async (orig) => {
  const actual = await (await import('@/store/draftLedger.testutil')).withDraftLedger(await orig());
  return { ...actual, effective: vi.fn(), recordChange: vi.fn(), recordChangesBulk: vi.fn() };
});
vi.mock('../features/modeler/services/modeler.service', () => ({
  loadDiagram: vi.fn(), listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(async () => []), listProjects: vi.fn(async () => []),
}));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return { ...actual, listRelationships: vi.fn(), listColumns: vi.fn(), tableUsage: vi.fn() };
});
vi.mock('@/services/views.service', () => ({
  listViews: vi.fn(), listViewsForTables: vi.fn(), tableViews: vi.fn(), deleteView: vi.fn(), updateView: vi.fn(),
  currentView: vi.fn(),
}));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import * as csvc from '@/services/changeset.service';
import { ApiError } from '@/services/http';
import { forgetDraftSeqs } from '@/services/draftSeqs';
import * as mod from '../features/modeler/services/modeler.service';
import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { draftLedger } from './draftLedger.testutil';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';
import type { CanonicalColumn } from '@/services/governance.service';
import type { SubjectArea } from '../features/modeler/services/modeler.service';

type Pos = { x: number; y: number };
const CS = 'cs1';
const NETWORK = "Couldn't reach the server — check your connection.";
const SERVER_ERROR = 'Internal server error. Check the logs using the X-Request-ID.';
const R1 = [{ x: 200, y: 40 }, { x: 200, y: 160 }];
const BASE_TABLES = ['t1', 't2', 't3'].map((id) => ({ id, physicalName: `M_${id.toUpperCase()}`, logicalName: id }));
/** Las tablas del backend en memoria (el fuzz arma otras). */
const TABLES = [...BASE_TABLES];
const V1 = { id: 'v1', name: 'V_T1', tableId: 't1', sourceTableIds: ['t1'], showOnCanvas: true, sources: [] };
const col = (id: string, tableId: string, over: Partial<CanonicalColumn> = {}): CanonicalColumn =>
  ({ id, tableId, physicalName: id.toUpperCase(), logicalName: id, dataType: 'STRING', typeOverridden: false, ordinal: 0, ...over });

let draft: Record<string, SubjectArea> = {};
let cols = new Map<string, CanonicalColumn>();
let rels = new Map<string, gov.Relationship>();
let ops = new Map<string, 'upsert' | 'delete'>();
/** Cada envío del lote: sus cambios como `colección:id:op`. */
let lots: string[][] = [];
let log: string[] = [];
/** Lo que le pasa al próximo envío del lote. */
let fault: null | 'rejected' | 'lost' | 'lost-saved' | 'saved-uncounted' | 'error-500' = null;
let tableReadFails = false;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** La demora de cada respuesta del backend en memoria (el fuzz la apaga). */
let delay = 2;
const pause = () => (delay ? sleep(delay) : Promise.resolve());
const st = () => useModelerStore.getState();
const deleted = (coll: string, id: string) => ops.get(`${coll}:${id}`) === 'delete';
const key = (c: csvc.BulkChange) => `${c.collection}:${c.entityId}:${c.op}`;
const labels = () => useUndoStore.getState().stack.map((e) => e.label);

/** Cascada de membresía del backend: saca la tabla o vista de los canvases que no vienen en el lote. */
function cascade(coll: string, id: string, inLot: Set<string>): void {
  const field = coll === 'views' ? 'viewIds' : 'tableIds';
  for (const sa of Object.values(draft)) {
    const list = sa[field];
    if (inLot.has(sa.id) || !Array.isArray(list) || !list.includes(id)) continue;
    (sa as unknown as Record<string, unknown>)[field] = list.filter((x) => x !== id);
    if (sa.layout) delete sa.layout[id];
  }
}
/** Poda del backend al grabar un canvas: fuera lo listado que el draft borra. */
function prune(sa: SubjectArea): SubjectArea {
  const listed = [...(sa.tableIds ?? []), ...(Array.isArray(sa.viewIds) ? sa.viewIds : [])];
  const gone = new Set(listed.filter((id) => deleted('canonical_tables', id) || deleted('views', id)));
  const out = { ...sa, tableIds: (sa.tableIds ?? []).filter((t) => !gone.has(t)) };
  if (Array.isArray(sa.viewIds)) out.viewIds = sa.viewIds.filter((v) => !gone.has(v));
  if (sa.layout) out.layout = Object.fromEntries(Object.entries(sa.layout).filter(([k]) => !gone.has(k)));
  return out;
}
/** Aplica un lote como el backend: los cambios del modelo, la cascada a los canvases de afuera y los canvases del lote, podados. */
function apply(changes: csvc.BulkChange[]): void {
  const inLot = new Set(changes.filter((c) => c.collection === 'subject_areas').map((c) => c.entityId));
  for (const c of changes) {
    if (c.collection === 'subject_areas') continue;
    ops.set(`${c.collection}:${c.entityId}`, c.op);
    if (c.op === 'upsert' && c.collection === 'canonical_columns') cols.set(c.entityId, structuredClone(c.payload) as unknown as CanonicalColumn);
    if (c.op === 'upsert' && c.collection === 'relationships') rels.set(c.entityId, structuredClone(c.payload) as unknown as gov.Relationship);
    if (c.op === 'delete' && (c.collection === 'views' || c.collection === 'canonical_tables')) cascade(c.collection, c.entityId, inLot);
  }
  for (const c of changes) {
    if (c.collection === 'subject_areas') draft[c.entityId] = prune(structuredClone(c.payload) as unknown as SubjectArea);
  }
}
const shown = (sa: SubjectArea): string[] =>
  (Array.isArray(sa.viewIds) ? sa.viewIds : [V1].filter((v) => v.sourceTableIds.some((t) => sa.tableIds.includes(t))).map((v) => v.id))
    .filter((v) => !deleted('views', v));

const flowOf = () => ({
  getNodes: () => Object.entries(st().diagram?.subjectArea.layout ?? {}).map(([id, position]) => ({ id, type: 'table', position })),
  getNode: (id: string) => { const p = st().diagram?.subjectArea.layout?.[id]; return p ? { id, position: p } : undefined; },
  setNodes: vi.fn(),
  screenToFlowPosition: (p: Pos) => p,
}) as never;

async function setup(): Promise<void> {
  vi.resetAllMocks();
  forgetDraftSeqs();
  TABLES.splice(0, TABLES.length, ...BASE_TABLES);
  fault = null;
  tableReadFails = false;
  ops = new Map();
  lots = [];
  draft = {
    sa1: { id: 'sa1', projectId: 'p', name: 'Uno', folderId: null, tableIds: ['t1', 't2'], viewIds: ['v1'],
      layout: { t1: { x: 0, y: 0 }, t2: { x: 400, y: 0 }, v1: { x: 0, y: 300 } }, colors: { t1: '#FF0000' },
      drawings: [], udpValues: {}, routes: { r1: R1 } } as SubjectArea,
    sa2: { id: 'sa2', projectId: 'p', name: 'Dos', folderId: null, tableIds: ['t1'], viewIds: ['v1'],
      layout: { t1: { x: 5, y: 5 }, v1: { x: 5, y: 205 } }, drawings: [], udpValues: {}, routes: {} } as SubjectArea,
    sa3: { id: 'sa3', projectId: 'p', name: 'Tres', folderId: null, tableIds: ['t1'],
      layout: { t1: { x: 9, y: 9 }, v1: { x: 9, y: 209 } }, drawings: [], udpValues: {}, routes: {} } as SubjectArea,
  };
  cols = new Map([
    ['c1', col('c1', 't1', { isPrimaryKey: true })],
    ['c2', col('c2', 't1', { ordinal: 1 })],
    ['c3', col('c3', 't2', { isForeignKey: true })],
  ]);
  rels = new Map([['r1', { id: 'r1', parentTableId: 't1', childTableId: 't2', pairs: [{ parentColumnId: 'c1', childColumnId: 'c3' }] } as unknown as gov.Relationship]]);
  vi.mocked(csvc.writeSeqOf).mockImplementation(async () => ({ writeSeq: draftLedger.seq }));
  vi.mocked(csvc.effective).mockImplementation(async (_cs, coll, opts) => {
    await pause();
    if (coll === 'canonical_tables') {
      if (tableReadFails) throw new ApiError(NETWORK, 0, null, '/api/x');
      return TABLES.filter((t) => opts?.ids?.includes(t.id) && !deleted('canonical_tables', t.id)).map((t) => ({ ...t })) as never;
    }
    if (coll === 'canonical_columns') {
      return [...cols.values()].filter((c) => opts?.ids?.includes(c.id) && !deleted('canonical_columns', c.id)).map((c) => ({ ...c })) as never;
    }
    return (opts?.ids ?? []).filter((id) => draft[id]).map((id) => structuredClone(draft[id])) as never;
  });
  vi.mocked(csvc.recordChange).mockImplementation(async (cs, coll, id, op, payload) => {
    log.push(`put:${coll}:${id}`);
    await pause();
    if (coll === 'subject_areas') {
      if (op === 'delete') delete draft[id]; else draft[id] = prune(structuredClone(payload) as unknown as SubjectArea);
    } else apply([{ collection: coll, entityId: id, op, ...(payload ? { payload } : {}) }]);
    return { writeSeq: draftLedger.write(cs) } as never;
  });
  vi.mocked(csvc.recordChangesBulk).mockImplementation(async (cs, changes) => {
    lots.push(changes.map(key));
    await pause();
    const f = fault;
    fault = null;
    if (f === 'rejected') throw new ApiError('Invalid payload', 422, null, '/api/x');
    if (f === 'lost') { draftLedger.lost(cs, changes); throw new ApiError(NETWORK, 0, null, '/api/x'); }
    if (f === 'error-500') { draftLedger.lost(cs, changes); throw new ApiError(SERVER_ERROR, 500, null, '/api/x'); }
    apply(changes);
    if (f === 'lost-saved') { draftLedger.foreign(); draftLedger.lost(cs, changes); throw new ApiError(NETWORK, 0, null, '/api/x'); }
    // Grabado, pero el servidor no alcanzó a contarlo (`writeSeq` no sube).
    if (f === 'saved-uncounted') { draftLedger.lost(cs, changes); throw new ApiError(SERVER_ERROR, 500, null, '/api/x'); }
    return { writeSeq: draftLedger.write(cs, changes) } as never;
  });
  vi.mocked(gov.listRelationships).mockImplementation(async (t?: string) =>
    [...rels.values()].filter((r) => (r.parentTableId === t || r.childTableId === t) && !deleted('relationships', r.id)).map((r) => structuredClone(r)));
  vi.mocked(gov.listColumns).mockImplementation(async (t: string) =>
    [...cols.values()].filter((c) => c.tableId === t && !deleted('canonical_columns', c.id)).map((c) => ({ ...c })));
  vi.mocked(gov.tableUsage).mockImplementation(async (t: string) => {
    const usage = Object.values(draft).filter((sa) => sa.tableIds.includes(t)).map((sa) => ({ canvasId: sa.id }));
    return { usage, total: usage.length } as never;
  });
  vi.mocked(viewsSvc.listViews).mockImplementation(async (t: string) =>
    [V1].filter((v) => v.sourceTableIds.includes(t) && !deleted('views', v.id)).map((v) => structuredClone(v)) as never);
  vi.mocked(viewsSvc.listViewsForTables).mockImplementation(async (ids: string[]) =>
    [V1].filter((v) => v.sourceTableIds.some((t) => ids.includes(t)) && !deleted('views', v.id)) as never);
  vi.mocked(viewsSvc.tableViews).mockImplementation(async (t: string) => {
    const rows = [V1].filter((v) => v.sourceTableIds.includes(t) && !deleted('views', v.id)).map((v) => ({
      ...structuredClone(v),
      canvases: Object.values(draft).filter((sa) => shown(sa).includes(v.id)).map((sa) => ({ id: sa.id, name: sa.name })),
    }));
    return { views: rows, total: rows.length } as never;
  });
  vi.mocked(mod.loadDiagram).mockImplementation(async (saId: string) => {
    const snap = draft[saId] ? structuredClone(draft[saId]) : null;
    const draftSeq = draftLedger.seq;
    await pause();
    if (!snap) throw new Error('404');
    const viewIds = shown(snap);
    return {
      subjectArea: { ...snap, viewIds }, draftSeq,
      tables: TABLES.filter((t) => snap.tableIds.includes(t.id) && !deleted('canonical_tables', t.id)),
      columns: [...cols.values()].filter((c) => snap.tableIds.includes(c.tableId) && !deleted('canonical_columns', c.id)),
      relationships: [...rels.values()].filter((r) => !deleted('relationships', r.id)),
      views: [V1].filter((v) => viewIds.includes(v.id)),
    } as never;
  });
  const naming = await import('@/services/naming.service');
  vi.mocked(naming.getNamingConfig).mockImplementation(async () => ({}) as never);

  useSessionStore.setState({ openMode: 'editing', activeChangesetId: CS, activeProjectId: 'p' });
  useUndoStore.getState().clear();
  useUndoStore.setState({ busy: false });
  useModelerStore.setState({ activeSaId: null, diagram: null, dirty: false, viewerLayout: {}, viewerRoutesOff: {}, selectedTableId: null, selectedEdgeId: null, selectedViewId: null, flow: null, activeProjectId: 'p' } as never);
  await st().selectSubjectArea('sa1');
  useModelerStore.setState({ flow: flowOf() });
  log = [];
}
beforeEach(setup);
afterEach(async () => { await sleep(20); });

/** El grupo de prueba: t1 padre de t2 (r1) y de t3 (r3, t3 queda afuera), t2
 *  recursiva (r2), la vista V1 de t1 y t2, y t3 también en sa1. */
async function groupFixture(): Promise<void> {
  V1.sourceTableIds = ['t1', 't2'];
  cols = new Map([
    ['c1', col('c1', 't1', { isPrimaryKey: true })],
    ['c2', col('c2', 't1', { ordinal: 1 })],
    ['c3', col('c3', 't2', { isPrimaryKey: true, isForeignKey: true })],
    ['c5', col('c5', 't2', { ordinal: 1, isForeignKey: true })],
    ['c6', col('c6', 't3', { isForeignKey: true })],
  ]);
  rels = new Map([
    ['r1', { id: 'r1', parentTableId: 't1', childTableId: 't2', pairs: [{ parentColumnId: 'c1', childColumnId: 'c3' }] }],
    ['r2', { id: 'r2', parentTableId: 't2', childTableId: 't2', pairs: [{ parentColumnId: 'c3', childColumnId: 'c5' }] }],
    ['r3', { id: 'r3', parentTableId: 't1', childTableId: 't3', pairs: [{ parentColumnId: 'c1', childColumnId: 'c6' }] }],
  ] as unknown as [string, gov.Relationship][]);
  draft.sa1 = { ...draft.sa1, tableIds: ['t1', 't2', 't3'], layout: { ...draft.sa1.layout, t3: { x: 0, y: 600 } } };
  // El canvas abierto, con el grupo de prueba.
  await st().reload();
  useModelerStore.setState({ flow: flowOf() });
  log = [];
}
afterEach(() => { V1.sourceTableIds = ['t1']; });

/** Lo que importa del draft para comparar: lo borrado, las columnas vivas y cada
 *  canvas (listas sin orden). */
const snapshot = () => ({
  deleted: [...ops].filter(([, op]) => op === 'delete').map(([k]) => k).sort(),
  cols: [...cols.values()].filter((c) => !deleted('canonical_columns', c.id)).map((c) => ({ id: c.id, fk: !!c.isForeignKey })).sort((a, b) => a.id.localeCompare(b.id)),
  canvases: Object.fromEntries(Object.entries(draft).map(([id, sa]) => [id, {
    tableIds: [...sa.tableIds].sort(), viewIds: Array.isArray(sa.viewIds) ? [...sa.viewIds].sort() : null,
    layout: sa.layout, routes: sa.routes ?? {}, colors: sa.colors ?? {},
  }])),
});

describe('borrar un grupo de tablas: un solo lote', () => {
  beforeEach(groupFixture);

  it('cada vista, relación y columna una vez; el FK solo en la hija de afuera; cada canvas en el mismo envío', async () => {
    await st().deleteTables(['t1', 't2']);
    expect(lots).toHaveLength(1);
    expect(new Set(lots[0])).toEqual(new Set([
      'views:v1:delete', 'relationships:r1:delete', 'relationships:r2:delete', 'relationships:r3:delete',
      'canonical_columns:c1:delete', 'canonical_columns:c2:delete', 'canonical_columns:c3:delete', 'canonical_columns:c5:delete',
      'canonical_columns:c6:upsert', 'canonical_tables:t1:delete', 'canonical_tables:t2:delete',
      'subject_areas:sa1:upsert', 'subject_areas:sa2:upsert', 'subject_areas:sa3:upsert',
    ]));
    expect(lots[0]).toHaveLength(14);
    expect(log).toEqual([]);
    expect(cols.get('c6')?.isForeignKey).toBe(false);
    expect(draft.sa1).toMatchObject({ tableIds: ['t3'], viewIds: [], routes: {} });
    expect(labels()).toEqual(['Delete 2 tables']);
  });

  it('su Undo es un solo envío que deja todo como estaba; el Redo vuelve a borrar', async () => {
    const before = snapshot();
    await st().deleteTables(['t1', 't2']);
    const after = snapshot();
    lots = [];
    expect(await useUndoStore.getState().undoLast()).toBe('Delete 2 tables');
    expect(lots).toHaveLength(1);
    const back = snapshot();
    expect(back.cols).toEqual(before.cols);
    expect(back.canvases).toEqual(before.canvases);
    expect([...ops].filter(([k, op]) => op === 'delete' && !k.startsWith('subject_areas')).map(([k]) => k)).toEqual([]);
    expect(await useUndoStore.getState().redoLast()).toBe('Delete 2 tables');
    expect(snapshot()).toEqual(after);
  });

  it('deja el mismo draft que borrar las tablas de a una', async () => {
    await st().deleteTables(['t1', 't2']);
    const together = snapshot();
    await setup();
    await groupFixture();
    await st().deleteTable('t1');
    await st().deleteTable('t2');
    expect(snapshot()).toEqual(together);
  });

  it('una sola tabla sigue siendo «Delete table M_T1»', async () => {
    await st().deleteTables(['t1']);
    expect(labels()).toEqual(['Delete table M_T1']);
  });
});

describe('borrar un grupo: respuestas perdidas', () => {
  beforeEach(groupFixture);

  it('sin respuesta, pero se grabó: sigue como borrado, con un Undo que pasa el candado y repone todo', async () => {
    const before = snapshot();
    fault = 'lost-saved';
    await st().deleteTables(['t1', 't2']);
    expect(deleted('canonical_tables', 't1') && deleted('canonical_tables', 't2')).toBe(true);
    expect(labels()).toEqual(['Delete 2 tables']);
    expect(await useUndoStore.getState().undoLast()).toBe('Delete 2 tables');
    expect(snapshot()).toEqual(before);
  });

  it('sin respuesta y no se grabó: no se borró nada, no queda Undo y se puede reintentar', async () => {
    const before = snapshot();
    fault = 'lost';
    await expect(st().deleteTables(['t1', 't2'])).rejects.toThrow('No response from the server: nothing was deleted. Try again.');
    expect(snapshot()).toEqual(before);
    expect(labels()).toEqual([]);
    await st().deleteTables(['t1', 't2']);
    expect(labels()).toEqual(['Delete 2 tables']);
  });
});

/** Generador determinista del fuzz (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Un modelo al azar, el mismo para la misma semilla: de 3 a 5 tablas con su PK;
 *  de 1 a 5 relaciones (también recursivas), cada una con su columna FK en la
 *  hija; la vista V1 sobre una o dos tablas; las tablas en sa2 y sa3 al azar, y
 *  trazos en sa1. Devuelve el grupo a borrar (una o más tablas). */
async function randomModel(seed: number): Promise<string[]> {
  const r = rng(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  await setup();
  const ids = Array.from({ length: 3 + Math.floor(r() * 3) }, (_, i) => `t${i + 1}`);
  TABLES.splice(0, TABLES.length, ...ids.map((id) => ({ id, physicalName: `M_${id.toUpperCase()}`, logicalName: id })));
  cols = new Map(ids.map((t) => [`p_${t}`, col(`p_${t}`, t, { isPrimaryKey: true })]));
  rels = new Map();
  const k = 1 + Math.floor(r() * 5);
  for (let i = 0; i < k; i += 1) {
    const parent = pick(ids);
    const child = pick(ids);
    cols.set(`f${i}`, col(`f${i}`, child, { ordinal: 10 + i, isForeignKey: true }));
    rels.set(`r${i}`, { id: `r${i}`, parentTableId: parent, childTableId: child,
      pairs: [{ parentColumnId: `p_${parent}`, childColumnId: `f${i}` }] } as unknown as gov.Relationship);
  }
  V1.sourceTableIds = [...new Set(r() < 0.5 ? [pick(ids)] : [pick(ids), pick(ids)])];
  const at = (list: string[], dx: number) => Object.fromEntries(list.map((t, i) => [t, { x: dx + i * 300, y: 0 }]));
  const sa2 = ids.filter(() => r() < 0.5);
  const sa3 = ids.filter(() => r() < 0.5);
  draft.sa1 = { ...draft.sa1, tableIds: [...ids], viewIds: ['v1'], layout: { ...at(ids, 0), v1: { x: 0, y: 400 } },
    routes: Object.fromEntries([...rels.keys()].filter(() => r() < 0.5).map((id) => [id, R1])) };
  draft.sa2 = { ...draft.sa2, tableIds: sa2, layout: at(sa2, 5),
    viewIds: V1.sourceTableIds.some((t) => sa2.includes(t)) && r() < 0.7 ? ['v1'] : [] };
  draft.sa3 = { ...draft.sa3, tableIds: sa3, layout: at(sa3, 9) };
  await st().reload();
  useModelerStore.setState({ flow: flowOf() });
  log = [];
  const group = ids.filter(() => r() < 0.5);
  return group.length ? group : [pick(ids)];
}

describe('fuzz: borrar un grupo es lo mismo que borrar sus tablas de a una', () => {
  it('300 modelos al azar: un solo envío, el mismo draft, y su Undo deja todo como estaba', async () => {
    delay = 0;
    try {
      for (let seed = 1; seed <= 300; seed += 1) {
        const group = await randomModel(seed);
        const before = snapshot();
        await st().deleteTables(group);
        const together = snapshot();
        expect(lots, `semilla ${seed}`).toHaveLength(1);
        expect(await useUndoStore.getState().undoLast(), `semilla ${seed}`)
          .toBe(group.length === 1 ? `Delete table M_${group[0].toUpperCase()}` : `Delete ${group.length} tables`);
        expect(snapshot(), `semilla ${seed}`).toEqual(before);
        await randomModel(seed);
        for (const id of group) await st().deleteTable(id);
        expect(snapshot(), `semilla ${seed}`).toEqual(together);
      }
    } finally { delay = 2; }
  }, 120_000);
});

describe('el grupo es del canvas abierto', () => {
  it('abrir otro canvas lo suelta', async () => {
    useModelerStore.setState({ groupIds: ['t1', 't2'] });
    await st().selectSubjectArea('sa2');
    expect(st().groupIds).toEqual([]);
  });
});

describe('borrar un grupo con más cambios de los que entran en un envío', () => {
  beforeEach(async () => {
    await groupFixture();
    for (let i = 0; i < 1998; i += 1) cols.set(`k${i}`, col(`k${i}`, 't1', { ordinal: i + 2 }));
  });

  it('por partes, con las tablas al final; su Undo repone todo', async () => {
    const before = snapshot();
    await st().deleteTables(['t1', 't2']);
    expect(lots.every((l) => l.every((k) => !k.startsWith('subject_areas:')))).toBe(true);
    expect(log.slice(-2).sort()).toEqual(['put:canonical_tables:t1', 'put:canonical_tables:t2']);
    expect(deleted('canonical_tables', 't1') && deleted('canonical_tables', 't2')).toBe(true);
    expect(await useUndoStore.getState().undoLast()).toBe('Delete 2 tables');
    expect(snapshot().cols).toEqual(before.cols);
  });
});
