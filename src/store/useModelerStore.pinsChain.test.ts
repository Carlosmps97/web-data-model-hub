// Fijar lo existente sin posición: store real + structure.service real sobre un
// draft en memoria.
//  · Undo en cadena: sacar o borrar A (sin posición) → crear / importar / pegar →
//    Undo → Undo. Sacar A también fija a B y C donde se ven (si no, se correrían
//    una casilla, el alta los fijaría ahí y al reponer A quedaría encima de B):
//    la cadena vuelve exactamente al principio.
//  · Un alta sin posición (canvas no medible) no fija nada: si fijara, la nueva
//    caería en su casilla por número de orden, encima de una tabla fijada.
//  · Importar varias: lo que ya entró por otro camino no cuenta como «entra».
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock('@/services/changeset.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/changeset.service')>();
  return { ...actual, effective: vi.fn(), recordChange: vi.fn() };
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
import { buildViewGraph } from '@/features/modeler/lib/viewGraph';
import type { Diagram, SubjectArea } from '@/features/modeler/services/modeler.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';

type P = { x: number; y: number };
interface MTable { id: string; projectId: string; physicalName: string; logicalName: string }

const world = { draft: {} as Record<string, SubjectArea>, tables: new Map<string, MTable>() };
const pause = (ms = 1) => new Promise<void>((r) => setTimeout(r, ms));
const st = () => useModelerStore.getState();
const VIEW = { center: { x: 1000, y: 2000 }, rect: { left: 400, top: 1700, right: 1600, bottom: 2300 } };

/** El diagrama como lo arma el backend: las tablas por nombre físico. */
function buildDiagram(saId: string): Diagram {
  const sa = structuredClone(world.draft[saId]);
  const tables = sa.tableIds.map((id) => world.tables.get(id)).filter((t): t is MTable => !!t)
    .map((t) => ({ ...t })).sort((a, b) => a.physicalName.localeCompare(b.physicalName));
  return { subjectArea: { ...sa, viewIds: sa.viewIds ?? [] }, tables, columns: [], relationships: [], views: [] } as unknown as Diagram;
}

/** Dónde pinta el canvas cada bloque (ModelerCanvas): posición o casilla por número de orden. */
function painted(dia: Diagram | null): Record<string, P> {
  if (!dia) return {};
  const layout = dia.subjectArea.layout ?? {};
  const tablePos = new Map(dia.tables.map((t, i) => [t.id, layout[t.id] ?? gridSlot(i)]));
  const vs = buildViewGraph(dia.views ?? [], dia.tables, dia.columns, layout, tablePos, () => {});
  return { ...Object.fromEntries(tablePos), ...Object.fromEntries(vs.nodes.map((n) => [n.id, n.position])) };
}

/** Tablas que se tapan exactamente (misma esquina). */
function sameCorner(dia: Diagram | null): string[][] {
  const pos = painted(dia);
  const ids = (dia?.tables ?? []).map((t) => t.id);
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = pos[ids[i]], b = pos[ids[j]];
    if (a && b && a.x === b.x && a.y === b.y) out.push([ids[i], ids[j]]);
  }
  return out;
}

function flowMock() {
  const nodes = () => Object.entries(painted(st().diagram))
    .map(([id, position]) => ({ id, type: 'table', position: { ...position }, measured: { width: 240, height: 90 } }));
  return {
    getNodes: nodes, getNode: (id: string) => nodes().find((n) => n.id === id),
    screenToFlowPosition: (p: P) => p, setNodes: vi.fn(), getZoom: () => 1, getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: vi.fn(async () => true), setCenter: vi.fn(async () => true),
  } as never;
}

function wire(): void {
  vi.mocked(canvasView).mockReturnValue(VIEW);
  vi.mocked(csvc.effective).mockImplementation(async (_cs, _coll, opts) => {
    const snap = world.draft[opts?.ids?.[0] as string];
    await pause();
    return (snap ? [structuredClone(snap)] : []) as never;
  });
  vi.mocked(csvc.recordChange).mockImplementation(async (_cs, _coll, id, op, payload) => {
    await pause();
    if (op === 'delete') delete world.draft[id]; else world.draft[id] = structuredClone(payload) as unknown as SubjectArea;
    return {} as never;
  });
  vi.mocked(mod.loadDiagram).mockImplementation(async (saId: string) => { await pause(); return buildDiagram(saId) as never; });
  vi.mocked(gov.createTable).mockImplementation(async (t) => { world.tables.set(t.id, { ...(t as MTable) }); return {} as never; });
  vi.mocked(gov.physicalize).mockImplementation(async (s: string) => ({ physical: s.toUpperCase().replace(/\s+/g, '_') }));
  vi.mocked(gov.searchTables).mockImplementation(async () => [] as never);
  vi.mocked(gov.recordChangesBulk).mockImplementation(async (changes) => {
    for (const c of changes as { collection: string; entityId: string; op: string; payload?: MTable }[]) {
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
  vi.mocked(viewsSvc.listViews).mockImplementation(async () => [] as never);
  vi.mocked(viewsSvc.listViewsForTables).mockImplementation(async () => [] as never);
  vi.mocked(viewsSvc.tableViews).mockImplementation(async () => ({ views: [] }) as never);
}

const T = (id: string, physicalName: string): MTable => ({ id, projectId: 'p', physicalName, logicalName: physicalName.toLowerCase() });
const ABC = [T('tA', 'A_PRIMERA'), T('tB', 'B_SEGUNDA'), T('tC', 'C_TERCERA')];
const canvasOf = (tableIds: string[], layout: Record<string, P> = {}) => ({
  id: 'saU', projectId: 'p', name: 'U', folderId: null, tableIds, viewIds: [], layout, drawings: [], udpValues: {}, routes: {},
}) as unknown as SubjectArea;

async function openCanvas(sa: SubjectArea, tables: MTable[]): Promise<void> {
  world.draft = { [sa.id]: structuredClone(sa) };
  world.tables = new Map(tables.map((t) => [t.id, { ...t }]));
  forgetCanvasWrites();
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p' });
  useUndoStore.setState({ stack: [], busy: false });
  useModelerStore.setState({
    activeProjectId: 'p', activeSaId: null, diagram: null, openingSaId: null, flow: null, viewMode: 'physical',
    selectedTableId: null, selectedEdgeId: null, selectedViewId: null, freshNodes: {}, tblClipboard: null, dirty: false,
    viewerLayout: {}, viewerRoutesOff: {},
  } as never);
  await st().selectSubjectArea(sa.id);
  useModelerStore.setState({ flow: flowMock() });
}

async function removeThenAddThenUndoTwice(how: 'remove' | 'delete', add: 'create' | 'import' | 'paste', layout: Record<string, P> = {}) {
  await openCanvas(canvasOf(['tA', 'tB', 'tC'], layout), [...ABC, T('tY', 'Y_IMPORTADA')]);
  const start = painted(st().diagram);
  if (how === 'remove') await st().removeTableFromArea('tA');
  else await st().deleteTable('tA');
  await pause();
  const afterRemove = painted(st().diagram);
  if (add === 'create') await st().createTable({ logicalName: 'zeta', physicalName: 'Z_NUEVA' });
  else if (add === 'import') await st().addExistingTables(['tY']);
  else { st().copyTable('tC'); await st().pasteTable(); }
  await pause();
  await useUndoStore.getState().undoLast();   // deshace el alta
  await pause();
  await useUndoStore.getState().undoLast();   // deshace sacar / borrar A
  await pause();
  return { start, afterRemove, end: painted(st().diagram), overlaps: sameCorner(st().diagram) };
}

beforeEach(() => { vi.clearAllMocks(); wire(); });

describe('Undo en cadena con tablas sin posición', () => {
  for (const how of ['remove', 'delete'] as const) {
    for (const add of ['create', 'import', 'paste'] as const) {
      it(`${how} A → ${add} → Undo → Undo: todo vuelve a su lugar, sin tapar`, async () => {
        const out = await removeThenAddThenUndoTwice(how, add);
        expect(out.start).toEqual({ tA: gridSlot(0), tB: gridSlot(1), tC: gridSlot(2) });
        expect(out.afterRemove).toEqual({ tB: gridSlot(1), tC: gridSlot(2) });   // al sacar A, B y C no se corren
        expect(out.end).toEqual(out.start);
        expect(out.overlaps).toEqual([]);
      });
    }
  }

  it('con A posicionada: también vuelve exacto', async () => {
    const out = await removeThenAddThenUndoTwice('remove', 'create', { tA: { x: 2000, y: 2000 } });
    expect(out.end).toEqual(out.start);
    expect(out.overlaps).toEqual([]);
  });
});

describe('alta sin posición (canvas no medible): no fija nada', () => {
  for (const add of ['create', 'import'] as const) {
    it(`${add}: la nueva entra por su casilla y las demás se acomodan sin taparse`, async () => {
      vi.mocked(canvasView).mockReturnValue(null);
      await openCanvas(canvasOf(['tB', 'tC']), [...ABC, T('t0', 'A0_PRIMERA')]);
      if (add === 'create') await st().createTable({ logicalName: 'a0', physicalName: 'A0_NUEVA' });
      else await st().addExistingTables(['t0']);
      await pause();
      expect(sameCorner(st().diagram)).toEqual([]);
      expect(world.draft.saU.layout ?? {}).toEqual({});
    });
  }
});

describe('importar varias: lo que ya entró por otro camino no cuenta como «entra»', () => {
  it('con las vistas en lectura, tA entra por otro camino: B y C quedan fijas donde se ven', async () => {
    await openCanvas(canvasOf(['tB', 'tC']), [...ABC, T('tZ', 'Z_ULTIMA')]);
    vi.mocked(viewsSvc.listViewsForTables).mockImplementation(async () => {
      // Otra alta (otra pestaña del mismo draft, otro flujo) suma tA mientras se leen las vistas.
      world.draft.saU = { ...world.draft.saU, tableIds: [...world.draft.saU.tableIds, 'tA'] };
      await st().reload();
      return [] as never;
    });
    const seen = painted(st().diagram);
    await st().addExistingTables(['tA', 'tZ'], { withViews: true });
    await pause();
    // Antes de importar se veían en las casillas 0 y 1; tA (que ordena primero) entró por
    // otro camino y las corrió a 1 y 2: lo que importa es que tZ no las vuelva a correr
    // y que nada se tape.
    expect(seen).toEqual({ tB: gridSlot(0), tC: gridSlot(1) });
    expect(sameCorner(st().diagram)).toEqual([]);
    const end = painted(st().diagram);
    expect(end.tB).toEqual(gridSlot(1));
    expect(end.tC).toEqual(gridSlot(2));
  });
});
