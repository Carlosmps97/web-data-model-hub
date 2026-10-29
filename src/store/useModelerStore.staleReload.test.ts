// Tras un `reload()` que falla por la red, un timeout o un 5xx, lo que hay en
// pantalla es anterior a la escritura que acaba de terminar: editar desde ahí
// pisaría lo grabado (el store y también los paneles y popups, que arman el
// documento completo con el diagrama). Por eso el canvas se cierra con el aviso
// «Couldn't reload the canvas: … Open it again from the explorer.» y, sin
// diagrama en pantalla, no hay camino que edite datos desactualizados. Una caída
// = un aviso.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}
type Doc = Record<string, unknown> & { id: string; tableId: string; ordinal: number };
let server: Record<string, Doc> = {};
vi.mock('@/services/changeset.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/changeset.service')>();
  return {
    ...actual, effective: vi.fn(async () => []),
    // El lote (borrar una columna) se aplica como sus cambios uno a uno.
    recordChangesBulk: vi.fn(async (_cs: string, changes: { entityId: string; op: string; payload?: Doc }[]) => {
      for (const c of changes) { if (c.op === 'delete') delete server[c.entityId]; else server[c.entityId] = { ...c.payload! }; }
      return {};
    }),
    recordChange: vi.fn(async (_cs: string, _coll: string, id: string, op: string, payload: Doc) => {
      if (op === 'delete') delete server[id]; else server[id] = { ...payload };
      return {};
    }),
  };
});
let rels: Record<string, unknown>[] = [];
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return {
    ...actual,
    listRelationships: vi.fn(async (tid: string) => rels.filter((r) => r.parentTableId === tid || r.childTableId === tid).map((r) => structuredClone(r))),
    listColumns: vi.fn(async (tid: string) => Object.values(server).filter((c) => c.tableId === tid).map((c) => ({ ...c }))),
    currentColumns: vi.fn(async (ids: string[]) => Object.values(server).filter((c) => ids.includes(c.id)).map((c) => ({ ...c }))),
    tableUsage: vi.fn(async () => ({ usage: [], total: 0 })),
    listDomains: vi.fn(async () => []),
  };
});
vi.mock('@/services/views.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/views.service')>();
  return { ...actual, listViews: vi.fn(async () => []), updateView: vi.fn(async () => ({})) };
});
vi.mock('../features/modeler/services/structure.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/modeler/services/structure.service')>();
  return {
    ...actual, listProjects: vi.fn(), listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(), projectDeletionPending: vi.fn(async () => false),
    setSubjectAreaLayout: vi.fn(async () => ({})), setSubjectAreaDrawings: vi.fn(async () => ({})),
  };
});
vi.mock('../features/modeler/services/schemas.service', () => ({ listSchemas: vi.fn(async () => []) }));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import { toast } from 'sonner';
import { ApiError } from '@/services/http';
import * as struct from '../features/modeler/services/structure.service';
import * as mod from '../features/modeler/services/modeler.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';

const st = () => useModelerStore.getState();
const tick = () => new Promise((r) => setTimeout(r, 0));
const SA = (id: string) => ({ id, projectId: 'p1', name: id, folderId: null, tableIds: id === 'sa1' ? ['t1'] : [], layout: {} });
const diaA = () => ({
  subjectArea: SA('sa1'), tables: [{ id: 't1', logicalName: 't', physicalName: 'T1' }],
  columns: Object.values(server).map((c) => ({ ...c })), relationships: [], views: [],
});
const flaky = () => new ApiError("The server didn't respond within 30s — try again in a moment.", 0, null, '/api/subject-areas/sa1/diagram?changesetId=cs1');
const CLOSED = "Couldn't reload the canvas: The server didn't respond within 30s. Open it again from the explorer.";
const shown = () => vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));

beforeEach(async () => {
  vi.clearAllMocks();
  rels = [];
  server = {
    c1: { id: 'c1', tableId: 't1', logicalName: 'a', physicalName: 'A', dataType: 'INT', typeOverridden: false, ordinal: 0, description: 'old' },
    c2: { id: 'c2', tableId: 't1', logicalName: 'b', physicalName: 'B', dataType: 'INT', typeOverridden: false, ordinal: 1 },
  };
  vi.mocked(struct.listProjects).mockResolvedValue([{ id: 'p1', name: 'Uno' }] as never);
  vi.mocked(struct.listSubjectAreas).mockResolvedValue([SA('sa1'), SA('sa2')] as never);
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useModelerStore.setState({ projects: [{ id: 'p1', name: 'Uno' } as never], activeProjectId: 'p1', activeSaId: null, diagram: null, trees: {}, folders: [], subjectAreas: [SA('sa1'), SA('sa2')] as never, openingSaId: null, flow: null });
  vi.mocked(mod.loadDiagram).mockImplementation(async () => diaA() as never);
  await st().selectSubjectArea('sa1');
});
afterEach(async () => { await new Promise((r) => setTimeout(r, 5)); });

describe('un reload fallido cierra el canvas con aviso', () => {
  it('lo grabado queda; el canvas se cierra y lo dice; la edición siguiente no sale del diagrama desactualizado', async () => {
    vi.mocked(mod.loadDiagram).mockRejectedValueOnce(flaky());
    await st().updateColumn('c1', { description: 'new' });
    expect(server.c1.description).toBe('new');
    expect({ activeSaId: st().activeSaId, diagram: st().diagram }).toEqual({ activeSaId: null, diagram: null });
    expect(shown()).toEqual([CLOSED]);
    await st().updateColumn('c1', { isNullable: false });          // sin canvas: nada que editar
    expect(server.c1.description).toBe('new');
    expect(server.c1.isNullable).toBeUndefined();
  });

  it('una columna recién borrada no revive', async () => {
    vi.mocked(mod.loadDiagram).mockRejectedValueOnce(flaky());
    await st().deleteColumn('c2');
    expect(server.c2).toBeUndefined();
    await st().updateColumn('c2', { description: 'x' });
    expect(server.c2).toBeUndefined();
  });

  it('el reorden, Save y los guardados de fondo no escriben nada', async () => {
    vi.mocked(mod.loadDiagram).mockRejectedValueOnce(flaky());
    await st().updateColumn('c1', { description: 'new' });
    const { recordChange } = await import('@/services/changeset.service');
    vi.mocked(recordChange).mockClear();
    await st().reorderColumns('t1', ['c2', 'c1']);
    await st().saveAll();
    await st().saveNodePositions({ t1: { x: 5, y: 5 } });
    expect(vi.mocked(recordChange)).not.toHaveBeenCalled();
    expect(struct.setSubjectAreaLayout).not.toHaveBeenCalled();
    expect(server.c1).toMatchObject({ description: 'new', ordinal: 0 });
  });

  it('reabrirlo desde el Explorer vuelve a editar (sin reintento automático)', async () => {
    vi.mocked(mod.loadDiagram).mockRejectedValueOnce(flaky());
    await st().updateColumn('c1', { description: 'new' });
    const loads = vi.mocked(mod.loadDiagram).mock.calls.length;
    await tick(); await tick();
    expect(vi.mocked(mod.loadDiagram).mock.calls.length).toBe(loads);   // nadie reintenta solo
    await st().selectSubjectArea('sa1');
    await st().updateColumn('c1', { isNullable: false });
    expect(server.c1).toMatchObject({ description: 'new', isNullable: false });
  });

  it('falla la apertura de otro canvas y también la recarga pendiente: se cierra con un aviso (el de la apertura)', async () => {
    const openB = deferred<unknown>();
    let writeGate!: () => void;
    const { recordChange } = await import('@/services/changeset.service');
    vi.mocked(recordChange).mockImplementationOnce(((_cs: string, _c: string, id: string, _op: string, payload: Doc) =>
      new Promise((r) => { writeGate = () => { server[id] = { ...payload }; r({}); }; })) as never);
    const edit = st().updateColumn('c1', { description: 'new' });
    await tick();
    vi.mocked(mod.loadDiagram).mockImplementation(async (id: string) => (id === 'sa2' ? openB.promise : Promise.reject(flaky())) as never);
    const opening = st().selectSubjectArea('sa2').then(() => null, (e: unknown) => e);
    writeGate();
    await edit;                                                   // su reload queda pendiente
    openB.reject(new ApiError("Couldn't reach the server — check your connection or reload the page.", 0, null, '/api/subject-areas/sa2/diagram'));
    const err = await opening;
    expect(err).toBeInstanceOf(ApiError);                         // el Explorer avisa «Couldn't open the canvas…»
    expect(shown()).toEqual([]);                                  // …y el store no suma otro
    expect({ activeSaId: st().activeSaId, diagram: st().diagram }).toEqual({ activeSaId: null, diagram: null });
    expect(server.c1.description).toBe('new');
    // Lo callado fue solo esa recarga: la siguiente que falla avisa.
    vi.mocked(mod.loadDiagram).mockImplementation(async () => diaA() as never);
    await st().selectSubjectArea('sa1');
    vi.mocked(mod.loadDiagram).mockRejectedValueOnce(flaky());
    await st().reload();
    expect(shown()).toEqual([CLOSED]);
  });

  it('si la recarga pendiente anda, el canvas editado queda al día (y solo avisa la apertura)', async () => {
    const openB = deferred<unknown>();
    let writeGate!: () => void;
    const { recordChange } = await import('@/services/changeset.service');
    vi.mocked(recordChange).mockImplementationOnce(((_cs: string, _c: string, id: string, _op: string, payload: Doc) =>
      new Promise((r) => { writeGate = () => { server[id] = { ...payload }; r({}); }; })) as never);
    const edit = st().updateColumn('c1', { description: 'new' });
    await tick();
    vi.mocked(mod.loadDiagram).mockImplementation(async (id: string) => (id === 'sa2' ? openB.promise : diaA()) as never);
    const opening = st().selectSubjectArea('sa2').then(() => null, (e: unknown) => e);
    writeGate();
    await edit;
    openB.reject(new Error('Network error'));
    await opening;
    expect(st().activeSaId).toBe('sa1');
    expect(st().diagram?.columns.find((c) => c.id === 'c1')?.description).toBe('new');
    expect(shown()).toEqual([]);
  });
});

describe('el Inspector sin canvas sigue borrando con su pre-imagen', () => {
  it('la hija FK se re-graba con su documento del servidor', async () => {
    server.cB = { id: 'cB', tableId: 't1', logicalName: 'fk', physicalName: 'FK', dataType: 'INT', typeOverridden: false, ordinal: 2, isForeignKey: true, description: 'old' };
    rels = [{ id: 'r1', parentTableId: 't1', childTableId: 't1', identifying: false, parentCardinality: 'one', childCardinality: 'many', pairs: [{ parentColumnId: 'c1', childColumnId: 'cB' }] }];
    await st().reload();
    vi.mocked(mod.loadDiagram).mockRejectedValueOnce(flaky());
    await st().updateColumn('cB', { description: 'new' });        // grabado; el canvas se cerró
    await st().deleteColumn('c1', ['r1'], { col: { ...server.c1 } as never });
    expect(server.cB).toMatchObject({ isForeignKey: false, description: 'new' });
  });
});

// Un dibujo editado dentro de los 500 ms del debounce se perdería si el canvas
// se cierra (el disparo con debounce no escribe con otro canvas —o ninguno—
// abierto): al cerrarlo se guarda en el acto, como al cambiar de canvas.
describe('cerrar el canvas no pierde un dibujo del debounce', () => {
  it('el reload que falla guarda primero los dibujos pendientes del canvas', async () => {
    const shape = { id: 'd1', type: 'rect', x: 1, y: 2, w: 3, h: 4 };
    useModelerStore.setState({ drawings: [shape] as never });
    st().persistDrawings();                                          // agenda el guardado (500 ms)
    vi.mocked(mod.loadDiagram).mockRejectedValueOnce(flaky());
    await st().reload();
    expect(st().activeSaId).toBeNull();
    expect(struct.setSubjectAreaDrawings).toHaveBeenCalledWith('sa1', [shape]);
  });

  it('con el 404 (el canvas no existe) no hay nada que guardar', async () => {
    useModelerStore.setState({ drawings: [{ id: 'd1' }] as never });
    st().persistDrawings();
    vi.mocked(mod.loadDiagram).mockRejectedValueOnce(new ApiError('Not found', 404, null, '/api/subject-areas/sa1/diagram'));
    await st().reload();
    await new Promise((r) => setTimeout(r, 600));
    expect(struct.setSubjectAreaDrawings).not.toHaveBeenCalled();
  });
});
