// Redo de la membresía del canvas: agregar tablas o vistas y sacar una tabla o
// una vista se deshacen y se rehacen sobre el canvas de la acción — también con
// otro canvas abierto — con la posición, el color y los trazos que el servicio
// dice que salieron. `structure.service` es el real, sobre un draft en memoria
// que sube el contador de escrituras de la versión (`draftLedger`).
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
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let draft: Record<string, SubjectArea>;
const canvas = (over: Partial<SubjectArea>): SubjectArea => ({
  id: 'sa1', projectId: 'p', name: 'Uno', folderId: null, tableIds: [], viewIds: [], layout: {},
  drawings: [], udpValues: {}, routes: {}, colors: {}, ...over,
} as SubjectArea);

const TABLES = ['t1', 't2', 't3'].map((id) => ({ id, physicalName: `M_${id.toUpperCase()}`, logicalName: id }));
const V1 = { id: 'v1', name: 'V_T1', tableId: 't1', sourceTableIds: ['t1'], showOnCanvas: true, sources: [] };
const V2 = { id: 'v2', name: 'V_T2', tableId: 't2', sourceTableIds: ['t2'], showOnCanvas: true, sources: [] };

/** El canvas `saId` abierto en pantalla, tal como está en el draft. Un canvas
 *  sin lista explícita de vistas llega con la lista resuelta (las de sus
 *  fuentes), como la arma el backend. */
function show(saId: string) {
  const sa = structuredClone(draft[saId]);
  if (!Array.isArray(sa.viewIds)) sa.viewIds = [V1, V2].filter((v) => v.sourceTableIds.some((t) => sa.tableIds.includes(t))).map((v) => v.id);
  useModelerStore.setState({
    activeSaId: saId,
    diagram: {
      subjectArea: sa,
      tables: TABLES.filter((t) => sa.tableIds.includes(t.id)),
      columns: [],
      relationships: [{ id: 'r1', parentTableId: 't1', childTableId: 't2', pairs: [] }],
      views: [V1, V2].filter((v) => (sa.viewIds ?? []).includes(v.id)),
    } as never,
  });
}
/** Lo que importa de un canvas para comparar (las listas, sin orden). */
const state = (sa: SubjectArea) => ({
  tableIds: [...sa.tableIds].sort(), viewIds: [...(sa.viewIds ?? [])].sort(),
  layout: sa.layout, routes: sa.routes, colors: sa.colors ?? {},
});

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId: CS });
  useUndoStore.getState().clear();
  useModelerStore.setState({ reload: vi.fn(async () => {}), flow: null });
  draft = {};
  vi.mocked(csvc.effective).mockImplementation(async (_cs, _coll, opts) => {
    const id = opts?.ids?.[0] as string;
    return (draft[id] ? [structuredClone(draft[id])] : []) as never;
  });
  vi.mocked(csvc.recordChange).mockImplementation(async (cs, _coll, id, op, payload) => {
    if (op === 'delete') delete draft[id]; else draft[id] = structuredClone(payload) as unknown as SubjectArea;
    draftLedger.write(cs);
    return {} as never;
  });
});
afterEach(() => { useModelerStore.setState({ reload: realReload }); });

describe('Redo de la membresía del canvas', () => {
  const full = () => canvas({
    tableIds: ['t1', 't2'], viewIds: ['v1', 'v2'],
    layout: { t1: { x: 10, y: 10 }, t2: { x: 400, y: 0 }, v1: { x: 10, y: 300 }, v2: { x: 400, y: 300 } },
    routes: { r1: R }, colors: { t1: 'theme:th1', v1: 'theme:th2' },
  });

  it('sacar una tabla: deshacer la devuelve con su vista huérfana, posición, color y trazos; rehacer la saca otra vez', async () => {
    draft.sa1 = full();
    draft.sa2 = canvas({ id: 'sa2', tableIds: ['t3'], layout: { t3: { x: 1, y: 1 } } });
    const before = state(draft.sa1);
    show('sa1');
    await st().removeTableFromArea('t1');
    const removed = state(draft.sa1);
    expect(removed.tableIds).toEqual(['t2']);
    expect(removed.viewIds).toEqual(['v2']);
    expect(removed.routes).toEqual({});
    await undo();
    expect(state(draft.sa1)).toEqual(before);
    expect(await redo()).toBe('Remove M_T1 from canvas');
    expect(state(draft.sa1)).toEqual(removed);
    // Con otro canvas abierto: deshacer y rehacer siguen siendo del canvas de la acción.
    show('sa2');
    await undo();
    expect(state(draft.sa1)).toEqual(before);
    await redo();
    expect(state(draft.sa1)).toEqual(removed);
    await undo();
    expect(state(draft.sa1)).toEqual(before);
    expect(state(draft.sa2)).toEqual(state(canvas({ id: 'sa2', tableIds: ['t3'], layout: { t3: { x: 1, y: 1 } } })));
  });

  it('sacar una vista: deshacer la devuelve a su sitio con su color; rehacer la saca otra vez', async () => {
    draft.sa1 = full();
    const before = state(draft.sa1);
    show('sa1');
    await st().removeViewFromCanvas('v1');
    const removed = state(draft.sa1);
    expect(removed.viewIds).toEqual(['v2']);
    await undo();
    expect(state(draft.sa1)).toEqual(before);
    await redo();
    expect(state(draft.sa1)).toEqual(removed);
    await undo();
    expect(state(draft.sa1)).toEqual(before);
  });

  it('agregar tablas: deshacer las saca; rehacer las vuelve a poner en su sitio', async () => {
    draft.sa1 = canvas({ tableIds: ['t1'], viewIds: [], layout: { t1: { x: 10, y: 10 } } });
    show('sa1');
    await st().addExistingTables(['t2'], { tables: [TABLES[1]] as never });
    draft.sa1.layout = { ...draft.sa1.layout, t2: { x: 500, y: 20 } };   // el bloque quedó en su sitio
    const added = state(draft.sa1);
    await undo();
    expect(state(draft.sa1).tableIds).toEqual(['t1']);
    expect(await redo()).toBe('Add 1 table to canvas');
    expect(state(draft.sa1)).toEqual(added);
    await undo();
    expect(state(draft.sa1).tableIds).toEqual(['t1']);
  });

  it('agregar vistas: deshacer las saca; rehacer las vuelve a poner', async () => {
    draft.sa1 = canvas({ tableIds: ['t1', 't2'], viewIds: ['v1'], layout: { t1: { x: 10, y: 10 } } });
    show('sa1');
    await st().addViewsToCanvas(['v2']);
    const added = state(draft.sa1);
    expect(added.viewIds).toEqual(['v1', 'v2']);
    await undo();
    expect(state(draft.sa1).viewIds).toEqual(['v1']);
    await redo();
    expect(state(draft.sa1)).toEqual(added);
  });

  it('mover un bloque y pulsar Redo antes de que se grabe: no rehace (la versión cambió después del Undo)', async () => {
    draft.sa1 = full();
    show('sa1');
    await st().removeViewFromCanvas('v1');
    await undo();
    const write = vi.mocked(csvc.recordChange).getMockImplementation()!;
    vi.mocked(csvc.recordChange).mockImplementationOnce(async (...a) => { await sleep(30); return write(...a); });
    const moving = st().saveNodePositions({ t2: { x: 420, y: 10 } });
    await expect(redo()).rejects.toThrow("This version changed after the undo: there's nothing to redo.");
    await moving;
    expect(state(draft.sa1).viewIds).toEqual(['v1', 'v2']);
    expect(draft.sa1.layout.t2).toEqual({ x: 420, y: 10 });
    expect(useUndoStore.getState().redoStack).toEqual([]);
  });

  it('un canvas sin lista explícita de vistas sigue sin ella al deshacer y rehacer sacar una tabla sin vistas', async () => {
    draft.sa1 = canvas({ tableIds: ['t1', 't3'], viewIds: undefined, layout: { t1: { x: 10, y: 10 }, t3: { x: 300, y: 10 } } });
    show('sa1');
    await st().removeTableFromArea('t3');
    expect(draft.sa1.viewIds).toBeUndefined();
    await undo();
    expect(draft.sa1.tableIds.includes('t3') && draft.sa1.viewIds === undefined).toBe(true);
    await redo();
    expect(draft.sa1.viewIds).toBeUndefined();
    await undo();
    expect(draft.sa1.viewIds).toBeUndefined();
  });
});

