// `reload()` (la recarga que cierra casi toda acción del canvas) no pisa una
// apertura de canvas en vuelo: si subiera `_loadSeq`, la invalidaría y dejaría
// `openingSaId` pegado (spinner fijo; el Explorer ignora los clics mientras
// tanto). Los casos: un clic en otro canvas justo después de un guardado, y la
// cola `await reload()` de un flujo de la sesión anterior mientras el refresco
// de la nueva reabre el canvas.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock('../features/modeler/services/structure.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/modeler/services/structure.service')>();
  const { canvasLotStub } = await import('./canvasLot.testutil');
  const gov = await import('@/services/governance.service');
  return {
    ...actual,
    listProjects: vi.fn(async () => [{ id: 'p1', name: 'Uno' }]), listFolders: vi.fn(async () => []),
    listSubjectAreas: vi.fn(async () => [{ id: 'sa1', projectId: 'p1', name: 'C', folderId: null, tableIds: ['t1'], layout: {} }]),
    projectDeletionPending: vi.fn(async () => false),
    addToCanvas: vi.fn(async () => ({ tableIds: [], viewIds: [] })),
    // El envío único (doc 133 §4): sus cambios del modelo llegan al lote del modelo
    // de esta prueba; lo que suma al canvas, a `planCanvasAdd`.
    planCanvasAdd: vi.fn(actual.planCanvasAdd),
    canvasLot: vi.fn(canvasLotStub((changes) => gov.recordChangesBulk(changes))),
  };
});
vi.mock('../features/modeler/services/schemas.service', () => ({ listSchemas: vi.fn(async () => []) }));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return { ...actual, createTable: vi.fn(async () => ({})), recordChangesBulk: vi.fn(async () => ({})) };
});

import * as mod from '../features/modeler/services/modeler.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const st = () => useModelerStore.getState();
const dia = (id: string, tag = id) => ({
  subjectArea: { id, projectId: 'p1', name: id, tableIds: ['t1'], layout: {}, drawings: [{ id: `d-${tag}`, type: 'rect', x: 0, y: 0, w: 1, h: 1 }] },
  tables: [{ id: 't1', physicalName: `T_${tag}` }], columns: [], relationships: [], views: [],
});

beforeEach(async () => {
  vi.clearAllMocks();
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  vi.mocked(mod.loadDiagram).mockImplementation(async (id: string) => dia(id, id === 'sa1' ? 'A' : id) as never);
  useModelerStore.setState({ activeProjectId: 'p1', activeSaId: null, diagram: null, openingSaId: null, trees: {}, projects: [] });
  await st().selectSubjectArea('sa1');
  useModelerStore.setState({ selectedTableId: 't1' });
});
afterEach(async () => { await sleep(5); });

describe('reload() no pisa una apertura de canvas en vuelo', () => {
  it('clic en otro canvas + recarga del actual (fin de un guardado): se abre el nuevo y el spinner se apaga', async () => {
    const lateX = deferred<unknown>();
    vi.mocked(mod.loadDiagram).mockImplementation(async (id: string) => (id === 'X' ? lateX.promise : dia(id)) as never);
    const click = st().selectSubjectArea('X', 'p1');   // ModelExplorer
    await st().reload();                                // p. ej. saveDescriptionOnBlur → reload()
    lateX.resolve(dia('X'));
    await click;
    expect({ activeSaId: st().activeSaId, openingSaId: st().openingSaId }).toEqual({ activeSaId: 'X', openingSaId: null });
  });

  it('la cola `await reload()` de la sesión anterior no rompe la reapertura del refresco de la nueva', async () => {
    const refreshLoad = deferred<unknown>();
    vi.mocked(mod.loadDiagram).mockImplementationOnce(() => refreshLoad.promise as never)   // la del refresco (cs2)
      .mockImplementationOnce(async () => dia('sa1', 'B') as never);                         // la del reload tardío
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    const r = st().refreshExplorer();
    await sleep(5);
    expect(st().openingSaId).toBe('sa1');
    await st().reload();                               // cola de un flujo de cs1
    refreshLoad.resolve(dia('sa1', 'B'));
    await r;
    expect({
      table: st().diagram?.tables[0]?.physicalName, drawings: st().drawings.map((d) => d.id),
      selectedTableId: st().selectedTableId, openingSaId: st().openingSaId,
    }).toEqual({ table: 'T_B', drawings: ['d-B'], selectedTableId: null, openingSaId: null });
  });

  it('crear una tabla: si la sesión cambia mientras recarga, no la selecciona en la nueva', async () => {
    const lateReload = deferred<unknown>();
    vi.mocked(mod.loadDiagram).mockImplementationOnce(() => lateReload.promise as never);
    const create = st().createTable({ logicalName: 'nueva', physicalName: 'M_NUEVA' });
    await sleep(5);                                     // grabó; recarga
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    lateReload.resolve(dia('sa1'));
    await create;
    expect(st().selectedTableId).toBeNull();
  });
});

// Sin cambio de sesión: el Refresh del Explorer reabre el mismo canvas y,
// mientras su diagrama viaja, termina una edición y pide `reload()`. La recarga
// se hace al terminar la apertura; si se omitiera (por haber una apertura en
// vuelo), quedaría la foto que la reapertura pidió antes del guardado y, si el
// cambio fuera estructural, el Explorer no se enteraría.
describe('reload() durante la reapertura del mismo canvas se hace al terminar', () => {
  const structural = (id: string, tag: string, extra: boolean) => ({
    ...dia(id, tag),
    tables: [{ id: 't1', physicalName: `T_${tag}` }, ...(extra ? [{ id: 't2', physicalName: 'T_NUEVA' }] : [])],
  });

  it('la foto desactualizada de la reapertura no queda: al final está lo guardado', async () => {
    const reopen = deferred<unknown>();
    vi.mocked(mod.loadDiagram).mockImplementationOnce(() => reopen.promise as never);
    const r = st().refreshExplorer();
    await sleep(0); await sleep(0);
    expect(st().openingSaId).toBe('sa1');
    vi.mocked(mod.loadDiagram).mockImplementation(async (id: string) => dia(id, 'NUEVO') as never);
    await st().reload();                               // la edición terminó (el servidor ya tiene lo nuevo)
    reopen.resolve(dia('sa1', 'VIEJO'));               // foto previa al guardado
    await r;
    expect(st().diagram?.tables[0]?.physicalName).toBe('T_NUEVO');
    expect(st().openingSaId).toBeNull();
  });

  it('cambio estructural: el Explorer se entera una vez (la reapertura trajo la foto desactualizada)', async () => {
    const reopen = deferred<unknown>();
    vi.mocked(mod.loadDiagram).mockImplementationOnce(() => reopen.promise as never);
    const tick0 = st().explorerTick;
    const r = st().refreshExplorer();
    await sleep(0); await sleep(0);
    vi.mocked(mod.loadDiagram).mockImplementation(async (id: string) => structural(id, 'A', true) as never);
    await st().reload();                               // p. ej. se creó una tabla
    reopen.resolve(structural('sa1', 'A', false));
    await r;
    expect(st().diagram?.tables.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(st().explorerTick - tick0).toBe(1);
  });

  it('cambio estructural: también si la reapertura ya trajo lo nuevo', async () => {
    const reopen = deferred<unknown>();
    vi.mocked(mod.loadDiagram).mockImplementationOnce(() => reopen.promise as never);
    const tick0 = st().explorerTick;
    const r = st().refreshExplorer();
    await sleep(0); await sleep(0);
    vi.mocked(mod.loadDiagram).mockImplementation(async (id: string) => structural(id, 'A', true) as never);
    await st().reload();
    reopen.resolve(structural('sa1', 'A', true));
    await r;
    expect(st().explorerTick - tick0).toBe(1);
  });

  it('pendiente en una sesión que se cerró: la reapertura de la nueva no la hereda', async () => {
    const reopen = deferred<unknown>();
    vi.mocked(mod.loadDiagram).mockImplementationOnce(() => reopen.promise as never);
    const r = st().refreshExplorer();
    await sleep(0); await sleep(0);
    await st().reload();                               // pendiente en cs1
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    const loads = vi.mocked(mod.loadDiagram).mock.calls.length;
    await st().refreshExplorer();                      // la de cs2 reabre sa1
    reopen.resolve(dia('sa1'));
    await r;
    expect(vi.mocked(mod.loadDiagram).mock.calls.length - loads).toBe(1);
  });

  it('si la reapertura falla, no se reintenta con la recarga pendiente', async () => {
    let fail!: (e: unknown) => void;
    vi.mocked(mod.loadDiagram).mockImplementationOnce(() => new Promise((_, rej) => { fail = rej; }) as never);
    const r = st().refreshExplorer().catch(() => {});
    await sleep(0); await sleep(0);
    await st().reload();
    const loads = vi.mocked(mod.loadDiagram).mock.calls.length;
    fail(new Error('sin red'));
    await r;
    expect(vi.mocked(mod.loadDiagram).mock.calls.length - loads).toBe(0);
  });

  it('sin edición en vuelo, la reapertura no recarga de más', async () => {
    const loads = vi.mocked(mod.loadDiagram).mock.calls.length;
    await st().refreshExplorer();
    expect(vi.mocked(mod.loadDiagram).mock.calls.length - loads).toBe(1);
  });
});
