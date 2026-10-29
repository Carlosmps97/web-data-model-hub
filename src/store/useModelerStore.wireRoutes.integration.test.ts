// Trazos manuales de wires, integrado: el store real con el
// `structure.service` real (con su cola de escrituras) contra un backend en
// memoria con latencia. Lo único simulado es la red. Invariante central:
// cuando todo queda quieto, lo que se ve es lo que está grabado, también si
// la red falla o un diagrama llega tarde.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock('@/services/changeset.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/changeset.service')>();
  return {
    ...actual, effective: vi.fn(), recordChange: vi.fn(),
    writeSeqOf: async () => ({ writeSeq: 0 }),   // el candado del Undo lee el contador (doc 133): nada ajeno
  };
});
vi.mock('@/features/modeler/services/modeler.service', () => ({
  loadDiagram: vi.fn(), setSubjectAreaLayout: vi.fn(), setSubjectAreaDrawings: vi.fn(),
  setSubjectAreaTables: vi.fn(), setSubjectAreaViews: vi.fn(),
  deleteSubjectArea: vi.fn(), createSubjectArea: vi.fn(), updateSubjectArea: vi.fn(),
  listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(async () => []), listProjects: vi.fn(async () => []),
}));
vi.mock('@/features/modeler/lib/arrangeGraph', () => ({
  arrangeDiagram: vi.fn(async () => ({ t1: { x: 10, y: 20 }, t2: { x: 30, y: 40 }, t3: { x: 50, y: 60 } })),
}));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return {
    ...actual,
    listRelationships: vi.fn(async () => []),
    listColumns: vi.fn(async () => []),
    tableUsage: vi.fn(async () => ({ usage: [], total: 0 })),
    recordChangesBulk: vi.fn(async () => ({})),
    deleteTable: vi.fn(async () => ({})),
    updateColumn: vi.fn(async () => ({})),
  };
});
vi.mock('@/services/views.service', () => ({ listViews: vi.fn(async () => []) }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import { toast } from 'sonner';
import * as csvc from '@/services/changeset.service';
import * as mod from '@/features/modeler/services/modeler.service';
import * as gov from '@/services/governance.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';
import type { SubjectArea } from '@/features/modeler/services/modeler.service';

const R1 = [{ x: 200, y: 40 }, { x: 200, y: 160 }];
const R2 = [{ x: 260, y: -30 }];
const R3 = [{ x: 90, y: 90 }];
const R4 = [{ x: 7, y: 7 }, { x: 8, y: 8 }];

const rel = (id: string, parent: string, child: string, symbol?: string) => ({
  id, parentTableId: parent, childTableId: child, pairs: [],
  ...(symbol ? { subcategory: true, subtypeSymbolId: symbol } : {}),
});
const RELS = [rel('r1', 't1', 't2'), rel('r2', 't1', 't3'), rel('s1', 't2', 't3', 'sym1')];
const TABLES = [
  { id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente' },
  { id: 't2', physicalName: 'M_CUENTA', logicalName: 'Cuenta' },
  { id: 't3', physicalName: 'M_TARJETA', logicalName: 'Tarjeta' },
];
const canvas = (over: Partial<SubjectArea> = {}): SubjectArea => ({
  id: 'sa1', projectId: 'p', name: 'Canvas', folderId: null,
  tableIds: ['t1', 't2', 't3'], viewIds: [],
  layout: { t1: { x: 0, y: 0 }, t2: { x: 400, y: 0 }, t3: { x: 800, y: 0 } },
  drawings: [], udpValues: { u: '1' }, routes: { r1: R1 }, ...over,
});

let draft: Record<string, SubjectArea> = {};
let putLatency = 5;
let getLatency = 5;
let diagramLatency = 5;
let failPut: number[] = [];       // n-ésimo PUT (1-based) que falla
let nPut = 0;
let log: string[] = [];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const st = () => useModelerStore.getState();
const routes = () => st().canvasRoutes;
const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => { unhandled.push(e); };

const flowOf = () => ({
  getNodes: () => Object.entries(st().diagram?.subjectArea.layout ?? {}).map(([id, position]) => ({ id, type: 'table', position })),
  getNode: (id: string) => { const p = st().diagram?.subjectArea.layout?.[id]; return p ? { id, position: p } : undefined; },
  setNodes: vi.fn(),
}) as never;

beforeEach(async () => {
  vi.resetAllMocks();
  draft = { sa1: canvas(), sa2: canvas({ id: 'sa2', name: 'Otro', routes: { r1: R3 } }), sa9: canvas({ id: 'sa9', name: 'Nueve', routes: { r1: R4, r2: R4 } }) };
  putLatency = 5; getLatency = 5; diagramLatency = 5; failPut = []; nPut = 0; log = [];
  vi.mocked(csvc.effective).mockImplementation(async (_cs, _coll, opts) => {
    const id = opts?.ids?.[0] as string;
    log.push(`get:${id}`);
    const snap = draft[id] ? structuredClone(draft[id]) : null;
    await sleep(getLatency);
    return (snap ? [snap] : []) as never;
  });
  vi.mocked(csvc.recordChange).mockImplementation(async (_cs, _coll, id, op, payload) => {
    const n = ++nPut;
    log.push(`put:${id}`);
    const body = payload ? structuredClone(payload) : undefined;
    await sleep(putLatency);
    if (failPut.includes(n)) throw new Error(`sin red (PUT#${n})`);
    if (op === 'delete') delete draft[id]; else draft[id] = body as unknown as SubjectArea;
    return {} as never;
  });
  vi.mocked(mod.loadDiagram).mockImplementation(async (saId: string) => {
    const snap = draft[saId] ? structuredClone(draft[saId]) : null;          // foto al llegar el request
    await sleep(diagramLatency);
    if (!snap) throw new Error('404');
    const has = (t: string) => snap.tableIds.includes(t);
    return {
      subjectArea: snap, tables: TABLES.filter((t) => has(t.id)), columns: [],
      relationships: RELS.filter((r) => has(r.parentTableId) && has(r.childTableId)), views: [],
    } as never;
  });
  vi.mocked(gov.listRelationships).mockImplementation(async () => []);
  vi.mocked(gov.listColumns).mockImplementation(async () => []);
  vi.mocked(gov.tableUsage).mockImplementation(async () => ({ usage: [], total: 0 }) as never);
  vi.mocked(gov.recordChangesBulk).mockImplementation(async () => ({}) as never);
  vi.mocked(gov.deleteTable).mockImplementation(async () => ({}) as never);
  const views = await import('@/services/views.service');
  vi.mocked(views.listViews).mockImplementation(async () => [] as never);
  const naming = await import('@/services/naming.service');
  vi.mocked(naming.getNamingConfig).mockImplementation(async () => ({}) as never);
  const { arrangeDiagram } = await import('@/features/modeler/lib/arrangeGraph');
  vi.mocked(arrangeDiagram).mockImplementation(async () => ({ t1: { x: 10, y: 20 }, t2: { x: 30, y: 40 }, t3: { x: 50, y: 60 } }) as never);

  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p' });
  useUndoStore.setState({ stack: [], busy: false });
  useModelerStore.setState({ activeSaId: null, diagram: null, dirty: false, viewerLayout: {}, viewerRoutesOff: {}, selectedTableId: null, selectedEdgeId: null, flow: null, activeProjectId: 'p' } as never);
  await st().selectSubjectArea('sa1');
  useModelerStore.setState({ flow: flowOf() });
  expect(routes(), 'arnés contaminado por una prueba anterior').toEqual({ r1: R1 });
  log = [];
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});
afterEach(async () => {
  await sleep(120);                                    // que termine todo lo que sigue en vuelo
  process.off('unhandledRejection', onUnhandled);
  expect(unhandled, 'unhandledRejection durante la prueba').toEqual([]);
});

/** Pantalla == backend, en el momento y después de recargar. */
async function expectScreenIsBackend(saId = 'sa1') {
  expect(routes(), 'pantalla vs grabado').toEqual(draft[saId].routes);
  expect(st().diagram!.subjectArea.routes, 'diagrama del store vs grabado').toEqual(draft[saId].routes);
  await st().reload();
  expect(routes(), 'pantalla vs grabado, tras recargar').toEqual(draft[saId].routes);
}

describe('gestos rápidos sobre el mismo wire con la cola real', () => {
  it('los dos graban: queda el último, en pantalla y en el backend', async () => {
    await Promise.all([st().setWireRoute('r1', R2), st().setWireRoute('r1', R3)]);
    expect(log).toEqual(['get:sa1', 'put:sa1', 'get:sa1', 'put:sa1']);
    expect(draft.sa1.routes).toEqual({ r1: R3 });
    await expectScreenIsBackend();
  });

  it('los dos fallan (red caída): el backend sigue con R1 y la pantalla debe mostrar R1', async () => {
    failPut = [1, 2];
    await Promise.all([st().setWireRoute('r1', R2), st().setWireRoute('r1', R3)]);
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(draft.sa1.routes).toEqual({ r1: R1 });
    expect(routes(), 'pantalla vs grabado').toEqual(draft.sa1.routes);
  });

  it('falla el primero y graba el segundo: pantalla == backend', async () => {
    failPut = [1];
    await Promise.all([st().setWireRoute('r1', R2), st().setWireRoute('r1', R3)]);
    expect(draft.sa1.routes).toEqual({ r1: R3 });
    await expectScreenIsBackend();
  });

  it('graba el primero y falla el segundo: pantalla == backend (R2)', async () => {
    failPut = [2];
    await Promise.all([st().setWireRoute('r1', R2), st().setWireRoute('r1', R3)]);
    expect(draft.sa1.routes).toEqual({ r1: R2 });
    await expectScreenIsBackend();
  });

  it('ráfaga: 3 wires + 3 bloques movidos a la vez — nada se pierde y pantalla == backend', async () => {
    await Promise.all([
      st().setWireRoute('r1', R2), st().saveLayout('t1', { x: 11, y: 11 }),
      st().setWireRoute('r2', R3), st().saveLayout('t2', { x: 22, y: 22 }),
      st().setWireRoute('s1', R4), st().saveLayout('t3', { x: 33, y: 33 }),
    ]);
    expect(log.join(' ')).toBe(Array.from({ length: 6 }, () => 'get:sa1 put:sa1').join(' '));
    expect(draft.sa1.routes).toEqual({ r1: R2, r2: R3, s1: R4 });
    expect(draft.sa1.layout).toEqual({ t1: { x: 11, y: 11 }, t2: { x: 22, y: 22 }, t3: { x: 33, y: 33 } });
    expect(draft.sa1.udpValues).toEqual({ u: '1' });
    await expectScreenIsBackend();
  });
});

describe('trazar, mover, quitar y deshacer ×3 (backend en memoria)', () => {
  it('cada paso deja pantalla == backend y al final todo vuelve al inicio', async () => {
    const before = structuredClone(draft.sa1);
    await st().setWireRoute('r2', R2);
    expect(draft.sa1.routes).toEqual({ r1: R1, r2: R2 });
    await st().setWireRoute('r2', R3);
    expect(draft.sa1.routes).toEqual({ r1: R1, r2: R3 });
    await st().setWireRoute('r2', null);
    expect(draft.sa1.routes).toEqual({ r1: R1 });
    await useUndoStore.getState().undoLast();
    expect(draft.sa1.routes).toEqual({ r1: R1, r2: R3 });
    expect(routes()).toEqual(draft.sa1.routes);
    await useUndoStore.getState().undoLast();
    expect(draft.sa1.routes).toEqual({ r1: R1, r2: R2 });
    expect(routes()).toEqual(draft.sa1.routes);
    await useUndoStore.getState().undoLast();
    expect(draft.sa1).toEqual(before);
    await expectScreenIsBackend();
  });

  it('quitar el último trazo y deshacer: la llave routes nunca falta en lo grabado', async () => {
    await st().setWireRoute('r1', null);
    expect(draft.sa1).toHaveProperty('routes', {});
    await useUndoStore.getState().undoLast();
    expect(draft.sa1.routes).toEqual({ r1: R1 });
    await expectScreenIsBackend();
  });
});

describe('un diagrama que llega tarde (latencia)', () => {
  it('reload lento pedido antes del gesto; el guardado termina primero: el trazo grabado no desaparece', async () => {
    diagramLatency = 80;
    const reloading = st().reload();
    await sleep(5);
    await st().setWireRoute('r2', R2);                  // ~10 ms: termina antes que el diagrama
    expect(draft.sa1.routes).toEqual({ r1: R1, r2: R2 });
    expect(routes()).toEqual({ r1: R1, r2: R2 });
    await reloading;                                     // llega la foto previa al guardado
    expect(routes(), 'pantalla vs grabado').toEqual(draft.sa1.routes);
  });

  it('reload lento pedido durante el guardado (el guardado sigue en vuelo al llegar): conserva el trazo', async () => {
    putLatency = 60; diagramLatency = 10;
    const saving = st().setWireRoute('r2', R2);
    await st().reload();
    expect(routes()).toEqual({ r1: R1, r2: R2 });
    await saving;
    await expectScreenIsBackend();
  });

  it('mover un bloque y recargar tarde: la posición grabada no vuelve atrás en el diagrama del store', async () => {
    diagramLatency = 80;
    const reloading = st().reload();
    await sleep(5);
    await st().saveLayout('t2', { x: 900, y: 300 });
    await reloading;
    expect(st().diagram!.subjectArea.layout.t2, 'posición en el diagrama vs grabada').toEqual(draft.sa1.layout.t2);
  });
});

describe('sacar una tabla del canvas + Undo', () => {
  beforeEach(async () => {
    draft.sa1 = canvas({ routes: { r1: R1, r2: R2, s1: R3, 'subsym-sym1': R4 } });
    await st().reload();
  });

  it('una sola escritura que saca tabla, posición y trazos; el Undo deja todo como estaba', async () => {
    const before = structuredClone(draft.sa1);
    log = [];
    await st().removeTableFromArea('t2');
    expect(log).toEqual(['get:sa1', 'put:sa1']);
    expect(draft.sa1.tableIds).toEqual(['t1', 't3']);
    expect(draft.sa1.layout).toEqual({ t1: { x: 0, y: 0 }, t3: { x: 800, y: 0 } });
    expect(draft.sa1.routes).toEqual({ r2: R2 });
    expect(routes()).toEqual({ r2: R2 });
    await useUndoStore.getState().undoLast();
    expect([...draft.sa1.tableIds].sort()).toEqual(['t1', 't2', 't3']);
    expect(draft.sa1.layout).toEqual(before.layout);
    expect(draft.sa1.routes).toEqual(before.routes);
    expect({ ...draft.sa1, tableIds: [], layout: {}, routes: {} }).toEqual({ ...before, tableIds: [], layout: {}, routes: {} });
    await expectScreenIsBackend();
  });

  it('sacar con un trazo de esa tabla en vuelo y después deshacer las dos cosas', async () => {
    putLatency = 20;
    const saving = st().setWireRoute('r1', R4);
    const removing = st().removeTableFromArea('t2');
    await Promise.all([saving, removing]);
    expect(draft.sa1.routes).toEqual({ r2: R2 });
    expect(routes()).toEqual({ r2: R2 });
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Reroute wire', 'Remove M_CUENTA from canvas']);
    await useUndoStore.getState().undoLast();            // vuelve la tabla con el trazo que tenía al sacarla
    expect(draft.sa1.routes).toEqual({ r1: R4, r2: R2, s1: R3, 'subsym-sym1': R4 });
    await useUndoStore.getState().undoLast();            // deshace el gesto: r1 vuelve a R1
    expect(draft.sa1.routes).toEqual({ r1: R1, r2: R2, s1: R3, 'subsym-sym1': R4 });
    await expectScreenIsBackend();
  });
});

describe('borrar una tabla + Undo', () => {
  beforeEach(async () => {
    draft.sa1 = canvas({ routes: { r1: R1, r2: R2, s1: R3, 'subsym-sym1': R4 } });
    draft.sa9 = canvas({ id: 'sa9', name: 'Nueve', routes: { r1: R4, r2: R4 } });
    await st().reload();
    vi.mocked(gov.listRelationships).mockImplementation(async () => [rel('r1', 't1', 't2'), rel('s1', 't2', 't3', 'sym1')] as never);
    vi.mocked(gov.tableUsage).mockImplementation(async () => ({ usage: [{ canvasId: 'sa1' }, { canvasId: 'sa9' }], total: 2 }) as never);
  });

  it('poda en todos los canvases; el Undo repone la tabla y sus trazos en todos', async () => {
    await st().deleteTable('t2');
    expect(draft.sa1.routes).toEqual({ r2: R2 });
    expect(draft.sa9.routes).toEqual({ r2: R4 });
    expect(draft.sa1.tableIds).toEqual(['t1', 't3']);
    expect(draft.sa9.tableIds).toEqual(['t1', 't3']);
    expect(routes()).toEqual({ r2: R2 });
    await useUndoStore.getState().undoLast();
    expect([...draft.sa1.tableIds].sort()).toEqual(['t1', 't2', 't3']);
    expect([...draft.sa9.tableIds].sort()).toEqual(['t1', 't2', 't3']);
    expect(draft.sa1.routes).toEqual({ r1: R1, r2: R2, s1: R3, 'subsym-sym1': R4 });
    expect(draft.sa1.layout.t2).toEqual({ x: 400, y: 0 });
    await expectScreenIsBackend();
    // también en los demás canvases: cada uno recupera los trazos que quitó
    expect(draft.sa9.routes).toEqual({ r1: R4, r2: R4 });
  });
});

describe('cambiar de canvas con guardado en vuelo (selectSubjectArea real)', () => {
  it('A en vuelo → B → gesto en B sobre el mismo wire → volver a A', async () => {
    putLatency = 40;
    const savingA = st().setWireRoute('r1', R2);
    await st().selectSubjectArea('sa2');
    expect(routes()).toEqual({ r1: R3 });
    const savingB = st().setWireRoute('r1', R4);
    await Promise.all([savingA, savingB]);
    expect(draft.sa1.routes).toEqual({ r1: R2 });
    expect(draft.sa2.routes).toEqual({ r1: R4 });
    expect(routes()).toEqual({ r1: R4 });
    await st().selectSubjectArea('sa1');
    expect(routes()).toEqual({ r1: R2 });
    await expectScreenIsBackend('sa1');
  });

  it('el guardado de A falla estando en B; al volver a A se ve lo del backend', async () => {
    putLatency = 40; failPut = [1];
    const savingA = st().setWireRoute('r1', R2);
    await st().selectSubjectArea('sa2');
    await savingA;
    expect(routes()).toEqual({ r1: R3 });
    expect(toast.error).toHaveBeenCalledTimes(1);
    await st().selectSubjectArea('sa1');
    await expectScreenIsBackend('sa1');
  });
});

describe('auto-arrange', () => {
  it('con un trazo en vuelo: al terminar, backend sin trazos y pantalla igual; Undo repone todo', async () => {
    putLatency = 20;
    const saving = st().setWireRoute('r2', R2);
    const arranging = st().autoOrganize();
    await Promise.all([saving, arranging]);
    expect(draft.sa1.routes).toEqual({});
    expect(draft.sa1.layout).toEqual({ t1: { x: 10, y: 20 }, t2: { x: 30, y: 40 }, t3: { x: 50, y: 60 } });
    await expectScreenIsBackend();
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Reroute wire', 'Auto-arrange']);
    await useUndoStore.getState().undoLast();
    expect(draft.sa1.routes).toEqual({ r1: R1, r2: R2 });
    expect(draft.sa1.layout).toEqual({ t1: { x: 0, y: 0 }, t2: { x: 400, y: 0 }, t3: { x: 800, y: 0 } });
    await expectScreenIsBackend();
  });

  it('falla al guardar: backend intacto, pantalla intacta, sin Undo', async () => {
    failPut = [1];
    await expect(st().autoOrganize()).rejects.toThrow(/sin red/);
    expect(draft.sa1).toEqual(canvas());
    expect(useUndoStore.getState().stack).toEqual([]);
    await expectScreenIsBackend();
  });

  it('un gesto hecho mientras se guarda el arrange: queda grabado y a la vista', async () => {
    putLatency = 30;
    const arranging = st().autoOrganize();
    await sleep(10);
    const saving = st().setWireRoute('r2', R2);
    await Promise.all([arranging, saving]);
    expect(draft.sa1.routes).toEqual({ r2: R2 });
    expect(routes(), 'pantalla vs grabado').toEqual(draft.sa1.routes);
  });
});
