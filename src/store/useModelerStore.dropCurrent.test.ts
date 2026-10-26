// Soltar una fila en el bloque (TableNode → `applyCanvasDrop`) graba la llave y
// después reordena. La llave se aplica sobre el diagrama vigente y solo si sigue
// siendo el mismo canvas, y cada escritura lleva el documento vigente de la
// columna. Si el set optimista reinstalara el diagrama capturado al empezar y el
// reorden re-grabara el documento completo de cada columna tomado de ese diagrama:
//  · mismo canvas: si mientras se graba la llave termina otra edición (el
//    debounce de la descripción del panel) y su reload trae lo último, el set
//    volvería al estado previo y el reorden pisaría la edición en el servidor;
//  · otro canvas (misma sesión): pintaría A con `activeSaId` = B, y un arrastre
//    en esa ventana grabaría bloques de A en el layout de B.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
type Doc = Record<string, unknown> & { id: string; tableId: string; ordinal: number };
let server: Record<string, Doc> = {};
/** Escritura de la llave de `holdId` en vuelo (se resuelve a mano). */
let hold: { id: string; gate: ReturnType<typeof deferred<unknown>> } | null = null;
vi.mock('@/services/changeset.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/changeset.service')>();
  return {
    ...actual, effective: vi.fn(async () => []),
    // El lote (borrar una columna) se aplica como sus cambios uno a uno.
    recordChangesBulk: vi.fn(async (_cs: string, changes: { entityId: string; op: string; payload?: Doc }[]) => {
      for (const c of changes) { if (c.op === 'delete') delete server[c.entityId]; else server[c.entityId] = { ...c.payload! }; }
      return {};
    }),
    recordChange: vi.fn((_cs: string, _coll: string, id: string, op: string, payload: Doc) => {
      const save = () => { if (op === 'delete') delete server[id]; else server[id] = { ...payload }; return {}; };
      if (hold && hold.id === id && payload?.isPrimaryKey) { const g = hold.gate; hold = null; return g.promise.then(save); }
      return Promise.resolve(save());
    }),
  };
});
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return { ...actual, listColumns: vi.fn(async (tid: string) => Object.values(server).filter((c) => c.tableId === tid).map((c) => ({ ...c }))) };
});
vi.mock('@/services/views.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/views.service')>();
  return { ...actual, listViews: vi.fn(async () => []), updateView: vi.fn(async () => ({})) };
});
vi.mock('../features/modeler/services/structure.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/modeler/services/structure.service')>();
  return { ...actual, setSubjectAreaLayout: vi.fn(async () => ({})) };
});
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import * as csvc from '@/services/changeset.service';
import * as struct from '../features/modeler/services/structure.service';
import * as mod from '../features/modeler/services/modeler.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';

const st = () => useModelerStore.getState();
const tick = () => new Promise((r) => setTimeout(r, 0));
const col = (id: string, ordinal: number, extra: object = {}): Doc =>
  ({ id, tableId: 't1', logicalName: id, physicalName: id.toUpperCase(), dataType: 'INT', typeOverridden: false, ordinal, ...extra });
const SA = (id: string, tableIds: string[]) => ({ id, projectId: 'p1', name: id, folderId: null, tableIds, layout: {} });
const dia = (sa: string) => (sa === 'sa1'
  ? { subjectArea: SA('sa1', ['t1']), tables: [{ id: 't1', logicalName: 't', physicalName: 'T1' }], columns: Object.values(server).map((c) => ({ ...c })), relationships: [], views: [] }
  : { subjectArea: SA('sa2', ['t9']), tables: [{ id: 't9', logicalName: 'n', physicalName: 'T9' }], columns: [], relationships: [], views: [] });
/** Suelta la fila: la escritura de la llave de `holdId` queda en vuelo. */
function drop(plan: object, holdId: string) {
  hold = { id: holdId, gate: deferred() };
  const gate = hold.gate;
  const p = st().applyCanvasDrop('t1', plan as never);
  return { p, release: () => gate.resolve({}) };
}

beforeEach(async () => {
  vi.clearAllMocks();
  hold = null;
  server = { c1: col('c1', 0), c2: col('c2', 1), c3: col('c3', 2) };
  vi.mocked(mod.loadDiagram).mockImplementation(async (id: string) => dia(id) as never);
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useModelerStore.setState({ projects: [{ id: 'p1', name: 'Uno' } as never], activeProjectId: 'p1', activeSaId: null, diagram: null, openingSaId: null, flow: null });
  await st().selectSubjectArea('sa1');
});
afterEach(async () => { await new Promise((r) => setTimeout(r, 5)); });

describe('el drop trabaja sobre lo vigente', () => {
  it('mismo canvas: otra edición termina mientras se graba la llave — el reorden no la pisa', async () => {
    const d = drop({ key: [{ id: 'c3', isPrimaryKey: true }], order: ['c3', 'c1', 'c2'] }, 'c3');
    await tick();
    await st().updateColumn('c1', { description: 'nueva' });   // debounce del panel + su reload
    d.release();
    await d.p;
    expect(server.c1.description).toBe('nueva');
    expect(server.c1.ordinal).toBe(1);
    expect(st().diagram?.columns.find((c) => c.id === 'c1')?.description).toBe('nueva');
  });

  it('llave de dos columnas: la segunda se graba con su documento vigente', async () => {
    const d = drop({ key: [{ id: 'c1', isPrimaryKey: true }, { id: 'c2', isPrimaryKey: true }], order: null }, 'c1');
    await tick();
    await st().updateColumn('c2', { description: 'nueva' });
    d.release();
    await d.p;
    expect(server.c2).toMatchObject({ isPrimaryKey: true, description: 'nueva' });
  });

  it('otro canvas (misma sesión): no pinta A bajo B ni graba sus bloques en el layout de B', async () => {
    const d = drop({ key: [{ id: 'c2', isPrimaryKey: true }], order: null }, 'c2');
    await tick();
    await st().selectSubjectArea('sa2');
    const reloadB = deferred<unknown>();
    vi.mocked(mod.loadDiagram).mockImplementation(() => reloadB.promise as never);
    d.release();
    await tick();
    expect(st().diagram?.subjectArea.id).toBe('sa2');                 // en la ventana: el canvas abierto
    await st().saveNodePositions({ t1: { x: 10, y: 20 } });            // un arrastre en esa ventana
    reloadB.resolve(dia('sa2'));
    await d.p;
    expect(vi.mocked(struct.setSubjectAreaLayout).mock.calls.filter(([sa, l]) => sa === 'sa2' && 't1' in (l as object))).toEqual([]);
  });

  it('otro canvas con orden: el reorden no se pierde (se arma con las columnas del modelo)', async () => {
    const d = drop({ key: [{ id: 'c3', isPrimaryKey: true }], order: ['c3', 'c1', 'c2'] }, 'c3');
    await tick();
    await st().selectSubjectArea('sa2');                               // t1 no está en B
    d.release();
    await d.p;
    expect([server.c3.ordinal, server.c1.ordinal, server.c2.ordinal]).toEqual([0, 1, 2]);
    expect(server.c3.isPrimaryKey).toBe(true);
    expect(st().diagram?.subjectArea.id).toBe('sa2');
  });
});

describe('el reorden trabaja sobre lo vigente en cada escritura', () => {
  const eight = () => Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k${i}`, col(`k${i}`, i)]));

  it('una edición que termina entre tandas (de a 5) no la pisa la tanda siguiente', async () => {
    server = eight();
    await st().reload();
    const gate = deferred<unknown>();
    vi.mocked(csvc.recordChange).mockImplementationOnce((async (...a: unknown[]) => { await gate.promise; server[a[2] as string] = { ...(a[4] as Doc) }; return {}; }) as never);
    const order = Array.from({ length: 8 }, (_, i) => `k${7 - i}`);   // al revés: se mueven las 8
    const r = st().reorderColumns('t1', order);
    await tick();
    await st().updateColumn('k0', { description: 'nueva' });          // k0 va en la 2.ª tanda
    gate.resolve({});
    await r;
    expect(server.k0).toMatchObject({ description: 'nueva', ordinal: 7 });
  });

  it('el Undo del reorden solo devuelve el orden (no pisa una edición posterior)', async () => {
    await st().reorderColumns('t1', ['c2', 'c1', 'c3']);
    await st().updateColumn('c1', { description: 'nueva' });
    const { useUndoStore } = await import('./useUndoStore');
    // la entrada del reorden está debajo de la de la edición: se deshace primero esa
    useUndoStore.setState((u) => ({ stack: u.stack.filter((e) => e.label === 'Reorder columns') }));
    await useUndoStore.getState().undoLast();
    expect(server.c1).toMatchObject({ description: 'nueva', ordinal: 0 });
  });

  it('con la tabla fuera del canvas, leer sus columnas no reinstala un diagrama desactualizado', async () => {
    await st().selectSubjectArea('sa2');
    const read = deferred<unknown>();
    const gov = await import('@/services/governance.service');
    vi.mocked(gov.listColumns).mockImplementationOnce(() => read.promise as never);
    const r = st().reorderColumns('t1', ['c2', 'c1', 'c3']);
    await tick();
    vi.mocked(mod.loadDiagram).mockImplementation(async () => ({ ...dia('sa2'), tables: [{ id: 't9', logicalName: 'n', physicalName: 'T9_NUEVA' }] }) as never);
    await st().reload();                                              // otra edición recargó B
    const finalReload = deferred<unknown>();                          // la recarga del final del reorden, en vuelo
    vi.mocked(mod.loadDiagram).mockImplementation(() => finalReload.promise as never);
    read.resolve(Object.values(server).map((c) => ({ ...c })));
    await tick(); await tick();
    expect(st().diagram?.tables[0].physicalName).toBe('T9_NUEVA');   // antes de que esa recarga lo tape
    finalReload.resolve({ ...dia('sa2'), tables: [{ id: 't9', logicalName: 'n', physicalName: 'T9_NUEVA' }] });
    await r;
  });
});

// «El documento vigente» no puede revivir una columna borrada: si el canvas en
// pantalla tiene la tabla pero no la columna, no se escribe; si la tabla no está
// en pantalla, se relee del servidor (re-grabar la capturada la reviviría en el
// draft por el upsert).
describe('el reorden no revive una columna borrada entre tandas', () => {
  /** Ninguna escritura sin documento (un `{ ...null }` iría con id undefined). */
  const noOrphanWrites = () => expect(vi.mocked(csvc.recordChange).mock.calls.filter(([, , id]) => typeof id !== 'string')).toEqual([]);
  const eight = () => Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k${i}`, col(`k${i}`, i)]));
  const reversed = Array.from({ length: 8 }, (_, i) => `k${7 - i}`);   // se mueven las 8: k2..k0 en la 2.ª tanda
  function gateFirstWrite() {
    const gate = deferred<unknown>();
    vi.mocked(csvc.recordChange).mockImplementationOnce((async (...a: unknown[]) => { await gate.promise; server[a[2] as string] = { ...(a[4] as Doc) }; return {}; }) as never);
    return gate;
  }

  it('con la tabla en pantalla (borrada con su recarga): no se escribe', async () => {
    server = eight();
    await st().reload();
    const gate = gateFirstWrite();
    const r = st().reorderColumns('t1', reversed);
    await tick();
    await st().deleteColumn('k0');
    expect(server.k0).toBeUndefined();
    gate.resolve({});
    await r;
    expect(server.k0).toBeUndefined();
    expect(server.k1.ordinal).toBe(6);                                  // el resto, reordenado
    noOrphanWrites();
  });

  it('la llave del drop: una columna borrada entre sus escrituras no revive', async () => {
    const d = drop({ key: [{ id: 'c1', isPrimaryKey: true }, { id: 'c2', isPrimaryKey: true }], order: null }, 'c1');
    await tick();
    await st().deleteColumn('c2');
    d.release();
    await d.p;
    expect(server.c2).toBeUndefined();
    expect(server.c1.isPrimaryKey).toBe(true);
    noOrphanWrites();
  });

  it('el Undo del reorden tampoco revive una borrada después', async () => {
    await st().reorderColumns('t1', ['c2', 'c1', 'c3']);                 // se mueven c2 y c1
    await st().deleteColumn('c1');
    const { useUndoStore } = await import('./useUndoStore');
    useUndoStore.setState((u) => ({ stack: u.stack.filter((e) => e.label === 'Reorder columns') }));
    await useUndoStore.getState().undoLast();
    expect(server.c1).toBeUndefined();
    expect(server.c2.ordinal).toBe(1);
    noOrphanWrites();
  });

  it('con la tabla fuera de pantalla: se relee del servidor, y una borrada no revive', async () => {
    server = eight();
    await st().selectSubjectArea('sa2');                               // t1 no está en B
    const gate = gateFirstWrite();
    const r = st().reorderColumns('t1', reversed);
    await tick(); await tick();
    delete server.k0;                                                  // la borró otra edición (Inspector)
    gate.resolve({});
    await r;
    expect(server.k0).toBeUndefined();
    expect(server.k1.ordinal).toBe(6);
  });
});

// Con la tabla fuera del canvas el reorden espera `listColumns`: si mientras lee
// se abre otra versión, no marca «cambios sin guardar» en la nueva (WorkspaceScreen
// limpia `dirty` al cambiar).
describe('el reorden con lectura no ensucia la sesión nueva', () => {
  it('si la sesión cambia mientras lee, se corta sin marcar dirty', async () => {
    await st().selectSubjectArea('sa2');
    const read = deferred<unknown>();
    const gov = await import('@/services/governance.service');
    vi.mocked(gov.listColumns).mockImplementationOnce(() => read.promise as never);
    useModelerStore.setState({ dirty: false });
    const r = st().reorderColumns('t1', ['c2', 'c1', 'c3']).catch((e: unknown) => e);
    await tick();
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
    st().clearDirty();
    read.resolve(Object.values(server).map((c) => ({ ...c })));
    const out = await r;
    expect((out as Error)?.name).toBe('SessionChangedError');
    expect(st().dirty).toBe(false);
  });
});

// Con la tabla fuera de pantalla se hace una lectura (`listColumns`) por tabla y
// tanda, no una por columna: el Undo de un reorden de N columnas hecho en otro
// canvas serían N lecturas de N documentos, con el Undo ocupado todo ese tiempo.
// La tanda siguiente relee, así que lo borrado entre tandas se sigue viendo (el
// caso de arriba).
describe('fuera de pantalla: una lectura por tabla y tanda', () => {
  const N = 40;
  const many = () => Object.fromEntries(Array.from({ length: N }, (_, i) => [`k${i}`, col(`k${i}`, i)]));
  const lastFirst = [`k${N - 1}`, ...Array.from({ length: N - 1 }, (_, i) => `k${i}`)];   // se mueven las N

  it('el reorden y su Undo: a lo sumo una lectura por tanda de 5', async () => {
    server = many();
    await st().selectSubjectArea('sa2');                               // t1 no está en B
    const gov = await import('@/services/governance.service');
    vi.mocked(gov.listColumns).mockClear();
    await st().reorderColumns('t1', lastFirst);
    expect(server[`k${N - 1}`].ordinal).toBe(0);
    expect(vi.mocked(gov.listColumns).mock.calls.length).toBeLessThanOrEqual(1 + N / 5);   // el orden + una por tanda
    vi.mocked(gov.listColumns).mockClear();
    const { useUndoStore } = await import('./useUndoStore');
    useUndoStore.setState((u) => ({ stack: u.stack.filter((e) => e.label === 'Reorder columns') }));
    await useUndoStore.getState().undoLast();
    expect(server[`k${N - 1}`].ordinal).toBe(N - 1);
    expect(server.k0.ordinal).toBe(0);
    expect(vi.mocked(gov.listColumns).mock.calls.length).toBeLessThanOrEqual(N / 5);
  });
});
