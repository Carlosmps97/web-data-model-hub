// Doc 100 (P5/P6) — miembros del canvas, INTEGRADO: el store real con el
// `structure.service` real (con su cola de escrituras) contra un backend en
// memoria con LATENCIA. Invariante: la lista completa de tablas y vistas se
// arma DENTRO de la cola, sobre el canvas grabado de ese momento — armada
// afuera (con el diagrama en memoria o una lectura previa) se perdía cualquier
// otra escritura de miembros que cayera en medio.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock('@/services/changeset.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/changeset.service')>();
  return { ...actual, effective: vi.fn(), recordChange: vi.fn() };
});
vi.mock('@/features/modeler/services/modeler.service', () => ({
  loadDiagram: vi.fn(), setSubjectAreaLayout: vi.fn(), setSubjectAreaDrawings: vi.fn(),
  setSubjectAreaTables: vi.fn(), setSubjectAreaViews: vi.fn(), getSubjectArea: vi.fn(),
  deleteSubjectArea: vi.fn(), createSubjectArea: vi.fn(), updateSubjectArea: vi.fn(),
  listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(async () => []), listProjects: vi.fn(async () => []),
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
    createTable: vi.fn(async () => ({})),
    updateColumn: vi.fn(async () => ({})),
  };
});
vi.mock('@/services/views.service', () => ({ listViews: vi.fn(async () => []), listViewsForTables: vi.fn(async () => []) }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import * as csvc from '@/services/changeset.service';
import * as mod from '@/features/modeler/services/modeler.service';
import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';
import type { SubjectArea } from '@/features/modeler/services/modeler.service';

const R1 = [{ x: 200, y: 40 }, { x: 200, y: 160 }];
const RELS = [{ id: 'r1', parentTableId: 't1', childTableId: 't2', pairs: [] }];
const TABLES = ['t1', 't2', 't3', 't4', 't5'].map((id) => ({ id, physicalName: `M_${id.toUpperCase()}`, logicalName: id }));
const VIEWS = [
  { id: 'v1', name: 'V_T1', sourceTableIds: ['t1'], showOnCanvas: true },
  { id: 'v2', name: 'V_T2', sourceTableIds: ['t2'], showOnCanvas: true },
  { id: 'v3', name: 'V_T3', sourceTableIds: ['t3'], showOnCanvas: true },
];
const canvas = (over: Partial<SubjectArea> = {}): SubjectArea => ({
  id: 'sa1', projectId: 'p', name: 'Canvas', folderId: null,
  tableIds: ['t1', 't2'], viewIds: ['v1', 'v2'],
  layout: { t1: { x: 0, y: 0 }, t2: { x: 400, y: 0 }, v1: { x: 0, y: 300 }, v2: { x: 400, y: 300 } },
  drawings: [], udpValues: { u: '1' }, routes: { r1: R1 }, ...over,
});

let draft: Record<string, SubjectArea> = {};
let log: string[] = [];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const st = () => useModelerStore.getState();
const puts = () => log.filter((l) => l.startsWith('put:'));
const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => { unhandled.push(e); };

/** Vistas que el canvas MUESTRA: su lista explícita o, si no tiene (canvas nuevo
 *  o legacy, doc 70), las que tienen una fuente en el canvas. Lo hace el backend. */
const shown = (sa: SubjectArea): string[] =>
  Array.isArray(sa.viewIds) ? sa.viewIds : VIEWS.filter((v) => v.sourceTableIds.some((t) => sa.tableIds.includes(t))).map((v) => v.id);

const flowOf = () => ({
  getNodes: () => Object.entries(st().diagram?.subjectArea.layout ?? {}).map(([id, position]) => ({ id, type: 'table', position })),
  getNode: (id: string) => { const p = st().diagram?.subjectArea.layout?.[id]; return p ? { id, position: p } : undefined; },
  setNodes: vi.fn(),
  screenToFlowPosition: (p: { x: number; y: number }) => p,
}) as never;

beforeEach(async () => {
  vi.resetAllMocks();
  draft = { sa1: canvas(), sa2: canvas({ id: 'sa2', name: 'Otro', tableIds: ['t1'], viewIds: [], layout: { t1: { x: 5, y: 5 } }, routes: {} }) };
  log = [];
  vi.mocked(csvc.effective).mockImplementation(async (_cs, _coll, opts) => {
    const id = opts?.ids?.[0] as string;
    log.push(`get:${id}`);
    const snap = draft[id] ? structuredClone(draft[id]) : null;
    await sleep(5);
    return (snap ? [snap] : []) as never;
  });
  vi.mocked(csvc.recordChange).mockImplementation(async (_cs, _coll, id, op, payload) => {
    log.push(`put:${id}`);
    const body = payload ? structuredClone(payload) : undefined;
    await sleep(5);
    if (op === 'delete') delete draft[id]; else draft[id] = body as unknown as SubjectArea;
    return {} as never;
  });
  vi.mocked(mod.loadDiagram).mockImplementation(async (saId: string) => {
    const snap = draft[saId] ? structuredClone(draft[saId]) : null;
    await sleep(5);
    if (!snap) throw new Error('404');
    const has = (t: string) => snap.tableIds.includes(t);
    const viewIds = shown(snap);
    return {
      subjectArea: { ...snap, viewIds }, tables: TABLES.filter((t) => has(t.id)), columns: [],
      relationships: RELS.filter((r) => has(r.parentTableId) && has(r.childTableId)),
      views: VIEWS.filter((v) => viewIds.includes(v.id)),
    } as never;
  });
  vi.mocked(gov.listRelationships).mockImplementation(async () => []);
  vi.mocked(gov.listColumns).mockImplementation(async () => []);
  vi.mocked(gov.tableUsage).mockImplementation(async () => ({ usage: [], total: 0 }) as never);
  vi.mocked(gov.recordChangesBulk).mockImplementation(async () => ({}) as never);
  vi.mocked(gov.deleteTable).mockImplementation(async () => ({}) as never);
  vi.mocked(gov.createTable).mockImplementation(async () => ({}) as never);
  vi.mocked(viewsSvc.listViews).mockImplementation(async () => [] as never);
  vi.mocked(viewsSvc.listViewsForTables).mockImplementation(async () => [] as never);
  const naming = await import('@/services/naming.service');
  vi.mocked(naming.getNamingConfig).mockImplementation(async () => ({}) as never);

  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p' });
  useUndoStore.setState({ stack: [], busy: false });
  useModelerStore.setState({ activeSaId: null, diagram: null, dirty: false, viewerLayout: {}, viewerRoutesOff: {}, selectedTableId: null, selectedEdgeId: null, selectedViewId: null, flow: null, activeProjectId: 'p' } as never);
  await st().selectSubjectArea('sa1');
  useModelerStore.setState({ flow: flowOf() });
  log = [];
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});
afterEach(async () => {
  await sleep(80);
  process.off('unhandledRejection', onUnhandled);
  expect(unhandled, 'unhandledRejection durante la prueba').toEqual([]);
});

describe('P5 — dos escrituras de miembros que se cruzan no se pisan', () => {
  it('deshacer «sacar una tabla» mientras entra otra: quedan las dos', async () => {
    await st().removeTableFromArea('t2');
    expect(draft.sa1.tableIds).toEqual(['t1']);
    await Promise.all([useUndoStore.getState().undoLast(), st().addExistingTables(['t3'])]);
    expect(new Set(draft.sa1.tableIds)).toEqual(new Set(['t1', 't2', 't3']));
  });

  it('sacar dos vistas seguidas (antes de recargar): salen las dos', async () => {
    await Promise.all([st().removeViewFromCanvas('v1'), st().removeViewFromCanvas('v2')]);
    expect(draft.sa1.viewIds).toEqual([]);
  });

  it('deshacer «agregar vistas» mientras se saca otra: no revive la que salió', async () => {
    await st().addViewsToCanvas(['v3']);
    expect(draft.sa1.viewIds).toEqual(['v1', 'v2', 'v3']);
    await Promise.all([useUndoStore.getState().undoLast(), st().removeViewFromCanvas('v1')]);
    expect(draft.sa1.viewIds).toEqual(['v2']);
  });

  it('crear dos tablas casi a la vez: el canvas se queda con las dos', async () => {
    await Promise.all([
      st().createTable({ logicalName: 'Uno', physicalName: 'M_UNO' }),
      st().createTable({ logicalName: 'Dos', physicalName: 'M_DOS' }),
    ]);
    expect(draft.sa1.tableIds).toHaveLength(4);
  });
});

describe('P5 — el Undo de sacar una tabla es UNA escritura y repone todo', () => {
  it('tabla, vistas huérfanas, posiciones y trazos vuelven juntos', async () => {
    const before = structuredClone(draft.sa1);
    await st().removeTableFromArea('t1');                  // v1 (sólo t1) queda huérfana; r1 pierde su trazo
    expect(draft.sa1.tableIds).toEqual(['t2']);
    expect(draft.sa1.viewIds).toEqual(['v2']);
    expect(draft.sa1.routes).toEqual({});
    log = [];
    await useUndoStore.getState().undoLast();
    expect(puts()).toEqual(['put:sa1']);
    expect(new Set(draft.sa1.tableIds)).toEqual(new Set(before.tableIds));
    expect(new Set(draft.sa1.viewIds)).toEqual(new Set(before.viewIds));
    expect(draft.sa1.layout).toEqual(before.layout);
    expect(draft.sa1.routes).toEqual(before.routes);
  });

  it('borrar una tabla y deshacer: vuelve a cada canvas, con su posición y trazos en el activo', async () => {
    vi.mocked(gov.tableUsage).mockImplementation(async () => ({ usage: [{ canvasId: 'sa1' }, { canvasId: 'sa2' }], total: 2 }) as never);
    vi.mocked(gov.listRelationships).mockImplementation(async () => RELS as never);
    await st().deleteTable('t1');
    expect(draft.sa1.tableIds).toEqual(['t2']);
    expect(draft.sa2.tableIds).toEqual([]);
    log = [];
    await useUndoStore.getState().undoLast();
    expect(puts().sort()).toEqual(['put:sa1', 'put:sa2']);
    expect(draft.sa1.tableIds).toEqual(['t2', 't1']);
    expect(draft.sa1.layout.t1).toEqual({ x: 0, y: 0 });
    expect(draft.sa1.routes).toEqual({ r1: R1 });
    expect(draft.sa2.tableIds).toEqual(['t1']);
  });
});

describe('P5 — canvas sin lista explícita de vistas (doc 70)', () => {
  it('importar una tabla NO arrastra sus vistas; pedirlas conserva las que ya se mostraban', async () => {
    const legacy = canvas();
    delete (legacy as Partial<SubjectArea>).viewIds;
    draft.sa1 = legacy;                                    // muestra v1 y v2 por sus fuentes
    await st().reload();
    await st().addExistingTables(['t3']);
    expect(draft.sa1.viewIds).toEqual(['v1', 'v2']);       // v3 (fuente t3) no entra sola
    vi.mocked(viewsSvc.listViewsForTables).mockImplementation(async () => [VIEWS[2]] as never);
    await st().addExistingTables(['t4'], { withViews: true });
    expect(draft.sa1.viewIds).toEqual(['v1', 'v2', 'v3']);
  });
});

describe('P5 — el Undo usa las vistas de SU canvas, no las del canvas abierto (revisión 2026-09-28)', () => {
  const legacy = (over: Partial<SubjectArea> = {}) => {
    const sa = canvas(over);
    delete (sa as Partial<SubjectArea>).viewIds;          // canvas sin lista explícita (doc 70)
    return sa;
  };

  it('sacar una tabla sin vistas y deshacer desde OTRO canvas no le pone al primero las vistas del segundo', async () => {
    draft.sa1 = legacy({ tableIds: ['t1', 't2', 't4'] });                   // muestra v1 y v2 por sus fuentes
    draft.sa2 = canvas({ id: 'sa2', name: 'Otro', tableIds: ['t3'], viewIds: ['v3'], layout: { t3: { x: 5, y: 5 } }, routes: {} });
    await st().reload();
    await st().removeTableFromArea('t4');                                  // sin vistas huérfanas: sigue sin lista
    expect(draft.sa1.viewIds).toBeUndefined();
    await st().selectSubjectArea('sa2');
    await useUndoStore.getState().undoLast();
    expect(draft.sa1.tableIds).toEqual(['t1', 't2', 't4']);
    expect(draft.sa1.viewIds).toBeUndefined();                             // antes: ['v3'] (la del canvas abierto)
  });

  it.each([
    ['sacar una vista', async () => { await st().removeViewFromCanvas('v1'); }, ['v1', 'v2']],
    ['agregar vistas', async () => { await st().addViewsToCanvas(['v3']); }, ['v1', 'v2']],
    ['importar una tabla con su vista', async () => {
      vi.mocked(viewsSvc.listViewsForTables).mockImplementation(async () => [VIEWS[2]] as never);
      await st().addExistingTables(['t3'], { withViews: true });
    }, ['v1', 'v2']],
  ])('%s y deshacer desde otro canvas deja la lista de SU canvas', async (_label, act, after) => {
    draft.sa2 = canvas({ id: 'sa2', name: 'Otro', tableIds: ['t3'], viewIds: ['v3'], layout: { t3: { x: 5, y: 5 } }, routes: {} });
    await act();
    await st().selectSubjectArea('sa2');
    await useUndoStore.getState().undoLast();
    expect(new Set(draft.sa1.viewIds)).toEqual(new Set(after));
    expect(draft.sa2.viewIds).toEqual(['v3']);
  });
});

describe('P6 — posiciones enteras', () => {
  it('mover un bloque con zoom: se graba en píxeles enteros y el diagrama queda igual', async () => {
    await st().saveLayout('t1', { x: 72.3315, y: 40.5 });
    expect(draft.sa1.layout.t1).toEqual({ x: 72, y: 41 });
    expect(st().diagram!.subjectArea.layout.t1).toEqual({ x: 72, y: 41 });
  });
});
