// La inversa de «Create table» / «Paste table» es borrar la tabla, y ese
// borrado puede fallar sin escribir nada (no pudo leer su cascada). `undoLast`
// ya sacó la entrada de la pila: si no volviera, otro Ctrl+Z deshacería otra
// acción y la tabla seguiría viva. Por eso la entrada vuelve a la pila y el
// aviso pide pulsar Undo otra vez. Harness de `deleteUndo.test.ts`.
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
const VIEWS = [V1, V2];
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
 *  y del layout (un canvas sin lista explícita de vistas conserva su posición). */
function prune(sa: SubjectArea): SubjectArea {
  const listed = [...(sa.tableIds ?? []), ...(Array.isArray(sa.viewIds) ? sa.viewIds : [])];
  const gone = new Set(listed.filter((id) => deleted('canonical_tables', id) || deleted('views', id)));
  const out = { ...sa };
  out.tableIds = (sa.tableIds ?? []).filter((t) => !gone.has(t));
  if (Array.isArray(sa.viewIds)) out.viewIds = sa.viewIds.filter((v) => !gone.has(v));
  if (sa.layout) out.layout = Object.fromEntries(Object.entries(sa.layout).filter(([k]) => !gone.has(k)));
  return out;
}
/** Vistas que el canvas muestra: su lista explícita o, sin ella, las de sus fuentes. */
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
    // Otro canvas con lista explícita que también muestra v1.
    sa2: { id: 'sa2', projectId: 'p', name: 'Dos', folderId: null, tableIds: ['t1'], viewIds: ['v1'],
      layout: { t1: { x: 5, y: 5 }, v1: { x: 5, y: 205 } }, drawings: [], udpValues: {}, routes: {} } as SubjectArea,
    // Canvas sin lista explícita de vistas: muestra v1 por su fuente.
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
  useModelerStore.setState({ activeSaId: null, diagram: null, dirty: false, viewerLayout: {}, viewerRoutesOff: {}, selectedTableId: null, selectedEdgeId: null, selectedViewId: null, flow: null, activeProjectId: 'p', viewMode: 'physical' } as never);
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


describe('una inversa que borra una tabla y no pudo leer su cascada', () => {
  const stack = () => useUndoStore.getState().stack.map((e) => e.label);

  it('la entrada vuelve a la pila: Undo otra vez reintenta esa acción, no la anterior', async () => {
    const other = vi.fn(async () => null);
    useUndoStore.setState({ stack: [
      { label: 'Rename column X', run: other },                         // acción anterior del usuario
      { label: 'Create table M_T3', run: async () => { await st().deleteTable('t3'); return null; } }, // inversa de crear t3
    ], busy: false });
    vi.mocked(gov.listRelationships).mockRejectedValueOnce(new Error('sin red'));   // un blip de red
    await expect(useUndoStore.getState().undoLast())
      .rejects.toThrow("Couldn't check what depends on this table: nothing was undone. Press Undo to try again.");
    expect(stack()).toEqual(['Rename column X', 'Create table M_T3']);
    expect(gov.recordChangesBulk).not.toHaveBeenCalled();
    // El usuario hace lo que dice el aviso: pulsa Undo otra vez.
    const label = await useUndoStore.getState().undoLast();
    expect({ undid: label, otherRan: other.mock.calls.length, t3Deleted: deleted('canonical_tables', 't3') })
      .toEqual({ undid: 'Create table M_T3', otherRan: 0, t3Deleted: true });
    expect(stack()).toEqual(['Rename column X']);
  });

  it('fuera del Undo (botón Delete) el aviso sigue siendo el del borrado', async () => {
    vi.mocked(gov.listColumns).mockRejectedValueOnce(new Error('sin red'));
    await expect(st().deleteTable('t3')).rejects.toThrow(DEPENDENTS);
  });
});

// En el modelo lógico el diálogo dice «Delete entity»: el rechazo usa los
// mismos sustantivos por modelo (`facetNouns(viewMode)`), también en el aviso
// del Undo.
describe('el aviso usa los sustantivos del modelo abierto', () => {
  it('lógico: «this entity» al borrar y al deshacer', async () => {
    st().setViewMode('logical');
    vi.mocked(gov.listColumns).mockRejectedValueOnce(new Error('sin red'));
    await expect(st().deleteTable('t3'))
      .rejects.toThrow("Couldn't check what depends on this entity: nothing was deleted. Try again.");
    useUndoStore.setState({ stack: [{ label: 'Create table M_T3', run: async () => { await st().deleteTable('t3'); return null; } }], busy: false });
    vi.mocked(gov.listColumns).mockRejectedValueOnce(new Error('sin red'));
    await expect(useUndoStore.getState().undoLast())
      .rejects.toThrow("Couldn't check what depends on this entity: nothing was undone. Press Undo to try again.");
  });

  it('físico: «this table»', async () => {
    st().setViewMode('physical');
    vi.mocked(gov.listColumns).mockRejectedValueOnce(new Error('sin red'));
    await expect(st().deleteTable('t3')).rejects.toThrow(DEPENDENTS);
  });
});
