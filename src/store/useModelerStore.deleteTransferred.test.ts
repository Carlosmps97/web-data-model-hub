// Borrar una tabla o una vista con la versión recién transferida: la lectura de
// la cascada falla con 403 de esa versión y la revalidación la degrada a solo
// lectura (y avisa). El borrado no agrega «…nothing was deleted. Try again.»,
// que sería falso: en esa sesión no se puede reintentar. Criterio: un
// 403/404/409 de la versión espera la revalidación; si la sesión cambia, el error
// original sigue (los llamadores lo callan); si no (rol perdido, proxy), se
// muestra el aviso habitual. Harness de `deleteUndo.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock('@/services/changeset.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/changeset.service')>();
  return { ...actual, effective: vi.fn(), recordChange: vi.fn() };
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

import { ApiError } from '@/services/http';
import { trackRevalidation } from '../features/modeler/lib/sessionGuard';
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


/** La lectura de la cascada falla con 403 de la versión; `transfer` = la
 *  revalidación (registrada antes de que el error llegue, como el observador
 *  HTTP) la degrada a solo lectura. */
function refuseRead(transfer: boolean): void {
  vi.mocked(gov.listRelationships).mockImplementationOnce(async () => {
    trackRevalidation(new Promise<void>((res) => setTimeout(() => {
      if (transfer) useSessionStore.getState().openModel({ projectId: 'p', mode: 'readonly' });
      res();
    }, 10)));
    throw new ApiError('Only published versions and your own drafts can be opened in the canvas.', 403, null,
      '/api/changesets/cs1/effective/relationships?tableId=t1');
  });
}

describe('borrar con la versión recién transferida', () => {
  it('tabla: no dice «Try again» — sigue el error original, para que el llamador lo calle', async () => {
    refuseRead(true);
    const err = await st().deleteTable('t1').then(() => null, (e: unknown) => e as Error);
    expect(err?.message ?? '').not.toMatch(/Try again/);
    expect(err).toBeInstanceOf(ApiError);
    expect(gov.recordChangesBulk).not.toHaveBeenCalled();
  });

  it('tabla: si la sesión sigue igual (rol perdido, proxy), el aviso de siempre, después de la revalidación', async () => {
    refuseRead(false);
    await expect(st().deleteTable('t1')).rejects.toThrow(DEPENDENTS);
  });

  it('tabla: si mientras leía se abrió otra versión en edición, sigue el error original (no el «Try again» de otra sesión)', async () => {
    vi.mocked(gov.listRelationships).mockImplementationOnce(async () => {
      await sleep(5);
      useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId: 'cs2' });
      throw new Error('sin red');
    });
    await expect(st().deleteTable('t1')).rejects.toThrow('sin red');
  });

  it('vista: tampoco dice «Try again»', async () => {
    vi.mocked(viewsSvc.tableViews).mockImplementationOnce(async () => {
      trackRevalidation(new Promise<void>((res) => setTimeout(() => {
        useSessionStore.getState().openModel({ projectId: 'p', mode: 'readonly' }); res();
      }, 10)));
      throw new ApiError('Only the owner can edit this version.', 403, null, '/api/views/for-table?tableId=t1&changesetId=cs1');
    });
    const err = await st().deleteView(V1 as never).then(() => null, (e: unknown) => e as Error);
    expect(err?.message ?? '').not.toMatch(/Try again/);
    expect(viewsSvc.deleteView).not.toHaveBeenCalled();
  });

  it('como inversa de «Create table»: el Undo calla (avisó la revalidación) y no vuelve a la pila', async () => {
    useUndoStore.setState({ stack: [{ label: 'Create table M_T1', run: async () => { await st().deleteTable('t1'); return null; } }], busy: false });
    refuseRead(true);
    await expect(useUndoStore.getState().undoLast()).resolves.toBeNull();
    expect(useUndoStore.getState().stack).toEqual([]);
  });
});
