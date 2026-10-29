// Una vista multi-fuente (t1 + t2) se borra con cualquiera de sus tablas
// (`listViews(t1)` la trae) y la cascada del backend la saca de todo canvas que
// la lista, también de uno que tiene t2 pero no t1. El Undo de borrar t1 mira
// también los canvases de sus vistas, no solo los de la tabla: si no, en ese
// canvas la vista no volvería (ni su posición). Backend en memoria del harness de
// `deleteUndo.test.ts`, con la vista v3 y el canvas sa4 (solo t2, lista v3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock('@/services/changeset.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/changeset.service')>();
  return {
    ...actual, effective: vi.fn(), recordChange: vi.fn(), recordChangesBulk: vi.fn(),
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
}));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import * as csvc from '@/services/changeset.service';
import * as mod from '../features/modeler/services/modeler.service';
import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';
import { lotTo } from './canvasLot.testutil';
import type { SubjectArea } from '../features/modeler/services/modeler.service';

type Pos = { x: number; y: number };
const TABLES = ['t1', 't2', 't3'].map((id) => ({ id, physicalName: `M_${id.toUpperCase()}`, logicalName: id }));
const V1 = { id: 'v1', name: 'V_T1', tableId: 't1', sourceTableIds: ['t1'], showOnCanvas: true, sources: [] };
const V2 = { id: 'v2', name: 'V_T2', tableId: 't2', sourceTableIds: ['t2'], showOnCanvas: true, sources: [] };
const V3 = { id: 'v3', name: 'V_T1_T2', tableId: 't1', sourceTableIds: ['t1', 't2'], showOnCanvas: true, sources: [] };
const VIEWS = [V1, V2, V3];
const DEPENDENTS = "Couldn't check what depends on this table: nothing was deleted. Try again.";

let draft: Record<string, SubjectArea> = {};
let ops = new Map<string, 'upsert' | 'delete'>();
let cascadeOnDelete = true;
let log: string[] = [];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const st = () => useModelerStore.getState();
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
    // Canvas con lista explícita que tiene solo t2 y muestra la vista multi-fuente v3 (t1+t2).
    sa4: { id: 'sa4', projectId: 'p', name: 'Cuatro', folderId: null, tableIds: ['t2'], viewIds: ['v3'],
      layout: { t2: { x: 70, y: 70 }, v3: { x: 70, y: 270 } }, drawings: [], udpValues: {}, routes: {} } as SubjectArea,
    // Canvas sin lista explícita de vistas: muestra `v1` por su fuente.
    sa3: { id: 'sa3', projectId: 'p', name: 'Tres', folderId: null, tableIds: ['t1'],
      layout: { t1: { x: 9, y: 9 }, v1: { x: 9, y: 209 } }, drawings: [], udpValues: {}, routes: {} } as SubjectArea,
  };
  vi.mocked(csvc.effective).mockImplementation(async (_cs, _coll, opts) => {
    const ids = opts?.ids ?? [];
    for (const id of ids) log.push(`get:${id}`);
    const snaps = ids.filter((id) => draft[id]).map((id) => structuredClone(draft[id]));
    await sleep(2);
    return snaps as never;
  });
  vi.mocked(csvc.recordChangesBulk).mockImplementation(lotTo(gov.recordChangesBulk, csvc.recordChange));
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


describe('borrar una tabla con una vista multi-fuente', () => {
  it('deshacer devuelve la vista, en su posición, al canvas que la listaba sin la tabla borrada', async () => {
    await st().deleteTable('t1');
    expect(deleted('views', 'v3')).toBe(true);           // listViews(t1) incluye v3: se borra con t1
    expect(draft.sa4.viewIds).toEqual([]);                // la cascada del backend la sacó de sa4
    await useUndoStore.getState().undoLast();
    expect(ops.get('views:v3')).toBe('upsert');           // la vista revivió en el modelo
    expect({ viewIds: draft.sa4.viewIds, pos: draft.sa4.layout.v3 ?? null })
      .toEqual({ viewIds: ['v3'], pos: { x: 70, y: 270 } });
    expect(draft.sa4.tableIds).toEqual(['t2']);          // la tabla borrada no entra a ese canvas
    expect(draft.sa4.layout.t1).toBeUndefined();
  });

  it('el Undo va en un solo envío, también con el canvas que solo tenía la vista', async () => {
    await st().deleteTable('t1');
    vi.mocked(csvc.recordChangesBulk).mockClear();
    await useUndoStore.getState().undoLast();
    expect(csvc.recordChangesBulk).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(csvc.recordChangesBulk).mock.calls[0][1];
    expect(sent.filter((c) => c.collection === 'subject_areas').map((c) => c.entityId).sort()).toEqual(['sa1', 'sa2', 'sa3', 'sa4']);
  });

  it('sin la cascada del backend, el borrado la saca igual de ese canvas y el Undo la repone', async () => {
    cascadeOnDelete = false;
    await st().deleteTable('t1');
    expect(draft.sa4.viewIds).toEqual([]);
    expect(draft.sa4.layout.v3).toBeUndefined();
    await useUndoStore.getState().undoLast();
    expect({ viewIds: draft.sa4.viewIds, pos: draft.sa4.layout.v3 ?? null })
      .toEqual({ viewIds: ['v3'], pos: { x: 70, y: 270 } });
  });

  it('con ese canvas abierto, el Explorer se refresca una vez (lo hace la recarga: cambia su firma)', async () => {
    await st().selectSubjectArea('sa4');
    const tick = st().explorerTick;
    await st().deleteTable('t1');
    expect(st().diagram?.views.map((v) => v.id)).toEqual([]);   // la vista salió de pantalla
    expect(st().explorerTick - tick).toBe(1);
  });

  it('si no se pueden leer los canvases de sus vistas, no se borra nada', async () => {
    vi.mocked(viewsSvc.tableViews).mockRejectedValueOnce(new Error('sin red'));
    const before = structuredClone(draft);
    await expect(st().deleteTable('t1')).rejects.toThrow(DEPENDENTS);
    expect(csvc.recordChangesBulk).not.toHaveBeenCalled();
    expect(gov.recordChangesBulk).not.toHaveBeenCalled();
    expect(gov.deleteTable).not.toHaveBeenCalled();
    expect(draft).toEqual(before);
  });
});
