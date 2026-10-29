// Borrar una tabla en un solo lote (doc 133 §4): vistas, relaciones, columnas,
// FK apagados, la tabla y cada canvas donde estaba viajan en un solo envío —
// todo o nada—, y su Undo también. Contra un backend en memoria que se porta
// como el real: el lote saca lo borrado de los canvases que no vienen en él y
// poda los que sí. Si el envío queda sin respuesta, se relee la tabla: si se
// grabó, el borrado sigue con su Undo (que pasa el candado); si no, no se borró
// nada. `structure.service` es el real (con su cola por canvas).
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
import { StaleUndoError, useUndoStore } from './useUndoStore';
import type { CanonicalColumn } from '@/services/governance.service';
import type { SubjectArea } from '../features/modeler/services/modeler.service';

type Pos = { x: number; y: number };
const CS = 'cs1';
const NETWORK = "Couldn't reach the server — check your connection.";
const SERVER_ERROR = 'Internal server error. Check the logs using the X-Request-ID.';
const R1 = [{ x: 200, y: 40 }, { x: 200, y: 160 }];
const TABLES = ['t1', 't2', 't3'].map((id) => ({ id, physicalName: `M_${id.toUpperCase()}`, logicalName: id }));
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

beforeEach(async () => {
  vi.resetAllMocks();
  forgetDraftSeqs();
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
    await sleep(2);
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
    await sleep(2);
    if (coll === 'subject_areas') {
      if (op === 'delete') delete draft[id]; else draft[id] = prune(structuredClone(payload) as unknown as SubjectArea);
    } else apply([{ collection: coll, entityId: id, op, ...(payload ? { payload } : {}) }]);
    return { writeSeq: draftLedger.write(cs) } as never;
  });
  vi.mocked(csvc.recordChangesBulk).mockImplementation(async (cs, changes) => {
    lots.push(changes.map(key));
    await sleep(2);
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
    await sleep(2);
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
});
afterEach(async () => { await sleep(20); });

describe('borrar una tabla: un solo lote', () => {
  it('vistas, relaciones, columnas, FK apagados, la tabla y cada canvas van en un solo envío', async () => {
    await st().deleteTable('t1');
    expect(lots).toHaveLength(1);
    expect(new Set(lots[0])).toEqual(new Set([
      'views:v1:delete', 'relationships:r1:delete', 'canonical_columns:c1:delete', 'canonical_columns:c2:delete',
      'canonical_columns:c3:upsert', 'canonical_tables:t1:delete',
      'subject_areas:sa1:upsert', 'subject_areas:sa2:upsert', 'subject_areas:sa3:upsert',
    ]));
    expect(log).toEqual([]);                                           // ninguna escritura suelta
    expect(cols.get('c3')?.isForeignKey).toBe(false);
    expect(draft.sa1).toMatchObject({ tableIds: ['t2'], viewIds: [], routes: {}, layout: { t2: { x: 400, y: 0 } } });
    expect(draft.sa1.colors ?? {}).toEqual({});
    expect(draft.sa2).toMatchObject({ tableIds: [], viewIds: [] });
    expect(draft.sa3.tableIds).toEqual([]);
    expect(draft.sa3.viewIds).toBeUndefined();
    expect(labels()).toEqual(['Delete table M_T1']);
  });

  it('del FK de las hijas lee solo sus columnas hijas, no la tabla hija entera', async () => {
    await st().deleteTable('t1');
    expect(vi.mocked(gov.listColumns).mock.calls.map(([t]) => t)).toEqual(['t1']);
    expect(cols.get('c3')?.isForeignKey).toBe(false);
  });

  it('con llave compuesta apaga el FK de todas las columnas hijas que quedan huérfanas', async () => {
    cols.set('c4', col('c4', 't2', { isForeignKey: true, ordinal: 1 }));
    rels.set('r1', { id: 'r1', parentTableId: 't1', childTableId: 't2',
      pairs: [{ parentColumnId: 'c1', childColumnId: 'c3' }, { parentColumnId: 'c2', childColumnId: 'c4' }] } as unknown as gov.Relationship);
    await st().deleteTable('t1');
    expect([cols.get('c3')?.isForeignKey, cols.get('c4')?.isForeignKey]).toEqual([false, false]);
  });

  it('su Undo también es un solo envío y deja todo como estaba', async () => {
    const before = structuredClone(draft);
    await st().deleteTable('t1');
    lots = [];
    expect(await useUndoStore.getState().undoLast()).toBe('Delete table M_T1');
    expect(lots).toHaveLength(1);
    expect(new Set(lots[0])).toEqual(new Set([
      'canonical_tables:t1:upsert', 'canonical_columns:c1:upsert', 'canonical_columns:c2:upsert', 'canonical_columns:c3:upsert',
      'relationships:r1:upsert', 'views:v1:upsert',
      'subject_areas:sa1:upsert', 'subject_areas:sa2:upsert', 'subject_areas:sa3:upsert',
    ]));
    expect(log).toEqual([]);
    expect(cols.get('c3')?.isForeignKey).toBe(true);
    for (const id of ['sa1', 'sa2', 'sa3']) {
      expect(new Set(draft[id].tableIds)).toEqual(new Set(before[id].tableIds));
      expect(draft[id].layout).toEqual(before[id].layout);
    }
    expect(draft.sa1.viewIds).toEqual(['v1']);
    expect(draft.sa1.routes).toEqual({ r1: R1 });
    expect(draft.sa1.colors).toEqual({ t1: '#FF0000' });
    expect(draft.sa3.viewIds).toBeUndefined();
  });

  it('deshacer con un canvas borrado en el medio: repone en los demás', async () => {
    const before = structuredClone(draft);
    await st().deleteTable('t1');
    delete draft.sa3;                                                  // borrado desde el Explorer
    expect(await useUndoStore.getState().undoLast()).toBe('Delete table M_T1');
    expect(deleted('canonical_tables', 't1')).toBe(false);
    for (const id of ['sa1', 'sa2']) expect(draft[id].layout).toEqual(before[id].layout);
    expect(draft.sa3).toBeUndefined();
  });

  it('el Undo sin respuesta pero grabado pide reintentar; el reintento deja todo como estaba, una sola vez', async () => {
    const before = structuredClone(draft);
    await st().deleteTable('t1');
    fault = 'lost-saved';
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow('Press Undo to try again.');
    expect(await useUndoStore.getState().undoLast()).toBe('Delete table M_T1');
    for (const id of ['sa1', 'sa2', 'sa3']) {
      expect(draft[id].tableIds).toHaveLength(before[id].tableIds.length);   // sin duplicados
      expect(new Set(draft[id].tableIds)).toEqual(new Set(before[id].tableIds));
      expect(draft[id].layout).toEqual(before[id].layout);
    }
    expect(draft.sa1.routes).toEqual({ r1: R1 });
    // Tras una escritura de resultado desconocido no queda qué rehacer (doc 132).
    expect(useUndoStore.getState().redoStack).toEqual([]);
  });

  it('el Undo sin respuesta y sin grabar pide reintentar; el reintento repone todo y deja qué rehacer', async () => {
    await st().deleteTable('t1');
    fault = 'lost';
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow('Press Undo to try again.');
    expect(deleted('canonical_tables', 't1')).toBe(true);
    expect(await useUndoStore.getState().undoLast()).toBe('Delete table M_T1');
    expect(deleted('canonical_tables', 't1')).toBe(false);
    expect(useUndoStore.getState().redoStack.map((e) => e.label)).toEqual(['Delete table M_T1']);
  });

  it('si no se pueden leer los canvases del lote (500), no se borra nada y lo dice', async () => {
    const read = vi.mocked(csvc.effective).getMockImplementation()!;
    vi.mocked(csvc.effective).mockImplementation(async (cs, coll, opts) => {
      if (coll === 'subject_areas' && (opts?.ids?.length ?? 0) > 1) throw new ApiError(SERVER_ERROR, 500, null, '/api/x');
      return read(cs, coll, opts);
    });
    const before = structuredClone(draft);
    await expect(st().deleteTable('t1')).rejects.toThrow("Couldn't read the canvases: nothing was deleted. Try again.");
    expect(lots).toEqual([]);
    expect(draft).toEqual(before);
    expect(labels()).toEqual([]);
  });

  it('el Undo con la lectura de sus canvases fallando (500): no escribe nada y la entrada vuelve para reintentar', async () => {
    await st().deleteTable('t1');
    const read = vi.mocked(csvc.effective).getMockImplementation()!;
    let fail = true;
    vi.mocked(csvc.effective).mockImplementation(async (cs, coll, opts) => {
      if (fail && coll === 'subject_areas' && (opts?.ids?.length ?? 0) > 1) { fail = false; throw new ApiError(SERVER_ERROR, 500, null, '/api/x'); }
      return read(cs, coll, opts);
    });
    lots = [];
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow(
      "Couldn't read the canvases: nothing was undone. Press Undo to try again.");
    expect(lots).toEqual([]);
    expect(await useUndoStore.getState().undoLast()).toBe('Delete table M_T1');
    expect(deleted('canonical_tables', 't1')).toBe(false);
  });

  it('si el servidor rechaza el lote, no se borra nada y no queda Undo', async () => {
    const before = structuredClone(draft);
    fault = 'rejected';
    await expect(st().deleteTable('t1')).rejects.toThrow('Invalid payload');
    expect(draft).toEqual(before);
    expect(ops.size).toBe(0);
    expect(labels()).toEqual([]);
  });

  it('sin respuesta, pero se grabó: sigue como borrado, con su Undo, que pasa el candado', async () => {
    const before = structuredClone(draft);
    fault = 'lost-saved';
    await st().deleteTable('t1');
    expect(deleted('canonical_tables', 't1')).toBe(true);
    expect(labels()).toEqual(['Delete table M_T1']);
    expect(await useUndoStore.getState().undoLast()).toBe('Delete table M_T1');
    expect(deleted('canonical_tables', 't1')).toBe(false);
    expect(draft.sa1.layout).toEqual(before.sa1.layout);
    expect(draft.sa1.routes).toEqual({ r1: R1 });
  });

  it('sin respuesta y no se grabó: no se borró nada, se puede reintentar y no queda Undo', async () => {
    const before = structuredClone(draft);
    fault = 'lost';
    await expect(st().deleteTable('t1')).rejects.toThrow('No response from the server: nothing was deleted. Try again.');
    expect(draft).toEqual(before);
    expect(labels()).toEqual([]);
    await st().deleteTable('t1');                                     // reintentar
    expect(deleted('canonical_tables', 't1')).toBe(true);
    expect(labels()).toEqual(['Delete table M_T1']);
  });

  it('un error del servidor y no se grabó: dice el motivo real (no «sin respuesta»)', async () => {
    fault = 'error-500';
    await expect(st().deleteTable('t1')).rejects.toThrow(
      'Internal server error. Check the logs using the X-Request-ID: nothing was deleted. Try again.');
    expect(deleted('canonical_tables', 't1')).toBe(false);
    expect(labels()).toEqual([]);
  });

  it('grabado sin número y sin nada cargado (solo escrituras propias con número): tampoco admite una ajena', async () => {
    forgetDraftSeqs();
    draftLedger.write(CS);                                             // lo primero que conoce la sesión
    fault = 'saved-uncounted';
    await st().deleteTable('t1');
    expect(labels()).toEqual(['Delete table M_T1']);
    draftLedger.foreign();                                             // otra pestaña
    await expect(useUndoStore.getState().undoLast()).rejects.toBeInstanceOf(StaleUndoError);
  });

  it('grabado, pero sin poder leer el contador: cuenta como lo normal (el servidor cuenta cada lote) y su Undo corre', async () => {
    fault = 'lost-saved';
    vi.mocked(csvc.writeSeqOf).mockRejectedValueOnce(new ApiError(NETWORK, 0, null, '/api/x'));
    await st().deleteTable('t1');
    expect(labels()).toEqual(['Delete table M_T1']);
    expect(await useUndoStore.getState().undoLast()).toBe('Delete table M_T1');
    expect(deleted('canonical_tables', 't1')).toBe(false);
  });

  it('grabado, y la sesión cambia mientras lee el contador: el error original, sin Undo', async () => {
    fault = 'lost-saved';
    const seq = vi.mocked(csvc.writeSeqOf).getMockImplementation()!;
    vi.mocked(csvc.writeSeqOf).mockImplementationOnce(async (cs) => {
      useSessionStore.setState({ activeChangesetId: 'cs2' });
      return seq(cs);
    });
    await expect(st().deleteTable('t1')).rejects.toThrow(NETWORK);
    expect(labels()).toEqual([]);
  });

  it('el margen es exacto: tras «sin respuesta, pero se grabó», una escritura de otra pestaña bloquea el Undo', async () => {
    fault = 'lost-saved';
    await st().deleteTable('t1');
    draftLedger.foreign();                                             // otra pestaña
    await expect(useUndoStore.getState().undoLast()).rejects.toBeInstanceOf(StaleUndoError);
    expect(deleted('canonical_tables', 't1')).toBe(true);
  });

  it('grabado sin número (el servidor no alcanzó a contarlo): su Undo no admite una escritura ajena', async () => {
    fault = 'saved-uncounted';
    await st().deleteTable('t1');
    expect(labels()).toEqual(['Delete table M_T1']);
    draftLedger.foreign();                                             // otra pestaña
    await expect(useUndoStore.getState().undoLast()).rejects.toBeInstanceOf(StaleUndoError);
    expect(deleted('canonical_tables', 't1')).toBe(true);
  });

  it('sin respuesta y sin poder releer: el error original, sin Undo', async () => {
    fault = 'lost-saved';
    tableReadFails = true;
    await expect(st().deleteTable('t1')).rejects.toThrow(NETWORK);
    expect(labels()).toEqual([]);
  });

  it('sin respuesta y la sesión cambia mientras se relee: el error original, sin Undo', async () => {
    const read = vi.mocked(csvc.effective).getMockImplementation()!;
    vi.mocked(csvc.effective).mockImplementation(async (cs, coll, opts) => {
      if (coll === 'canonical_tables') useSessionStore.setState({ activeChangesetId: 'cs2' });
      return read(cs, coll, opts);
    });
    fault = 'lost-saved';
    await expect(st().deleteTable('t1')).rejects.toThrow(NETWORK);
    expect(labels()).toEqual([]);
  });

  it('si la sesión cambia mientras se arma el lote, no se envía nada', async () => {
    const read = vi.mocked(csvc.effective).getMockImplementation()!;
    vi.mocked(csvc.effective).mockImplementation(async (cs, coll, opts) => {
      if (coll === 'subject_areas' && (opts?.ids?.length ?? 0) > 1) {
        useSessionStore.setState({ activeChangesetId: 'cs2' });
      }
      return read(cs, coll, opts);
    });
    const before = structuredClone(draft);
    await expect(st().deleteTable('t1')).rejects.toThrow();
    expect(lots).toEqual([]);
    expect(draft).toEqual(before);
  });

  it('rehacer el borrado con la respuesta perdida pero grabado: lo que vuelve a Undo pasa el candado', async () => {
    await st().deleteTable('t1');
    await useUndoStore.getState().undoLast();
    fault = 'lost-saved';
    expect(await useUndoStore.getState().redoLast()).toBe('Delete table M_T1');
    expect(deleted('canonical_tables', 't1')).toBe(true);
    expect(await useUndoStore.getState().undoLast()).toBe('Delete table M_T1');
    expect(deleted('canonical_tables', 't1')).toBe(false);
  });

  it('rehacer el borrado sin respuesta y sin grabar: nada rehecho, el Redo sigue ahí', async () => {
    await st().deleteTable('t1');
    await useUndoStore.getState().undoLast();
    fault = 'lost';
    await expect(useUndoStore.getState().redoLast()).rejects.toThrow('No response from the server: nothing was redone. Press Redo to try again.');
    expect(deleted('canonical_tables', 't1')).toBe(false);
    expect(await useUndoStore.getState().redoLast()).toBe('Delete table M_T1');
    expect(deleted('canonical_tables', 't1')).toBe(true);
  });

  it('una respuesta perdida sin verificar sigue bloqueando el Undo (no se da por propia)', async () => {
    await st().deleteTable('t1');
    draftLedger.lost(CS);                                              // otra escritura sin respuesta…
    draftLedger.foreign();                                             // …y un número sin dueño
    await expect(useUndoStore.getState().undoLast()).rejects.toBeInstanceOf(StaleUndoError);
  });
});

describe('borrar una tabla con más cambios de los que entran en un envío', () => {
  beforeEach(() => {
    for (let i = 0; i < 1998; i += 1) cols.set(`k${i}`, col(`k${i}`, 't1', { ordinal: i + 2 }));
  });

  it('sigue por partes, como antes: el modelo en tandas, cada canvas aparte y la tabla al final', async () => {
    await st().deleteTable('t1');
    expect(lots.every((l) => l.every((k) => !k.startsWith('subject_areas:')))).toBe(true);
    expect(log.filter((l) => l.startsWith('put:subject_areas:')).sort()).toEqual(['put:subject_areas:sa1', 'put:subject_areas:sa2', 'put:subject_areas:sa3']);
    expect(log[log.length - 1]).toBe('put:canonical_tables:t1');
    expect(deleted('canonical_tables', 't1')).toBe(true);
    expect(draft.sa1.tableIds).toEqual(['t2']);
  });

  it('un Redo por partes que se corta a mitad no se reintenta ni deja un Undo incompleto', async () => {
    await st().deleteTable('t1');
    await useUndoStore.getState().undoLast();
    const put = vi.mocked(csvc.recordChange).getMockImplementation()!;
    vi.mocked(csvc.recordChange).mockImplementation(async (cs, coll, id, op, payload) => {
      if (coll !== 'subject_areas' || id !== 'sa2') return put(cs, coll, id, op, payload);
      vi.mocked(csvc.recordChange).mockImplementation(put);
      draftLedger.lost(cs);                                          // el segundo canvas, sin respuesta
      throw new ApiError(NETWORK, 0, null, '/api/x');
    });
    const err = await useUndoStore.getState().redoLast().catch((e: Error) => e.message);
    expect(err).toMatch(/^Couldn't redo Delete table M_T1: /);
    expect(err).not.toMatch(/try again/i);
    expect(useUndoStore.getState().redoStack).toEqual([]);
    expect(labels()).toEqual([]);
  });

  it('y su Undo también: todo vuelve', async () => {
    const before = structuredClone(draft);
    await st().deleteTable('t1');
    expect(await useUndoStore.getState().undoLast()).toBe('Delete table M_T1');
    expect(deleted('canonical_tables', 't1')).toBe(false);
    expect(deleted('canonical_columns', 'k1997')).toBe(false);
    for (const id of ['sa1', 'sa2', 'sa3']) expect(draft[id].layout).toEqual(before[id].layout);
    expect(draft.sa1.routes).toEqual({ r1: R1 });
  });
});
