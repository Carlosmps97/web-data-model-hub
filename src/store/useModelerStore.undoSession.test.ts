// Doc 105 (H1) — una inversa de Undo, o una acción de varias escrituras, es de
// la SESIÓN donde empezó. Los servicios toman la versión al llamarlos: si en el
// medio se abre otra versión, lo que falta se escribía en ELLA (el revisor lo
// vio con Ctrl+Z de «Delete table»: `recordChange('cs2', 'subject_areas',
// 'sa3')`). Backend EN MEMORIA como el de `deleteUndo.test.ts`; cada escritura
// anota la versión a la que va (la que el servicio real tomaría al llamarlo).
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
    recordChangesBulk: vi.fn(), deleteTable: vi.fn(), updateColumn: vi.fn(),
  };
});
vi.mock('@/services/views.service', () => ({
  listViews: vi.fn(), listViewsForTables: vi.fn(), tableViews: vi.fn(), deleteView: vi.fn(), updateView: vi.fn(),
}));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import { toast } from 'sonner';
import * as csvc from '@/services/changeset.service';
import * as mod from '../features/modeler/services/modeler.service';
import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { SessionChangedError } from '../features/modeler/lib/sessionGuard';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';
import type { SubjectArea } from '../features/modeler/services/modeler.service';

type Pos = { x: number; y: number };
const TABLES = ['t1', 't2', 't3'].map((id) => ({ id, physicalName: `M_${id.toUpperCase()}`, logicalName: id }));
const V1 = { id: 'v1', name: 'V_T1', tableId: 't1', sourceTableIds: ['t1'], showOnCanvas: true, sources: [{ tableId: 't1', column: 'C1' }] };
const V2 = { id: 'v2', name: 'V_T2', tableId: 't2', sourceTableIds: ['t2'], showOnCanvas: true, sources: [] };
const VIEWS = [V1, V2];

let draft: Record<string, SubjectArea> = {};
let ops = new Map<string, 'upsert' | 'delete'>();
/** Escrituras, cada una con la versión a la que fue: `<cs>:<qué>:<id>`. */
let writes: string[] = [];
let latency = 2;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const st = () => useModelerStore.getState();
const csNow = () => useSessionStore.getState().activeChangesetId;
const deleted = (coll: string, id: string) => ops.get(`${coll}:${id}`) === 'delete';
const toCs2 = () => writes.filter((w) => w.startsWith('cs2:'));
const openCs2 = () => useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId: 'cs2' });
const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => { unhandled.push(e); };

/** Cascada de membresía del backend (doc 88 §4) al borrar una tabla o vista. */
function cascade(coll: string, id: string): void {
  const field = coll === 'views' ? 'viewIds' : 'tableIds';
  for (const sa of Object.values(draft)) {
    const list = sa[field];
    if (!Array.isArray(list) || !list.includes(id)) continue;
    (sa as unknown as Record<string, unknown>)[field] = list.filter((x) => x !== id);
    if (sa.layout) delete sa.layout[id];
  }
}
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
  ops = new Map();
  latency = 2;
  draft = {
    sa1: { id: 'sa1', projectId: 'p', name: 'Uno', folderId: null, tableIds: ['t1', 't2'], viewIds: ['v1', 'v2'],
      layout: { t1: { x: 0, y: 0 }, t2: { x: 400, y: 0 }, v1: { x: 0, y: 300 }, v2: { x: 400, y: 300 } },
      drawings: [], udpValues: {}, routes: {} } as SubjectArea,
    sa2: { id: 'sa2', projectId: 'p', name: 'Dos', folderId: null, tableIds: ['t1'], viewIds: ['v1'],
      layout: { t1: { x: 5, y: 5 }, v1: { x: 5, y: 205 } }, drawings: [], udpValues: {}, routes: {} } as SubjectArea,
    sa3: { id: 'sa3', projectId: 'p', name: 'Tres', folderId: null, tableIds: ['t1'],
      layout: { t1: { x: 9, y: 9 }, v1: { x: 9, y: 209 } }, drawings: [], udpValues: {}, routes: {} } as SubjectArea,
  };
  vi.mocked(csvc.effective).mockImplementation(async (_cs, _coll, opts) => {
    const id = opts?.ids?.[0] as string;
    const snap = draft[id] ? structuredClone(draft[id]) : null;
    await sleep(latency);
    return (snap ? [snap] : []) as never;
  });
  vi.mocked(csvc.recordChange).mockImplementation(async (cs, coll, id, op, payload) => {
    writes.push(`${cs}:${coll}:${id}`);
    await sleep(latency);
    if (coll === 'subject_areas' && op !== 'delete') draft[id] = structuredClone(payload) as unknown as SubjectArea;
    else if (coll !== 'subject_areas') ops.set(`${coll}:${id}`, op);
    return {} as never;
  });
  // Los mocks de governance / views anotan la versión de la sesión AL LLAMARLOS:
  // es la que tomaría el servicio real (`writableCs()` / `editingCs()`).
  vi.mocked(gov.recordChangesBulk).mockImplementation(async (changes) => {
    writes.push(`${csNow()}:bulk`);
    await sleep(latency);
    for (const c of changes) {
      ops.set(`${c.collection}:${c.entityId}`, c.op);
      if (c.op === 'delete' && (c.collection === 'views' || c.collection === 'canonical_tables')) cascade(c.collection, c.entityId);
    }
    return {} as never;
  });
  vi.mocked(gov.deleteTable).mockImplementation(async (id: string) => {
    writes.push(`${csNow()}:table:${id}`);
    ops.set(`canonical_tables:${id}`, 'delete');
    cascade('canonical_tables', id);
    return {} as never;
  });
  vi.mocked(gov.updateColumn).mockImplementation(async (c) => {
    writes.push(`${csNow()}:column:${c.id}`);
    await sleep(latency);
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
  vi.mocked(viewsSvc.tableViews).mockImplementation(async (t: string) => {
    const rows = VIEWS.filter((v) => v.sourceTableIds.includes(t) && !deleted('views', v.id)).map((v) => ({
      ...structuredClone(v),
      canvases: Object.values(draft).filter((sa) => shown(sa).includes(v.id)).map((sa) => ({ id: sa.id, name: sa.name })),
    }));
    return { views: rows, total: rows.length } as never;
  });
  vi.mocked(viewsSvc.deleteView).mockImplementation(async (id: string) => {
    writes.push(`${csNow()}:view-delete:${id}`);
    ops.set(`views:${id}`, 'delete');
    cascade('views', id);
    return { deleted: true };
  });
  vi.mocked(viewsSvc.updateView).mockImplementation(async (id: string, body) => {
    writes.push(`${csNow()}:view:${id}`);
    await sleep(latency);
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
  writes = [];
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});
afterEach(async () => {
  await sleep(40);
  process.off('unhandledRejection', onUnhandled);
  expect(unhandled, 'unhandledRejection durante la prueba').toEqual([]);
});

/** Ctrl+Z y, a los `ms`, el usuario abre OTRA versión en edición. */
async function undoThenOpenCs2(ms: number): Promise<string | null> {
  const undo = useUndoStore.getState().undoLast();
  await sleep(ms);
  openCs2();
  return undo;
}

describe('una inversa EN VUELO cuando se abre otra versión (doc 105, H1)', () => {
  it('«Delete table»: los canvases que faltan no se escriben en la versión nueva, y no se avisa nada', async () => {
    await st().deleteTable('t1');                      // editando cs1
    writes = [];
    latency = 15;
    const label = await undoThenOpenCs2(25);           // va por el primer canvas…
    expect(toCs2()).toEqual([]);                       // antes: ['cs2:subject_areas:sa3']
    expect(writes[0]).toBe('cs1:bulk');                // lo pedido en su sesión sí se escribió
    expect(label).toBeNull();                          // ni «Undid…»…
    expect(toast.error).not.toHaveBeenCalled();        // …ni un error engañoso
  });

  it('«Delete view»: tampoco re-lista la vista en los canvases de la versión nueva', async () => {
    await st().deleteView(V1 as never);
    writes = [];
    latency = 15;
    await undoThenOpenCs2(20);                         // tras reponer la vista, va por los canvases
    expect(toCs2()).toEqual([]);
    expect(writes[0]).toBe('cs1:view:v1');
  });

  it('«Delete column»: las vistas que faltan reponer no se escriben en la versión nueva', async () => {
    const d = st().diagram!;
    useModelerStore.setState({ diagram: { ...d, columns: [{ id: 'c1', tableId: 't1', physicalName: 'C1', logicalName: 'c1', ordinal: 0, dataType: 'STRING', typeOverridden: false }] } });
    await st().deleteColumn('c1');
    writes = [];
    latency = 15;
    await undoThenOpenCs2(8);                          // el lote va; las vistas, después
    expect(toCs2()).toEqual([]);
    expect(writes).toEqual(['cs1:bulk']);
  });

  it('«Reorder columns»: las tandas que faltan no se escriben en la versión nueva', async () => {
    const cols = Array.from({ length: 8 }, (_, i) => ({
      id: `c${i}`, tableId: 't1', physicalName: `C${i}`, logicalName: `c${i}`, ordinal: i, dataType: 'STRING', typeOverridden: false,
    }));
    const d = st().diagram!;
    useModelerStore.setState({ diagram: { ...d, columns: cols } });
    await st().reorderColumns('t1', cols.map((c) => c.id).reverse());   // 8 cambian: tandas de 5 + 3
    // Doc 105 (ronda 6): la recarga de este harness trae la tabla SIN columnas —
    // con su tabla en pantalla, eso sería «se borraron» y la inversa no las re-graba.
    useModelerStore.setState({ diagram: { ...st().diagram!, columns: cols } });
    writes = [];
    latency = 15;
    await undoThenOpenCs2(5);                          // la primera tanda en vuelo
    expect(toCs2()).toEqual([]);
    expect(writes.filter((w) => w.startsWith('cs1:column:'))).toHaveLength(5);
  });

  it('«Create table» (su inversa borra la tabla): si la versión cambia mientras lee, no borra NADA', async () => {
    await st().createTable({ logicalName: 'nueva', physicalName: 'M_NUEVA' });
    writes = [];
    latency = 15;
    const usage = vi.mocked(gov.tableUsage).getMockImplementation()!;
    vi.mocked(gov.tableUsage).mockImplementation(async (t) => { await sleep(15); return usage(t); });
    await undoThenOpenCs2(5);                          // deleteTable está leyendo su cascada
    expect(writes).toEqual([]);
  });
});

describe('una acción de varias escrituras cuando se abre otra versión (doc 105, H1)', () => {
  it('borrar una tabla: si la versión cambia mientras lee su cascada, no borra nada y lo dice', async () => {
    latency = 15;
    const del = st().deleteTable('t1');
    await sleep(5);
    openCs2();
    await expect(del).rejects.toBeInstanceOf(SessionChangedError);
    expect(writes).toEqual([]);
  });

  it('crear una tabla: lo que falta no va a la versión nueva y su inversa no queda en la pila de ella', async () => {
    latency = 15;
    const create = st().createTable({ logicalName: 'nueva', physicalName: 'M_NUEVA' });
    await sleep(5);                                    // la tabla se está grabando en cs1
    openCs2();
    await create.catch(() => {});
    expect(toCs2()).toEqual([]);
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('una acción que TERMINA de escribir y se abre otra versión antes de apilar: su inversa no queda en la pila nueva', async () => {
    latency = 15;
    const load = vi.mocked(mod.loadDiagram).getMockImplementation()!;
    vi.mocked(mod.loadDiagram).mockImplementation(async (saId) => { await sleep(30); return load(saId); });
    const create = st().createTable({ logicalName: 'nueva', physicalName: 'M_NUEVA' });
    await sleep(55);                                   // ya escribió en cs1; recarga el canvas
    expect(writes.length).toBeGreaterThan(0);
    openCs2();
    await create;
    expect(toCs2()).toEqual([]);
    // Sin esto, Ctrl+Z en cs2 borraría ahí una tabla que se creó en cs1.
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('Save (layout y dibujos): si se abre otra versión entre las dos escrituras, los dibujos no van a ella', async () => {
    latency = 15;
    const save = st().saveAll();
    await sleep(5);                                    // el layout se está grabando en cs1
    openCs2();
    await expect(save).rejects.toBeInstanceOf(SessionChangedError);
    expect(toCs2()).toEqual([]);
    expect(writes).toEqual(['cs1:subject_areas:sa1']);
  });

  it('deshacer el borrado del proyecto: si la versión cambia mientras lee el publicado, no lo revive en la nueva', async () => {
    vi.mocked(mod.listProjects).mockImplementation(async () => { await sleep(15); return [{ id: 'p', name: 'P' }] as never; });
    const undo = st().undoProjectDeletion();
    await sleep(5);
    openCs2();
    await expect(undo).rejects.toBeInstanceOf(SessionChangedError);
    expect(writes).toEqual([]);
  });

  it('sin cambio de sesión, todo sigue igual: la inversa corre completa y dice qué deshizo', async () => {
    await st().deleteTable('t1');
    writes = [];
    expect(await useUndoStore.getState().undoLast()).toBe('Delete table M_T1');
    expect(writes.every((w) => w.startsWith('cs1:'))).toBe(true);
    expect(new Set(draft.sa1.tableIds)).toEqual(new Set(['t1', 't2']));
  });
});
