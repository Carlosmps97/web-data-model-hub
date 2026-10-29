// Borrar tablas y vistas (y su Undo) contra un backend en memoria que se porta
// como el real: el lote (`PUT /changes/bulk`), el borrado de una vista y el de una
// tabla cascadean la membresía en el mismo request (quitan el id, y su posición,
// de todo canvas que lo lista explícitamente; un canvas sin lista explícita no se
// toca) y un canvas se graba podado de los miembros que el draft borró.
// `structure.service` es el real (con su cola por canvas).
//  · El Undo de borrar una tabla devuelve sus vistas a los canvases con lista
//    explícita, con su posición, y la tabla a su posición en todos los canvases,
//    con una escritura por canvas.
//  · Si falla una lectura de la cascada no se borra nada.
//  · Borrar una vista (panel o inspector) tiene el mismo Undo, con posición.
//  · «Import existing tables» con vistas que no se pudieron leer avisa.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock('@/services/changeset.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/changeset.service')>();
  return {
    ...actual, effective: vi.fn(), recordChange: vi.fn(),
    writeSeqOf: async () => ({ writeSeq: 0 }),   // el candado del Undo lee el contador (doc 133): nada ajeno
  };
});
vi.mock('../features/modeler/services/modeler.service', () => ({
  loadDiagram: vi.fn(), listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(async () => []), listProjects: vi.fn(async () => []),
}));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return {
    ...actual,
    listRelationships: vi.fn(), listColumns: vi.fn(), tableUsage: vi.fn(),
    recordChangesBulk: vi.fn(), deleteTable: vi.fn(), updateColumn: vi.fn(async () => ({})),
  };
});
vi.mock('@/services/views.service', () => ({
  listViews: vi.fn(), listViewsForTables: vi.fn(), tableViews: vi.fn(), deleteView: vi.fn(), updateView: vi.fn(),
  currentView: vi.fn(),
}));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import { toast } from 'sonner';
import * as csvc from '@/services/changeset.service';
import * as mod from '../features/modeler/services/modeler.service';
import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';
import type { SubjectArea } from '../features/modeler/services/modeler.service';

type Pos = { x: number; y: number };
const TABLES = ['t1', 't2', 't3'].map((id) => ({ id, physicalName: `M_${id.toUpperCase()}`, logicalName: id }));
const V1 = { id: 'v1', name: 'V_T1', tableId: 't1', sourceTableIds: ['t1'], showOnCanvas: true, sources: [] };
const V2 = { id: 'v2', name: 'V_T2', tableId: 't2', sourceTableIds: ['t2'], showOnCanvas: true, sources: [] };
const VIEWS = [V1, V2];
const DEPENDENTS = "Couldn't check what depends on this table: nothing was deleted. Try again.";

let draft: Record<string, SubjectArea> = {};
let ops = new Map<string, 'upsert' | 'delete'>();
let cascadeOnDelete = true;
let log: string[] = [];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const st = () => useModelerStore.getState();
const puts = () => log.filter((l) => l.startsWith('put:'));
const deleted = (coll: string, id: string) => ops.get(`${coll}:${id}`) === 'delete';
const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => { unhandled.push(e); };

/** Cascada de membresía del backend al borrar una tabla o vista. */
function cascade(coll: string, id: string): void {
  if (!cascadeOnDelete) return;
  const field = coll === 'views' ? 'viewIds' : 'tableIds';
  for (const sa of Object.values(draft)) {
    const list = sa[field];
    if (!Array.isArray(list) || !list.includes(id)) continue;
    (sa as unknown as Record<string, unknown>)[field] = list.filter((x) => x !== id);
    if (sa.layout) delete sa.layout[id];
  }
}
/** Poda del backend al grabar un canvas (prune_deleted_members): solo los ids
 *  listados en `tableIds`/`viewIds` con un borrado pendiente salen de las listas
 *  y del layout (un canvas sin lista explícita de vistas conserva la posición de
 *  sus vistas). */
function prune(sa: SubjectArea): SubjectArea {
  const listed = [...(sa.tableIds ?? []), ...(Array.isArray(sa.viewIds) ? sa.viewIds : [])];
  const gone = new Set(listed.filter((id) => deleted('canonical_tables', id) || deleted('views', id)));
  const out = { ...sa };
  out.tableIds = (sa.tableIds ?? []).filter((t) => !gone.has(t));
  if (Array.isArray(sa.viewIds)) out.viewIds = sa.viewIds.filter((v) => !gone.has(v));
  if (sa.layout) out.layout = Object.fromEntries(Object.entries(sa.layout).filter(([k]) => !gone.has(k)));
  return out;
}
/** Vistas que el canvas muestra: su lista explícita o, si no la tiene, las de sus fuentes. */
const shown = (sa: SubjectArea): string[] =>
  (Array.isArray(sa.viewIds) ? sa.viewIds : VIEWS.filter((v) => v.sourceTableIds.some((t) => sa.tableIds.includes(t))).map((v) => v.id))
    .filter((v) => !deleted('views', v));

const flowOf = () => ({
  getNodes: () => Object.entries(st().diagram?.subjectArea.layout ?? {}).map(([id, position]) => ({ id, type: 'table', position })),
  getNode: (id: string) => { const p = st().diagram?.subjectArea.layout?.[id]; return p ? { id, position: p } : undefined; },
  setNodes: vi.fn(),
  screenToFlowPosition: (p: Pos) => p,
}) as never;

beforeEach(async () => {
  vi.resetAllMocks();
  cascadeOnDelete = true;
  ops = new Map();
  draft = {
    // Canvas activo, con lista explícita de vistas.
    sa1: { id: 'sa1', projectId: 'p', name: 'Uno', folderId: null, tableIds: ['t1', 't2'], viewIds: ['v1', 'v2'],
      layout: { t1: { x: 0, y: 0 }, t2: { x: 400, y: 0 }, v1: { x: 0, y: 300 }, v2: { x: 400, y: 300 } },
      drawings: [], udpValues: {}, routes: {} } as SubjectArea,
    // Otro canvas con lista explícita que también muestra `v1`.
    sa2: { id: 'sa2', projectId: 'p', name: 'Dos', folderId: null, tableIds: ['t1'], viewIds: ['v1'],
      layout: { t1: { x: 5, y: 5 }, v1: { x: 5, y: 205 } }, drawings: [], udpValues: {}, routes: {} } as SubjectArea,
    // Canvas sin lista explícita de vistas: muestra `v1` por su fuente.
    sa3: { id: 'sa3', projectId: 'p', name: 'Tres', folderId: null, tableIds: ['t1'],
      layout: { t1: { x: 9, y: 9 }, v1: { x: 9, y: 209 } }, drawings: [], udpValues: {}, routes: {} } as SubjectArea,
  };
  vi.mocked(csvc.effective).mockImplementation(async (_cs, _coll, opts) => {
    const id = opts?.ids?.[0] as string;
    log.push(`get:${id}`);
    const snap = draft[id] ? structuredClone(draft[id]) : null;
    await sleep(2);
    return (snap ? [snap] : []) as never;
  });
  vi.mocked(csvc.recordChange).mockImplementation(async (_cs, coll, id, op, payload) => {
    log.push(`put:${id}`);
    await sleep(2);
    if (coll !== 'subject_areas') return {} as never;
    if (op === 'delete') delete draft[id]; else draft[id] = prune(structuredClone(payload) as unknown as SubjectArea);
    return {} as never;
  });
  vi.mocked(gov.recordChangesBulk).mockImplementation(async (changes) => {
    log.push('bulk');
    for (const c of changes) {
      ops.set(`${c.collection}:${c.entityId}`, c.op);
      if (c.op === 'delete' && (c.collection === 'views' || c.collection === 'canonical_tables')) cascade(c.collection, c.entityId);
    }
    return {} as never;
  });
  vi.mocked(gov.deleteTable).mockImplementation(async (id: string) => {
    log.push(`table:${id}`);
    ops.set(`canonical_tables:${id}`, 'delete');
    cascade('canonical_tables', id);
    return {} as never;
  });
  vi.mocked(gov.listRelationships).mockImplementation(async () => []);
  vi.mocked(gov.listColumns).mockImplementation(async () => []);
  vi.mocked(gov.tableUsage).mockImplementation(async (t: string) => {
    const usage = Object.values(draft).filter((sa) => sa.tableIds.includes(t)).map((sa) => ({ canvasId: sa.id }));
    return { usage, total: usage.length } as never;
  });
  vi.mocked(viewsSvc.listViews).mockImplementation(async (t: string) =>
    VIEWS.filter((v) => v.sourceTableIds.includes(t) && !deleted('views', v.id)).map((v) => structuredClone(v)) as never);
  vi.mocked(viewsSvc.listViewsForTables).mockImplementation(async (ids: string[]) =>
    VIEWS.filter((v) => v.sourceTableIds.some((t) => ids.includes(t))) as never);
  vi.mocked(viewsSvc.tableViews).mockImplementation(async (t: string) => {
    const rows = VIEWS.filter((v) => v.sourceTableIds.includes(t) && !deleted('views', v.id)).map((v) => ({
      ...structuredClone(v),
      canvases: Object.values(draft).filter((sa) => shown(sa).includes(v.id)).map((sa) => ({ id: sa.id, name: sa.name })),
    }));
    return { views: rows, total: rows.length } as never;
  });
  vi.mocked(viewsSvc.deleteView).mockImplementation(async (id: string) => {
    log.push(`view:${id}`);
    ops.set(`views:${id}`, 'delete');
    cascade('views', id);
    return { deleted: true };
  });
  vi.mocked(viewsSvc.updateView).mockImplementation(async (id: string, body) => {
    ops.set(`views:${id}`, 'upsert');
    return { ...body, id } as never;
  });
  vi.mocked(mod.loadDiagram).mockImplementation(async (saId: string) => {
    const snap = draft[saId] ? structuredClone(draft[saId]) : null;
    await sleep(2);
    if (!snap) throw new Error('404');
    const viewIds = shown(snap);
    return {
      subjectArea: { ...snap, viewIds }, tables: TABLES.filter((t) => snap.tableIds.includes(t.id) && !deleted('canonical_tables', t.id)),
      columns: [], relationships: [], views: VIEWS.filter((v) => viewIds.includes(v.id)),
    } as never;
  });
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
  await sleep(30);
  process.off('unhandledRejection', onUnhandled);
  expect(unhandled, 'unhandledRejection durante la prueba').toEqual([]);
});

describe('borrar una tabla y deshacer', () => {
  it('el borrado saca la tabla y sus vistas de cada canvas (la vista: cascada del backend)', async () => {
    await st().deleteTable('t1');
    expect(draft.sa1.tableIds).toEqual(['t2']);
    expect(draft.sa1.viewIds).toEqual(['v2']);
    expect(draft.sa1.layout.v1).toBeUndefined();
    expect(draft.sa2.viewIds).toEqual([]);
    expect(draft.sa3.viewIds).toBeUndefined();
  });

  it('deshacer devuelve la tabla y su vista a cada canvas con lista explícita, con sus posiciones', async () => {
    await st().deleteTable('t1');
    log = [];
    await useUndoStore.getState().undoLast();
    expect(ops.get('views:v1')).toBe('upsert');                          // la vista revivió en el modelo
    expect(new Set(draft.sa1.tableIds)).toEqual(new Set(['t1', 't2']));
    expect(new Set(draft.sa1.viewIds)).toEqual(new Set(['v1', 'v2']));
    expect(draft.sa1.layout.v1).toEqual({ x: 0, y: 300 });
    expect(draft.sa1.layout.t1).toEqual({ x: 0, y: 0 });
    expect(draft.sa2.viewIds).toEqual(['v1']);
    expect(draft.sa2.layout).toEqual({ t1: { x: 5, y: 5 }, v1: { x: 5, y: 205 } });   // la tabla, en su posición
    expect(puts().sort()).toEqual(['put:sa1', 'put:sa2', 'put:sa3']);   // una escritura por canvas
  });

  it('un canvas sin lista explícita sigue sin lista tras deshacer; la tabla vuelve a su sitio', async () => {
    await st().deleteTable('t1');
    await useUndoStore.getState().undoLast();
    expect(draft.sa3.viewIds).toBeUndefined();
    expect(draft.sa3.tableIds).toEqual(['t1']);
    expect(draft.sa3.layout).toEqual({ t1: { x: 9, y: 9 }, v1: { x: 9, y: 209 } });
  });

  it('también si el backend no cascadeara el lote: lo que sacó el propio front vuelve igual', async () => {
    cascadeOnDelete = false;
    await st().deleteTable('t1');
    expect(draft.sa1.viewIds).toEqual(['v2']);
    await useUndoStore.getState().undoLast();
    expect(new Set(draft.sa1.viewIds)).toEqual(new Set(['v1', 'v2']));
    expect(draft.sa1.layout.v1).toEqual({ x: 0, y: 300 });
    expect(draft.sa2.viewIds).toEqual(['v1']);
    expect(draft.sa2.layout.v1).toEqual({ x: 5, y: 205 });
  });
});

describe('borrar una tabla cuando falla una lectura de la cascada', () => {
  it.each([
    ['las vistas', () => vi.mocked(viewsSvc.listViews).mockRejectedValueOnce(new Error('sin red'))],
    ['las relaciones', () => vi.mocked(gov.listRelationships).mockRejectedValueOnce(new Error('sin red'))],
    ['las columnas', () => vi.mocked(gov.listColumns).mockRejectedValueOnce(new Error('sin red'))],
    ['los canvases', () => vi.mocked(gov.tableUsage).mockRejectedValueOnce(new Error('sin red'))],
  ])('si no se pudo leer %s, no se borra nada y se dice por qué', async (_label, fail) => {
    fail();
    const before = structuredClone(draft);
    await expect(st().deleteTable('t1')).rejects.toThrow(DEPENDENTS);
    expect(gov.recordChangesBulk).not.toHaveBeenCalled();
    expect(gov.deleteTable).not.toHaveBeenCalled();
    expect(puts()).toEqual([]);
    expect(draft).toEqual(before);
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('en solo lectura el motivo es ese (no «no se pudo leer») y tampoco se borra nada', async () => {
    useSessionStore.setState({ openMode: 'readonly' });
    await expect(st().deleteTable('t1')).rejects.toThrow(/edit mode|read-only/);
    await expect(st().deleteView(V1 as never, { canvasIds: ['sa1'] })).rejects.toThrow(/edit mode|read-only/);
    expect(gov.recordChangesBulk).not.toHaveBeenCalled();
    expect(viewsSvc.deleteView).not.toHaveBeenCalled();
    expect(puts()).toEqual([]);
  });

  it('si no se pudo anotar dónde estaban sus vistas (para el Undo), tampoco', async () => {
    vi.mocked(csvc.effective).mockRejectedValueOnce(new Error('sin red'));
    await expect(st().deleteTable('t1')).rejects.toThrow(DEPENDENTS);
    expect(gov.recordChangesBulk).not.toHaveBeenCalled();
    expect(gov.deleteTable).not.toHaveBeenCalled();
    expect(puts()).toEqual([]);
  });
});

describe('borrar una vista y deshacer', () => {
  it('con los canvases del llamador (inspector): el Undo la devuelve a cada lista explícita, en su sitio', async () => {
    await st().deleteView(V1 as never, { canvasIds: ['sa1', 'sa2', 'sa3'] });
    expect(deleted('views', 'v1')).toBe(true);
    expect(draft.sa1.viewIds).toEqual(['v2']);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Delete view V_T1']);
    log = [];
    await useUndoStore.getState().undoLast();
    expect(ops.get('views:v1')).toBe('upsert');
    expect(new Set(draft.sa1.viewIds)).toEqual(new Set(['v1', 'v2']));
    expect(draft.sa1.layout.v1).toEqual({ x: 0, y: 300 });
    expect(draft.sa2.viewIds).toEqual(['v1']);
    expect(draft.sa2.layout.v1).toEqual({ x: 5, y: 205 });
    expect(draft.sa3.viewIds).toBeUndefined();                          // sin lista explícita: no se toca
    expect(puts().sort()).toEqual(['put:sa1', 'put:sa2']);
  });

  it('desde el panel del canvas (sin lista de canvases): los resuelve el store y el Undo es el mismo', async () => {
    st().setSelectedView('v1');
    await st().deleteView(V1 as never);
    expect(st().selectedViewId).toBeNull();
    expect(st().dirty).toBe(true);
    await useUndoStore.getState().undoLast();
    expect(new Set(draft.sa1.viewIds)).toEqual(new Set(['v1', 'v2']));
    expect(draft.sa1.layout.v1).toEqual({ x: 0, y: 300 });
    expect(draft.sa2.viewIds).toEqual(['v1']);
    expect(draft.sa2.layout.v1).toEqual({ x: 5, y: 205 });
  });

  it('desde el panel de la vista (copia del diagrama, sin su SQL de Erwin): el Undo repone el documento completo', async () => {
    const full = { ...structuredClone(V1), sql: 'CREATE VIEW V_T1 AS SELECT CODCLIENTE FROM M_T1', description: 'Vista de T1' };
    vi.mocked(viewsSvc.tableViews).mockImplementationOnce(async () =>
      ({ views: [{ ...structuredClone(full), canvases: [{ id: 'sa1', name: 'sa1' }] }], total: 1 }) as never);
    await st().deleteView(structuredClone(V1) as never);           // el diagrama no trae `sql`
    await useUndoStore.getState().undoLast();
    const restored = vi.mocked(viewsSvc.updateView).mock.calls.at(-1);
    expect(restored?.[0]).toBe('v1');
    expect(restored?.[1]).toEqual(full);                           // sin `canvases` (no es parte del documento)
  });

  it('desde el panel, si el listado de su tabla no la trae: el Undo repone el documento vigente', async () => {
    const full = { ...structuredClone(V1), sql: 'CREATE VIEW V_T1 AS SELECT CODCLIENTE FROM M_T1' };
    vi.mocked(viewsSvc.tableViews).mockImplementationOnce(async () => ({ views: [], total: 0 }) as never);
    vi.mocked(viewsSvc.currentView).mockResolvedValueOnce(structuredClone(full) as never);
    await st().deleteView(structuredClone(V1) as never);
    await useUndoStore.getState().undoLast();
    expect(vi.mocked(viewsSvc.updateView).mock.calls.at(-1)).toEqual(['v1', full]);
  });

  it('con los canvases del llamador: no relee su tabla y la pre-imagen es la del llamador', async () => {
    vi.mocked(viewsSvc.tableViews).mockClear();
    vi.mocked(viewsSvc.currentView).mockClear();
    const caller = { ...structuredClone(V1), sql: 'SQL DEL LLAMADOR', canvases: [{ id: 'sa1', name: 'sa1' }] };
    await st().deleteView(caller as never, { canvasIds: ['sa1'] });
    expect(viewsSvc.tableViews).not.toHaveBeenCalled();
    expect(viewsSvc.currentView).not.toHaveBeenCalled();
    await useUndoStore.getState().undoLast();
    const doc: Record<string, unknown> = { ...caller };
    delete doc.canvases;
    expect(vi.mocked(viewsSvc.updateView).mock.calls.at(-1)).toEqual(['v1', doc]);
  });

  it('si no se pudo leer dónde está, no se borra nada', async () => {
    vi.mocked(viewsSvc.tableViews).mockRejectedValueOnce(new Error('sin red'));
    await expect(st().deleteView(V1 as never)).rejects.toThrow(/nothing was deleted/);
    expect(viewsSvc.deleteView).not.toHaveBeenCalled();
    expect(useUndoStore.getState().stack).toEqual([]);
  });
});

describe('«Import existing tables» con vistas que no se pudieron leer', () => {
  it('importa las tablas igual y avisa que faltan sus vistas', async () => {
    vi.mocked(viewsSvc.listViewsForTables).mockRejectedValueOnce(new Error('sin red'));
    await st().addExistingTables(['t3'], { withViews: true });
    expect(draft.sa1.tableIds).toContain('t3');
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/was imported, but its views couldn't be loaded: add them from its Views tab/));
  });

  it('sin fallo no avisa', async () => {
    await st().addExistingTables(['t3'], { withViews: true });
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
