// Quitar un grupo de tablas del canvas (doc 134 §3.8): una sola escritura del
// canvas con las N tablas, sus posiciones, colores y trazos, y las vistas que
// quedan sin fuente aquí; un solo Undo que las repone y un Redo que las vuelve a
// sacar. `structure.service` es el real, sobre un draft en memoria.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/changeset.service', async (orig) => ({
  ...(await import('@/store/draftLedger.testutil')).withDraftLedger(await orig()),
  effective: vi.fn(), recordChange: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock('../features/modeler/services/modeler.service', () => ({
  loadDiagram: vi.fn(), listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(async () => []), listProjects: vi.fn(async () => []),
}));
vi.mock('@/services/views.service', () => ({ listViewsForTables: vi.fn(async () => []) }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import * as csvc from '@/services/changeset.service';
import type { SubjectArea } from '../features/modeler/services/modeler.service';
import { draftLedger } from './draftLedger.testutil';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';

const CS = 'cs1';
const R = [{ x: 200, y: 40 }, { x: 200, y: 160 }];
const realReload = useModelerStore.getState().reload;
const st = () => useModelerStore.getState();
const undo = () => useUndoStore.getState().undoLast();
const redo = () => useUndoStore.getState().redoLast();

let draft: Record<string, SubjectArea>;
let writes = 0;
const TABLES = ['t1', 't2', 't3', 't4'].map((id) => ({ id, physicalName: `M_${id.toUpperCase()}`, logicalName: id }));
// v1 sale de t1 y t2 (queda sin fuente al quitar las dos); v2 de t2 y t4 (t4 queda).
const V1 = { id: 'v1', name: 'V_12', tableId: 't1', sourceTableIds: ['t1', 't2'], showOnCanvas: true, sources: [] };
const V2 = { id: 'v2', name: 'V_24', tableId: 't2', sourceTableIds: ['t2', 't4'], showOnCanvas: true, sources: [] };

function show() {
  const sa = structuredClone(draft.sa1);
  useModelerStore.setState({
    activeSaId: 'sa1',
    diagram: {
      subjectArea: sa,
      tables: TABLES.filter((t) => sa.tableIds.includes(t.id)),
      columns: [],
      relationships: [{ id: 'r1', parentTableId: 't1', childTableId: 't3', pairs: [] }, { id: 'r2', parentTableId: 't2', childTableId: 't4', pairs: [] }],
      views: [V1, V2].filter((v) => (sa.viewIds ?? []).includes(v.id)),
    } as never,
  });
}
const state = (sa: SubjectArea) => ({
  tableIds: [...sa.tableIds].sort(), viewIds: [...(sa.viewIds ?? [])].sort(),
  layout: sa.layout, routes: sa.routes, colors: sa.colors ?? {},
});

beforeEach(() => {
  vi.clearAllMocks();
  writes = 0;
  useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId: CS });
  useUndoStore.getState().clear();
  useModelerStore.setState({ reload: vi.fn(async () => { show(); }), flow: null, viewMode: 'physical' });
  draft = {
    sa1: {
      id: 'sa1', projectId: 'p', name: 'Uno', folderId: null, tableIds: ['t1', 't2', 't3', 't4'], viewIds: ['v1', 'v2'],
      layout: { t1: { x: 0, y: 0 }, t2: { x: 400, y: 0 }, t3: { x: 0, y: 300 }, t4: { x: 400, y: 300 }, v1: { x: 800, y: 0 }, v2: { x: 800, y: 300 } },
      drawings: [], udpValues: {}, routes: { r1: R, r2: R }, colors: { t1: '#FF0000', v1: '#00FF00' },
    } as SubjectArea,
  };
  vi.mocked(csvc.effective).mockImplementation(async (_cs, _coll, opts) => {
    const id = opts?.ids?.[0] as string;
    return (draft[id] ? [structuredClone(draft[id])] : []) as never;
  });
  vi.mocked(csvc.recordChange).mockImplementation(async (cs, _coll, id, op, payload) => {
    writes += 1;
    if (op === 'delete') delete draft[id]; else draft[id] = structuredClone(payload) as unknown as SubjectArea;
    draftLedger.write(cs);
    return {} as never;
  });
  show();
});
afterEach(() => { useModelerStore.setState({ reload: realReload }); });

describe('removeTablesFromArea', () => {
  it('una escritura: las tablas, la vista que queda sin fuente, sus trazos; el Undo las repone y el Redo las saca', async () => {
    const before = state(draft.sa1);
    await st().removeTablesFromArea(['t1', 't2']);
    expect(writes).toBe(1);
    const removed = state(draft.sa1);
    expect(removed.tableIds).toEqual(['t3', 't4']);
    expect(removed.viewIds).toEqual(['v2']);
    expect(removed.routes).toEqual({});
    expect(Object.keys(removed.layout).sort()).toEqual(['t3', 't4', 'v2']);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Remove 2 tables from canvas']);
    writes = 0;
    await undo();
    expect(writes).toBe(1);
    expect(state(draft.sa1)).toEqual(before);
    expect(await redo()).toBe('Remove 2 tables from canvas');
    expect(state(draft.sa1)).toEqual(removed);
  });

  it('las que salen dejan el grupo; si queda una sola, ya no hay grupo', async () => {
    useModelerStore.setState({ groupIds: ['t1', 't2', 't3'] });
    await st().removeTablesFromArea(['t1']);
    expect(st().groupIds).toEqual(['t2', 't3']);
    await st().removeTablesFromArea(['t2']);
    expect(st().groupIds).toEqual([]);
  });

  it('una sola tabla sigue siendo «Remove M_T1 from canvas»', async () => {
    await st().removeTablesFromArea(['t1']);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Remove M_T1 from canvas']);
    expect(state(draft.sa1).tableIds).toEqual(['t2', 't3', 't4']);
  });
});
