// El color de una caja en un canvas vive mientras la caja está en ese canvas.
// Prueba integrada: el store real con el `structure.service` real (su cola de
// escrituras) contra un draft en memoria. Sacar o borrar una tabla o vista le
// quita su color de ese canvas (no queda guardado para revivir si la caja
// vuelve); el Undo lo repone con la caja; una caja que vuelve a entrar llega con
// el color de su tabla; los colores de los demás canvases no se tocan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
vi.mock('@/services/changeset.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/changeset.service')>();
  return { ...actual, effective: vi.fn(), recordChange: vi.fn() };
});
vi.mock('@/features/modeler/services/modeler.service', () => ({
  loadDiagram: vi.fn(), listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(async () => []),
  listProjects: vi.fn(async () => []),
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
vi.mock('@/services/views.service', () => ({
  listViews: vi.fn(async () => []), listViewsForTables: vi.fn(async () => []),
  deleteView: vi.fn(), updateView: vi.fn(async () => ({})), tableViews: vi.fn(async () => ({ views: [] })),
}));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import * as csvc from '@/services/changeset.service';
import * as mod from '@/features/modeler/services/modeler.service';
import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';
import type { SubjectArea } from '@/features/modeler/services/modeler.service';

const TABLES = ['t1', 't2', 't3'].map((id) => ({ id, physicalName: `M_${id.toUpperCase()}`, logicalName: id }));
const VIEWS = [
  { id: 'v1', name: 'V_T1', sourceTableIds: ['t1'], showOnCanvas: true },
  { id: 'v2', name: 'V_T2', sourceTableIds: ['t2'], showOnCanvas: true },
];
const canvas = (over: Partial<SubjectArea> = {}): SubjectArea => ({
  id: 'sa1', projectId: 'p', name: 'Canvas', folderId: null,
  tableIds: ['t1', 't2'], viewIds: ['v1', 'v2'],
  layout: { t1: { x: 0, y: 0 }, t2: { x: 400, y: 0 }, v1: { x: 0, y: 300 }, v2: { x: 400, y: 300 } },
  drawings: [], udpValues: {}, routes: {},
  colors: { t1: '#111111', t2: 'none', v1: 'theme:a', v2: '#FFC000' }, ...over,
});

let draft: Record<string, SubjectArea> = {};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const st = () => useModelerStore.getState();
const undo = () => useUndoStore.getState().undoLast();
const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => { unhandled.push(e); };

const flowOf = () => ({
  getNodes: () => Object.entries(st().diagram?.subjectArea.layout ?? {}).map(([id, position]) => ({ id, type: 'table', position })),
  getNode: (id: string) => { const p = st().diagram?.subjectArea.layout?.[id]; return p ? { id, position: p } : undefined; },
  setNodes: vi.fn(),
  screenToFlowPosition: (p: { x: number; y: number }) => p,
}) as never;

beforeEach(async () => {
  vi.resetAllMocks();
  draft = {
    sa1: canvas(),
    sa2: canvas({ id: 'sa2', name: 'Otro', tableIds: ['t1'], viewIds: [], layout: { t1: { x: 5, y: 5 } },
                  colors: { t1: '#222222' } }),
  };
  vi.mocked(csvc.effective).mockImplementation(async (_cs, _coll, opts) => {
    const id = opts?.ids?.[0] as string;
    const snap = draft[id] ? structuredClone(draft[id]) : null;
    await sleep(2);
    return (snap ? [snap] : []) as never;
  });
  vi.mocked(csvc.recordChange).mockImplementation(async (_cs, _coll, id, op, payload) => {
    const body = payload ? structuredClone(payload) : undefined;
    await sleep(2);
    if (op === 'delete') delete draft[id]; else draft[id] = body as unknown as SubjectArea;
    return {} as never;
  });
  vi.mocked(mod.loadDiagram).mockImplementation(async (saId: string) => {
    const snap = draft[saId] ? structuredClone(draft[saId]) : null;
    await sleep(2);
    if (!snap) throw new Error('404');
    const viewIds = snap.viewIds ?? [];
    return {
      subjectArea: { ...snap, viewIds }, tables: TABLES.filter((t) => snap.tableIds.includes(t.id)), columns: [],
      relationships: [], views: VIEWS.filter((v) => viewIds.includes(v.id)),
    } as never;
  });
  vi.mocked(gov.listRelationships).mockImplementation(async () => []);
  vi.mocked(gov.listColumns).mockImplementation(async () => []);
  vi.mocked(gov.tableUsage).mockImplementation(async () => ({ usage: [], total: 0 }) as never);
  vi.mocked(gov.recordChangesBulk).mockImplementation(async () => ({}) as never);
  vi.mocked(gov.deleteTable).mockImplementation(async () => ({}) as never);
  vi.mocked(viewsSvc.listViews).mockImplementation(async () => [] as never);
  vi.mocked(viewsSvc.listViewsForTables).mockImplementation(async () => [] as never);
  vi.mocked(viewsSvc.updateView).mockImplementation(async () => ({}) as never);
  vi.mocked(viewsSvc.tableViews).mockImplementation(async () => ({ views: [] }) as never);
  // La cascada del backend: borrar una vista la saca de todo canvas que la
  // lista, con su posición y su color.
  vi.mocked(viewsSvc.deleteView).mockImplementation(async (id: string) => {
    for (const sa of Object.values(draft)) {
      if (!sa.viewIds?.includes(id)) continue;
      sa.viewIds = sa.viewIds.filter((v) => v !== id);
      delete sa.layout[id];
      if (sa.colors) delete sa.colors[id];
    }
    return {} as never;
  });
  const naming = await import('@/services/naming.service');
  vi.mocked(naming.getNamingConfig).mockImplementation(async () => ({}) as never);

  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p' });
  useUndoStore.setState({ stack: [], busy: false });
  useModelerStore.setState({ activeSaId: null, diagram: null, dirty: false, viewerLayout: {}, viewerRoutesOff: {}, selectedTableId: null, selectedEdgeId: null, selectedViewId: null, flow: null, activeProjectId: 'p' } as never);
  await st().selectSubjectArea('sa1');
  useModelerStore.setState({ flow: flowOf() });
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});
afterEach(async () => {
  await sleep(40);
  process.off('unhandledRejection', onUnhandled);
  expect(unhandled, 'unhandledRejection durante la prueba').toEqual([]);
});

describe('sacar una caja del canvas', () => {
  it('su color en este canvas sale con ella (y el de su vista huérfana); el de otro canvas queda; deshacer lo repone', async () => {
    await st().removeTableFromArea('t1');                      // `v1` (solo `t1`) sale huérfana
    expect(draft.sa1.colors).toEqual({ t2: 'none', v2: '#FFC000' });
    expect(st().canvasColors).toEqual({ t2: 'none', v2: '#FFC000' });
    expect(draft.sa2.colors).toEqual({ t1: '#222222' });
    await undo();
    expect(draft.sa1.colors).toEqual(canvas().colors);
    expect(st().canvasColors).toEqual(canvas().colors);
  });

  it('si después se vuelve a importar, llega con el color de su tabla (no revive el color anterior)', async () => {
    await st().removeTableFromArea('t1');
    await st().addExistingTables(['t1']);
    expect(draft.sa1.tableIds).toContain('t1');
    expect(draft.sa1.colors).toEqual({ t2: 'none', v2: '#FFC000' });
    expect(st().canvasColors.t1).toBeUndefined();
  });

  it('una vista: sale con su color y el Undo lo repone', async () => {
    await st().removeViewFromCanvas('v2');
    expect(draft.sa1.colors).toEqual({ t1: '#111111', t2: 'none', v1: 'theme:a' });
    await undo();
    expect(draft.sa1.colors).toEqual(canvas().colors);
  });
});

describe('borrar la tabla o la vista del modelo', () => {
  it('la tabla sale con su color de cada canvas; deshacer lo repone en cada uno', async () => {
    vi.mocked(gov.tableUsage).mockImplementation(async () => ({ usage: [{ canvasId: 'sa1' }, { canvasId: 'sa2' }], total: 2 }) as never);
    await st().deleteTable('t1');
    expect(draft.sa1.colors).toEqual({ t2: 'none', v1: 'theme:a', v2: '#FFC000' });
    expect(draft.sa2.colors).toEqual({});
    await undo();
    expect(draft.sa1.colors).toEqual(canvas().colors);
    expect(draft.sa2.colors).toEqual({ t1: '#222222' });
  });

  it('la vista: la cascada del backend saca su color; deshacer lo repone donde estaba', async () => {
    await st().deleteView({ ...VIEWS[1], canvases: [] } as never, { canvasIds: ['sa1'] });
    expect(draft.sa1.colors).toEqual({ t1: '#111111', t2: 'none', v1: 'theme:a' });
    await undo();
    expect(draft.sa1.viewIds).toContain('v2');
    expect(draft.sa1.colors).toEqual(canvas().colors);
  });
});
