// Borrar una tabla que está en varios canvases: cada canvas de la tabla fija lo
// que sigue sin posición (su diagrama, una lectura) y el Undo la repone donde se
// veía. Si solo lo fijara el canvas abierto, en los otros las siguientes se
// correrían una casilla y, si después se abriera ese canvas y se creara,
// importara, pegara o hiciera CTAS (que las fija ahí), deshacer las dos acciones
// dejaría la tabla borrada tapando a otra. Store real + structure.service real
// sobre un draft en memoria.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock('@/services/changeset.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/changeset.service')>();
  return {
    ...actual, effective: vi.fn(), recordChange: vi.fn(), recordChangesBulk: vi.fn(),
    writeSeqOf: async () => ({ writeSeq: 0 }),   // el candado del Undo lee el contador (doc 133): nada ajeno
  };
});
vi.mock('@/features/modeler/services/modeler.service', () => ({
  loadDiagram: vi.fn(), setSubjectAreaLayout: vi.fn(), setSubjectAreaDrawings: vi.fn(),
  deleteSubjectArea: vi.fn(), createSubjectArea: vi.fn(), updateSubjectArea: vi.fn(),
  listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(async () => []), listProjects: vi.fn(async () => []),
}));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return {
    ...actual,
    createTable: vi.fn(), physicalize: vi.fn(), searchTables: vi.fn(), recordChangesBulk: vi.fn(),
    listRelationships: vi.fn(), listColumns: vi.fn(), tableUsage: vi.fn(), deleteTable: vi.fn(), updateColumn: vi.fn(),
  };
});
vi.mock('@/services/views.service', () => ({ listViews: vi.fn(), listViewsForTables: vi.fn(), tableViews: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));
vi.mock('@/features/modeler/lib/canvasFocus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/modeler/lib/canvasFocus')>();
  return { ...actual, canvasView: vi.fn() };
});

import * as csvc from '@/services/changeset.service';
import * as mod from '@/features/modeler/services/modeler.service';
import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { canvasView } from '@/features/modeler/lib/canvasFocus';
import { forgetCanvasWrites } from '@/features/modeler/lib/canvasWrites';
import { gridSlot } from '@/features/modeler/lib/viewerLayout';
import type { CanonicalTable } from '@/services/governance.service';
import type { Diagram, SubjectArea } from '@/features/modeler/services/modeler.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';
import { lotTo } from './canvasLot.testutil';

type P = { x: number; y: number };
interface MTable { id: string; projectId: string; physicalName: string; logicalName: string }

const world = { draft: {} as Record<string, SubjectArea>, tables: new Map<string, MTable>() };
const pause = (ms = 1) => new Promise<void>((r) => setTimeout(r, ms));
const st = () => useModelerStore.getState();
const VIEW = { center: { x: 1000, y: 2000 }, rect: { left: 400, top: 1700, right: 1600, bottom: 2300 } };

/** El diagrama como lo arma el backend: las tablas por nombre físico. */
function buildDiagram(saId: string): Diagram {
  const sa = structuredClone(world.draft[saId]);
  if (!sa) throw new Error('404');
  const tables = sa.tableIds.map((id) => world.tables.get(id)).filter((t): t is MTable => !!t)
    .map((t) => ({ ...t })).sort((a, b) => a.physicalName.localeCompare(b.physicalName));
  return { subjectArea: { ...sa, viewIds: sa.viewIds ?? [] }, tables, columns: [], relationships: [], views: [] } as unknown as Diagram;
}

/** Dónde pinta el canvas cada tabla (ModelerCanvas): posición o casilla por número de orden. */
function paintedOf(saId: string): Record<string, P> {
  const dia = buildDiagram(saId);
  const layout = dia.subjectArea.layout ?? {};
  return Object.fromEntries(dia.tables.map((t, i) => [t.id, layout[t.id] ?? gridSlot(i)]));
}

/** Tablas que se tapan exactamente (misma esquina). */
function overlaps(saId: string): string[][] {
  const pos = paintedOf(saId);
  const ids = Object.keys(pos);
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if (pos[ids[i]].x === pos[ids[j]].x && pos[ids[i]].y === pos[ids[j]].y) out.push([ids[i], ids[j]]);
  }
  return out;
}

function flowMock() {
  const nodes = () => {
    const d = st().diagram;
    if (!d) return [];
    return Object.entries(paintedOf(d.subjectArea.id)).map(([id, position]) => ({ id, type: 'table', position: { ...position }, measured: { width: 240, height: 90 } }));
  };
  return {
    getNodes: nodes, getNode: (id: string) => nodes().find((n) => n.id === id),
    screenToFlowPosition: (p: P) => p, setNodes: vi.fn(), getZoom: () => 1, getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: vi.fn(async () => true), setCenter: vi.fn(async () => true),
  } as never;
}

function wire(): void {
  vi.mocked(canvasView).mockReturnValue(VIEW);
  vi.mocked(csvc.effective).mockImplementation(async (_cs, _coll, opts) => {
    const snaps = (opts?.ids ?? []).filter((id) => world.draft[id]).map((id) => structuredClone(world.draft[id]));
    await pause();
    return snaps as never;
  });
  vi.mocked(csvc.recordChangesBulk).mockImplementation(lotTo(gov.recordChangesBulk, csvc.recordChange));
  vi.mocked(csvc.recordChange).mockImplementation(async (_cs, _coll, id, op, payload) => {
    const body = payload ? structuredClone(payload) : undefined;
    await pause();
    if (op === 'delete') delete world.draft[id]; else world.draft[id] = body as unknown as SubjectArea;
    return {} as never;
  });
  vi.mocked(mod.loadDiagram).mockImplementation(async (saId: string) => { await pause(); return buildDiagram(saId) as never; });
  vi.mocked(gov.createTable).mockImplementation(async (t) => { world.tables.set(t.id, { ...(t as MTable) }); return {} as never; });
  vi.mocked(gov.physicalize).mockImplementation(async (s: string) => ({ physical: s.toUpperCase().replace(/\s+/g, '_') }));
  vi.mocked(gov.searchTables).mockImplementation(async () => [] as never);
  vi.mocked(gov.recordChangesBulk).mockImplementation(async (changes) => {
    await pause();
    for (const c of changes as { collection: string; entityId: string; op: string; payload?: unknown }[]) {
      if (c.collection !== 'canonical_tables') continue;
      if (c.op === 'delete') world.tables.delete(c.entityId); else world.tables.set(c.entityId, { ...(c.payload as MTable) });
    }
    return {} as never;
  });
  vi.mocked(gov.listRelationships).mockImplementation(async () => [] as never);
  vi.mocked(gov.listColumns).mockImplementation(async () => [] as never);
  vi.mocked(gov.tableUsage).mockImplementation(async (tid: string) => {
    const usage = Object.values(world.draft).filter((sa) => sa.tableIds.includes(tid)).map((sa) => ({ canvasId: sa.id, canvasName: sa.name }));
    return { usage, total: usage.length } as never;
  });
  vi.mocked(gov.deleteTable).mockImplementation(async (tid: string) => { world.tables.delete(tid); return {} as never; });
  vi.mocked(gov.updateColumn).mockImplementation(async () => ({}) as never);
  vi.mocked(viewsSvc.listViews).mockImplementation(async () => [] as never);
  vi.mocked(viewsSvc.listViewsForTables).mockImplementation(async () => [] as never);
  vi.mocked(viewsSvc.tableViews).mockImplementation(async () => ({ views: [] }) as never);
}

const T = (id: string, physicalName: string): MTable => ({ id, projectId: 'p', physicalName, logicalName: physicalName.toLowerCase() });
const canvas = (id: string, tableIds: string[]): SubjectArea => ({
  id, projectId: 'p', name: id, folderId: null, tableIds, viewIds: [], layout: {}, drawings: [], udpValues: {}, routes: {},
} as unknown as SubjectArea);

// X: A_PRIMERA (0), B_BORRAR (1), C_SEGUNDA (2), D_TERCERA (3) — todas sin posición.
// Y: B_BORRAR + Q_OTRA (el canvas abierto al borrar).
const MODEL = [T('tA', 'A_PRIMERA'), T('tT', 'B_BORRAR'), T('tB', 'C_SEGUNDA'), T('tC', 'D_TERCERA'), T('tQ', 'Q_OTRA'), T('tI', 'Z_IMPORTADA'), T('tI0', 'A0_IMPORTADA')];
const START_X = { tA: gridSlot(0), tT: gridSlot(1), tB: gridSlot(2), tC: gridSlot(3) };

async function openWorld(sas: SubjectArea[], openId: string): Promise<void> {
  world.draft = Object.fromEntries(sas.map((sa) => [sa.id, structuredClone(sa)]));
  world.tables = new Map(MODEL.map((t) => [t.id, { ...t }]));
  forgetCanvasWrites();
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p' });
  useUndoStore.setState({ stack: [], busy: false });
  useModelerStore.setState({
    activeProjectId: 'p', activeSaId: null, diagram: null, openingSaId: null, flow: null, viewMode: 'physical',
    selectedTableId: null, selectedEdgeId: null, selectedViewId: null, freshNodes: {}, tblClipboard: null, dirty: false,
    viewerLayout: {}, viewerRoutesOff: {},
  } as never);
  await st().selectSubjectArea(openId);
  useModelerStore.setState({ flow: flowMock() });
}

async function switchTo(saId: string): Promise<void> { await st().selectSubjectArea(saId); await pause(); }
async function undo(): Promise<void> { await useUndoStore.getState().undoLast(); await pause(2); }

type Mid = 'create' | 'createFirst' | 'import' | 'importFirst' | 'paste' | 'ctas' | 'removeOther';
async function midAction(mid: Mid): Promise<void> {
  if (mid === 'create') await st().createTable({ logicalName: 'zeta', physicalName: 'Z_NUEVA' });
  else if (mid === 'createFirst') await st().createTable({ logicalName: 'a00', physicalName: 'A00_NUEVA' });
  else if (mid === 'import') await st().addExistingTables(['tI']);
  else if (mid === 'importFirst') await st().addExistingTables(['tI0']);
  else if (mid === 'paste') { st().copyTable('tC'); await st().pasteTable(); }
  else if (mid === 'ctas') await st().createTableFromSources({ logicalName: 'zz ctas', columns: [] });
  else await st().removeTableFromArea('tC');
  await pause(2);
}

beforeEach(() => { vi.clearAllMocks(); wire(); });

describe('borrar una tabla que está en un canvas no abierto', () => {
  for (const mid of ['create', 'createFirst', 'import', 'importFirst', 'paste', 'ctas', 'removeOther'] as const) {
    it(`borrar (otro canvas abierto) → abrir ese canvas → ${mid} → Undo → Undo: vuelve exactamente al principio`, async () => {
      await openWorld([canvas('saX', ['tA', 'tT', 'tB', 'tC']), canvas('saY', ['tT', 'tQ'])], 'saY');
      expect(paintedOf('saX')).toEqual(START_X);
      await st().deleteTable('tT');
      await pause(2);
      // En X (no abierto) nadie se corre: lo que sigue sin posición queda donde se veía.
      expect(paintedOf('saX')).toEqual({ tA: gridSlot(0), tB: gridSlot(2), tC: gridSlot(3) });
      await switchTo('saX');
      await midAction(mid);
      await undo();
      await switchTo('saY');                 // el borrado se hizo con Y abierto: se deshace en Y (doc 133)
      await undo();
      expect(paintedOf('saX')).toEqual(START_X);
      expect(overlaps('saX')).toEqual([]);
    });
  }

  it('desde el Object Inspector (la tabla solo está en un canvas que no está abierto): igual', async () => {
    await openWorld([canvas('saX', ['tA', 'tT', 'tB', 'tC']), canvas('saY', ['tQ'])], 'saY');
    await st().deleteTable('tT', { pre: MODEL.find((t) => t.id === 'tT') as unknown as CanonicalTable });
    await pause(2);
    expect(paintedOf('saX')).toEqual({ tA: gridSlot(0), tB: gridSlot(2), tC: gridSlot(3) });
    await switchTo('saX');
    await st().createTable({ logicalName: 'zeta', physicalName: 'Z_NUEVA' });
    await pause(2);
    await undo();
    await switchTo('saY');                   // el Inspector se usó con Y abierto: se deshace en Y (doc 133)
    await undo();
    expect(paintedOf('saX')).toEqual(START_X);
    expect(overlaps('saX')).toEqual([]);
  });

  it('deshacer después de que otra versión publicó un renombre que cambia el orden: vuelve donde se veía, sin tapar', async () => {
    await openWorld([canvas('saX', ['tA', 'tT', 'tB', 'tC']), canvas('saY', ['tT', 'tQ'])], 'saY');
    await st().deleteTable('tT');
    await pause(2);
    // Otra versión publica un renombre: A_PRIMERA pasa a ordenarse después de B_BORRAR.
    world.tables.set('tA', { ...world.tables.get('tA')!, physicalName: 'C_RENOMBRADA' });
    await undo();
    expect(paintedOf('saX').tT).toEqual(gridSlot(1));
    expect(overlaps('saX')).toEqual([]);
  });

  it('si el diagrama de ese canvas no se puede leer, el borrado sigue (ese canvas queda sin cambios)', async () => {
    await openWorld([canvas('saX', ['tA', 'tT', 'tB', 'tC']), canvas('saY', ['tT', 'tQ'])], 'saY');
    vi.mocked(mod.loadDiagram).mockImplementation(async (saId: string) => {
      await pause();
      if (saId === 'saX') throw new Error('network');
      return buildDiagram(saId) as never;
    });
    await st().deleteTable('tT');
    await pause(2);
    expect(world.tables.has('tT')).toBe(false);
    expect(world.draft.saX.tableIds).toEqual(['tA', 'tB', 'tC']);
    expect(world.draft.saY.tableIds).toEqual(['tQ']);
    expect(paintedOf('saX')).toEqual({ tA: gridSlot(0), tB: gridSlot(1), tC: gridSlot(2) });
  });

  it('con todas las tablas posicionadas en el otro canvas no baja su diagrama (le basta su documento) y el Undo la repone en su sitio', async () => {
    const placed = { ...canvas('saX', ['tA', 'tT', 'tB']), layout: { tA: { x: 0, y: 0 }, tT: { x: 300, y: 0 }, tB: { x: 600, y: 0 } } } as SubjectArea;
    await openWorld([placed, canvas('saY', ['tT', 'tQ'])], 'saY');
    vi.mocked(mod.loadDiagram).mockClear();
    await st().deleteTable('tT');
    await pause(2);
    expect(vi.mocked(mod.loadDiagram).mock.calls.map(([id]) => id).filter((id) => id !== 'saY')).toEqual([]);
    expect(world.draft.saX.tableIds).toEqual(['tA', 'tB']);
    await undo();
    expect(paintedOf('saX')).toEqual({ tA: { x: 0, y: 0 }, tT: { x: 300, y: 0 }, tB: { x: 600, y: 0 } });
  });

  it('con alguna tabla sin posición en el otro canvas sí lo baja (para fijar lo que se correría)', async () => {
    const half = { ...canvas('saX', ['tA', 'tT', 'tB']), layout: { tA: { x: 0, y: 0 }, tT: { x: 300, y: 0 } } } as SubjectArea;
    await openWorld([half, canvas('saY', ['tT', 'tQ'])], 'saY');
    vi.mocked(mod.loadDiagram).mockClear();
    await st().deleteTable('tT');
    await pause(2);
    expect(vi.mocked(mod.loadDiagram).mock.calls.map(([id]) => id)).toContain('saX');
  });

  it('si no se puede leer el documento del otro canvas, baja su diagrama como antes y fija lo que se correría', async () => {
    await openWorld([canvas('saX', ['tA', 'tT', 'tB', 'tC']), canvas('saY', ['tT', 'tQ'])], 'saY');
    const read = vi.mocked(csvc.effective).getMockImplementation()!;
    let fail = true;
    vi.mocked(csvc.effective).mockImplementation(async (cs, coll, opts) => {
      if (fail && opts?.ids?.length === 1 && opts.ids[0] === 'saX') { fail = false; throw new Error('network'); }
      return read(cs, coll, opts);
    });
    await st().deleteTable('tT');
    await pause(2);
    expect(paintedOf('saX')).toEqual({ tA: gridSlot(0), tB: gridSlot(2), tC: gridSlot(3) });
  });

  it('con un canvas todo posicionado y otro que no: baja solo el diagrama del que lo necesita, y fija ahí lo que se correría', async () => {
    const placed = { ...canvas('saZ', ['tT', 'tQ']), layout: { tT: { x: 300, y: 0 }, tQ: { x: 600, y: 0 } } } as SubjectArea;
    await openWorld([canvas('saX', ['tA', 'tT', 'tB', 'tC']), placed, canvas('saY', ['tT', 'tQ'])], 'saY');
    vi.mocked(mod.loadDiagram).mockClear();
    await st().deleteTable('tT');
    await pause(2);
    expect(vi.mocked(mod.loadDiagram).mock.calls.map(([id]) => id).filter((id) => id !== 'saY').sort()).toEqual(['saX']);
    expect(paintedOf('saX')).toEqual({ tA: gridSlot(0), tB: gridSlot(2), tC: gridSlot(3) });
    await undo();
    expect(paintedOf('saX')).toEqual(START_X);
    expect(paintedOf('saZ')).toEqual({ tT: { x: 300, y: 0 }, tQ: { x: 600, y: 0 } });
  });

  it('con la tabla solo en el canvas abierto no se lee ningún otro diagrama', async () => {
    await openWorld([canvas('saX', ['tA', 'tB']), canvas('saY', ['tT', 'tQ'])], 'saY');
    vi.mocked(mod.loadDiagram).mockClear();
    await st().deleteTable('tT');
    await pause(2);
    expect(vi.mocked(mod.loadDiagram).mock.calls.map(([id]) => id).filter((id) => id !== 'saY')).toEqual([]);
  });
});
