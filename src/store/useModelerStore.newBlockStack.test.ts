// Doc 113 §4 (revisión, ronda 1) — «la tabla nueva en el centro de lo que se ve»,
// INTEGRADO: store real + `structure.service` real (cola de escrituras, mezcla
// del layout) contra un backend en memoria con latencia y `canvasView` fijo (en
// node no hay DOM). Fija: altas seguidas en cascada (no exactamente una encima de
// otra), una importación con diagrama viejo no mueve lo que ya estaba, pegar con
// el original en el borde va al centro, el Undo no deja posiciones huérfanas y lo
// último creado queda ENCIMA (`freshNodes`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
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
    physicalize: vi.fn(async (s: string) => ({ physical: s.toUpperCase() })),
    searchTables: vi.fn(async () => []),
  };
});
vi.mock('@/services/views.service', () => ({ listViews: vi.fn(async () => []), listViewsForTables: vi.fn(async () => []) }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));
vi.mock('@/features/modeler/lib/canvasFocus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/modeler/lib/canvasFocus')>();
  return { ...actual, canvasView: vi.fn(() => null) };
});

import * as csvc from '@/services/changeset.service';
import * as mod from '@/features/modeler/services/modeler.service';
import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { canvasView } from '@/features/modeler/lib/canvasFocus';
import { freshRanks, nodeZ } from '@/features/modeler/lib/nodeZ';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';
import type { SubjectArea } from '@/features/modeler/services/modeler.service';

const VIEW = { center: { x: 1000, y: 2000 }, rect: { left: 400, top: 1700, right: 1600, bottom: 2300 } };
const TABLES = ['t1', 't2', 't3', 't4', 't5'].map((id) => ({ id, physicalName: `M_${id.toUpperCase()}`, logicalName: id }));
const canvas = (over: Partial<SubjectArea> = {}): SubjectArea => ({
  id: 'sa1', projectId: 'p', name: 'Canvas', folderId: null,
  tableIds: ['t1', 't2'], viewIds: [],
  layout: { t1: { x: 0, y: 0 }, t2: { x: 400, y: 0 } },
  drawings: [], udpValues: {}, routes: {}, ...over,
});

let draft: Record<string, SubjectArea> = {};
let created: Record<string, { id: string; physicalName: string; logicalName: string }> = {};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const st = () => useModelerStore.getState();

const flowOf = () => ({
  getNodes: () => Object.entries(st().diagram?.subjectArea.layout ?? {}).map(([id, position]) => ({ id, type: 'table', position })),
  getNode: (id: string) => { const p = st().diagram?.subjectArea.layout?.[id]; return p ? { id, position: p } : undefined; },
  setNodes: vi.fn(),
  screenToFlowPosition: (p: { x: number; y: number }) => p,
}) as never;

beforeEach(async () => {
  vi.resetAllMocks();
  draft = { sa1: canvas() };
  created = {};
  vi.mocked(canvasView).mockReturnValue(VIEW);
  vi.mocked(csvc.effective).mockImplementation(async (_cs, _coll, opts) => {
    const id = opts?.ids?.[0] as string;
    const snap = draft[id] ? structuredClone(draft[id]) : null;
    await sleep(5);
    return (snap ? [snap] : []) as never;
  });
  vi.mocked(csvc.recordChange).mockImplementation(async (_cs, _coll, id, op, payload) => {
    const body = payload ? structuredClone(payload) : undefined;
    await sleep(5);
    if (op === 'delete') delete draft[id]; else draft[id] = body as unknown as SubjectArea;
    return {} as never;
  });
  vi.mocked(mod.loadDiagram).mockImplementation(async (saId: string) => {
    const snap = draft[saId] ? structuredClone(draft[saId]) : null;
    await sleep(5);
    if (!snap) throw new Error('404');
    const all = [...TABLES, ...Object.values(created)];
    return { subjectArea: snap, tables: all.filter((t) => snap.tableIds.includes(t.id)), columns: [], relationships: [], views: [] } as never;
  });
  vi.mocked(gov.createTable).mockImplementation(async (t) => { const tt = t as unknown as { id: string; physicalName: string; logicalName: string }; created[tt.id] = tt; return {} as never; });
  vi.mocked(gov.recordChangesBulk).mockImplementation(async (changes) => {
    for (const c of changes as unknown as { entity?: string; op?: string; payload?: { id: string; physicalName: string; logicalName: string } }[]) {
      if (c.payload?.physicalName && !('tableId' in (c.payload as object))) created[c.payload.id] = c.payload;
    }
    return {} as never;
  });
  vi.mocked(gov.physicalize).mockImplementation(async (s: string) => ({ physical: s.toUpperCase() }) as never);
  vi.mocked(gov.searchTables).mockImplementation(async () => [] as never);
  vi.mocked(gov.listRelationships).mockImplementation(async () => []);
  vi.mocked(gov.listColumns).mockImplementation(async () => []);
  vi.mocked(gov.tableUsage).mockImplementation(async () => ({ usage: [], total: 0 }) as never);
  vi.mocked(gov.deleteTable).mockImplementation(async () => ({}) as never);
  vi.mocked(viewsSvc.listViews).mockImplementation(async () => [] as never);
  vi.mocked(viewsSvc.listViewsForTables).mockImplementation(async () => [] as never);
  const naming = await import('@/services/naming.service');
  vi.mocked(naming.getNamingConfig).mockImplementation(async () => ({}) as never);

  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p' });
  useUndoStore.setState({ stack: [], busy: false });
  useModelerStore.setState({ activeSaId: null, diagram: null, dirty: false, viewerLayout: {}, viewerRoutesOff: {}, selectedTableId: null, selectedEdgeId: null, selectedViewId: null, flow: null, activeProjectId: 'p', viewMode: 'physical', tblClipboard: null, freshNodes: {} } as never);
  await st().selectSubjectArea('sa1');
  useModelerStore.setState({ flow: flowOf() });
});
afterEach(async () => { await sleep(60); });

describe('altas seguidas en el mismo centro: cascada, no una encima de la otra', () => {
  it('importar dos tablas desde el modal (una por llamada, como NewTableModal.addOne)', async () => {
    await st().addExistingTables(['t3'], { tables: [TABLES[2] as never] });
    await st().addExistingTables(['t4'], { tables: [TABLES[3] as never] });
    expect(draft.sa1.layout!.t4).not.toEqual(draft.sa1.layout!.t3);
    expect(draft.sa1.layout!.t4).toEqual({ x: draft.sa1.layout!.t3.x + 36, y: draft.sa1.layout!.t3.y + 36 });
  });

  it('crear dos tablas en blanco seguidas: la segunda no tapa entera a la primera', async () => {
    await st().createTable({ logicalName: 'Uno', physicalName: 'M_UNO' });
    const a = st().selectedTableId!;
    await st().createTable({ logicalName: 'Dos', physicalName: 'M_DOS' });
    const b = st().selectedTableId!;
    expect(a).not.toBe(b);
    expect(draft.sa1.layout![b]).toEqual({ x: draft.sa1.layout![a].x + 36, y: draft.sa1.layout![a].y + 36 });
  });
});

describe('importar con el diagrama en memoria desactualizado NO mueve un bloque que ya estaba', () => {
  it('deshacer «sacar t2» mientras se importa t2: t2 queda donde la repuso el Undo', async () => {
    await st().removeTableFromArea('t2');
    expect(draft.sa1.tableIds).toEqual(['t1']);
    await Promise.all([useUndoStore.getState().undoLast(), st().addExistingTables(['t2'], { tables: [TABLES[1] as never] })]);
    expect(draft.sa1.tableIds).toEqual(['t1', 't2']);
    expect(draft.sa1.layout!.t2).toEqual({ x: 400, y: 0 });
  });
});

describe('pegar: «a la vista» exige la cabecera entera de la copia', () => {
  it('original casi en el borde inferior derecho de lo visible: la copia va al centro', async () => {
    useModelerStore.setState({
      flow: { getNode: (id: string) => (id === 't1' ? { id, position: { x: 1563, y: 2263 } } : undefined), getNodes: () => [], screenToFlowPosition: (p: { x: number; y: number }) => p } as never,
      tblClipboard: { table: TABLES[0] as never, cols: [] },
    });
    await st().pasteTable();
    const id = st().selectedTableId!;
    const pos = draft.sa1.layout![id];
    expect(pos.x + 240).toBeLessThanOrEqual(VIEW.rect.right);
    expect(pos.y + 32).toBeLessThanOrEqual(VIEW.rect.bottom);
  });
});

describe('Undo de crear / pegar / importar: no queda posición huérfana', () => {
  it('crear y deshacer', async () => {
    await st().createTable({ logicalName: 'Uno', physicalName: 'M_UNO' });
    const id = st().selectedTableId!;
    expect(draft.sa1.layout![id]).toEqual({ x: 880, y: 1970 });
    vi.mocked(gov.tableUsage).mockImplementation(async () => ({ usage: [{ canvasId: 'sa1' }], total: 1 }) as never);
    await useUndoStore.getState().undoLast();
    expect(draft.sa1.tableIds).not.toContain(id);
    expect(draft.sa1.layout![id]).toBeUndefined();
  });

  it('pegar y deshacer', async () => {
    useModelerStore.setState({ tblClipboard: { table: TABLES[0] as never, cols: [] } });
    await st().pasteTable();
    const id = st().selectedTableId!;
    expect(draft.sa1.layout![id]).toBeDefined();
    vi.mocked(gov.tableUsage).mockImplementation(async () => ({ usage: [{ canvasId: 'sa1' }], total: 1 }) as never);
    await useUndoStore.getState().undoLast();
    expect(draft.sa1.layout![id]).toBeUndefined();
  });

  it('importar y deshacer', async () => {
    await st().addExistingTables(['t3'], { tables: [TABLES[2] as never] });
    expect(draft.sa1.layout!.t3).toBeDefined();
    await useUndoStore.getState().undoLast();
    expect(draft.sa1.tableIds).toEqual(['t1', 't2']);
    expect(draft.sa1.layout!.t3).toBeUndefined();
  });
});

// Revisión doc 113 (carga, BAJO-3): lo último creado en un canvas queda ENCIMA
// (aunque se deseleccione): una tabla nueva, importada o pegada desplaza a lo que
// trajo la carga — antes, al deseleccionarla, quedaba debajo del grupo cargado.
describe('lo último creado queda encima (freshNodes)', () => {
  it('crear, importar y pegar marcan lo que entró como lo último del canvas', async () => {
    st().markFresh({ sa1: ['carga_t', 'carga_v'] });
    await st().createTable({ logicalName: 'Uno', physicalName: 'M_UNO' });
    const a = st().selectedTableId!;
    expect(st().freshNodes.sa1).toEqual([['carga_t', 'carga_v'], [a]]);
    await st().addExistingTables(['t3'], { tables: [TABLES[2] as never] });
    expect(st().freshNodes.sa1).toEqual([['carga_t', 'carga_v'], [a], ['t3']]);
    useModelerStore.setState({ tblClipboard: { table: TABLES[0] as never, cols: [] } });
    await st().pasteTable();
    expect(st().freshNodes.sa1).toEqual([['carga_t', 'carga_v'], [a], ['t3'], [st().selectedTableId]]);
  });

  it('importar una tabla que YA estaba en el canvas no la marca (no entró)', async () => {
    st().markFresh({ sa1: ['carga_t'] });
    await st().addExistingTables(['t1'], { tables: [TABLES[0] as never] });
    expect(st().freshNodes.sa1).toEqual([['carga_t']]);
  });

  it('ronda 2: después de una carga, crear una tabla deja lo de la carga ENCIMA de lo que ya había', async () => {
    st().markFresh({ sa1: ['t2'] });             // UploadModal: lo que entró con la carga
    await st().createTable({ logicalName: 'Uno', physicalName: 'M_UNO' });
    const r = freshRanks(st().freshNodes.sa1);
    expect(nodeZ('t2', null, r)).toBeGreaterThan(nodeZ('t1', null, r));
    expect(nodeZ(st().selectedTableId!, null, r)).toBeGreaterThan(nodeZ('t2', null, r));
  });
});

// Ronda 2 de la revisión doc 113: la cascada esquiva lo RECIENTE (lo creado en
// esta sesión y lo que está en vuelo) hasta que asome su nombre, y nunca saca de
// la vista la cabecera del bloque nuevo.
describe('cascada contra lo reciente (ronda 2)', () => {
  const COLS = Array.from({ length: 10 }, (_, i) => ({ logicalName: `c${i}`, physicalName: `C${i}`, dataType: 'STRING', isPrimaryKey: i === 0, typeOverridden: false }));
  const headerShown = (p: { x: number; y: number }, w = 240) =>
    p.x >= VIEW.rect.left && p.y >= VIEW.rect.top && p.x + w <= VIEW.rect.right && p.y + 32 <= VIEW.rect.bottom;

  it('tabla en blanco y después una CTAS (más alta): la CTAS no tapa la esquina con el nombre de la primera', async () => {
    await st().createTable({ logicalName: 'Uno', physicalName: 'M_UNO' });
    const a = st().selectedTableId!;
    await st().createTableFromSources({ logicalName: 'dos', schema: '', columns: COLS as never });
    const b = st().selectedTableId!;
    expect(b).not.toBe(a);
    const pa = draft.sa1.layout![a], pb = draft.sa1.layout![b];
    const gripCovered = pb.x < pa.x + 36 && pa.x < pb.x + 240 && pb.y < pa.y + 32 && pa.y < pb.y + 32 + 10 * 28;
    expect(gripCovered).toBe(false);
  });

  it('importar dos filas del modal casi a la vez: la segunda baja en cascada (la primera todavía no se pinta)', async () => {
    await Promise.all([
      st().addExistingTables(['t3'], { tables: [TABLES[2] as never] }),
      st().addExistingTables(['t4'], { tables: [TABLES[3] as never] }),
    ]);
    expect(draft.sa1.layout!.t4).toEqual({ x: draft.sa1.layout!.t3.x + 36, y: draft.sa1.layout!.t3.y + 36 });
  });

  it('un alta que falla suelta su lugar: la siguiente nace en el centro', async () => {
    vi.mocked(csvc.recordChange).mockRejectedValueOnce(new Error('boom'));
    await expect(st().createTable({ logicalName: 'Uno', physicalName: 'M_UNO' })).rejects.toThrow();
    await st().createTable({ logicalName: 'Dos', physicalName: 'M_DOS' });
    expect(draft.sa1.layout![st().selectedTableId!]).toEqual({ x: 880, y: 1970 });
  });

  const gripCovered = (a: { x: number; y: number }, b: { x: number; y: number }, h = 60) =>
    a.x < b.x + 240 && b.x < a.x + 36 && a.y < b.y + h && b.y < a.y + 32;

  it('11 tablas en blanco seguidas sin mover nada: todas a la vista y ninguna tapa el nombre de otra (ronda 3)', async () => {
    const made: { x: number; y: number }[] = [];
    for (let i = 0; i < 11; i++) {
      await st().createTable({ logicalName: `T${i}`, physicalName: `M_N${String(i).padStart(2, '0')}` });
      const p = draft.sa1.layout![st().selectedTableId!];
      expect(headerShown(p)).toBe(true);
      for (const prev of made) expect(gripCovered(prev, p), `alta ${i} sobre ${JSON.stringify(prev)}`).toBe(false);
      made.push(p);
    }
  });

  it('pegar 10 veces la misma tabla en una vista chica (laptop): ninguna copia tapa el nombre de otra (ronda 3)', async () => {
    // Lo que se ve con 1366×768, zoom 1,11 y el panel abierto: 630 × 544 px.
    const small = { center: { x: 915, y: 2072 }, rect: { left: 600, top: 1800, right: 1230, bottom: 2344 } };
    vi.mocked(canvasView).mockReturnValue(small);
    draft.sa1 = canvas({ layout: { t1: { x: 700, y: 1900 }, t2: { x: 400, y: 0 } } });
    await st().selectSubjectArea('sa1');
    useModelerStore.setState({ flow: flowOf(), tblClipboard: { table: TABLES[0] as never, cols: [] } });
    const shown = (p: { x: number; y: number }) =>
      p.x >= small.rect.left && p.y >= small.rect.top && p.x + 240 <= small.rect.right && p.y + 32 <= small.rect.bottom;
    const made: { x: number; y: number }[] = [];
    for (let i = 0; i < 10; i++) {
      await st().pasteTable();
      const p = draft.sa1.layout![st().selectedTableId!];
      expect(shown(p)).toBe(true);
      for (const prev of made) expect(gripCovered(prev, p), `copia ${i} sobre ${JSON.stringify(prev)}`).toBe(false);
      made.push(p);
    }
  });

  it('ronda 4: zoom alto con nombres largos (el bloque es más ancho que lo visible): las altas seguidas no se tapan entre sí', async () => {
    // 630 × 544 px a zoom 2 → 315 × 272 del flujo; «M_» + 43 letras = 432 px de ancho.
    const narrow = { center: { x: 1000, y: 2000 }, rect: { left: 843, top: 1864, right: 1158, bottom: 2136 } };
    vi.mocked(canvasView).mockReturnValue(narrow);
    const made: { x: number; y: number }[] = [];
    for (let i = 0; i < 8; i++) {
      await st().createTable({ logicalName: `larga ${i}`, physicalName: `M_${String(i).padStart(2, '0')}${'X'.repeat(41)}` });
      const p = draft.sa1.layout![st().selectedTableId!];
      for (const prev of made) expect(gripCovered(prev, p), `alta ${i} sobre ${JSON.stringify(prev)}`).toBe(false);
      if (i < 3) expect(p.x >= narrow.rect.left && p.x + 36 <= narrow.rect.right && p.y >= narrow.rect.top && p.y + 32 <= narrow.rect.bottom).toBe(true);
      made.push(p);
    }
  });

  it('dos pegados seguidos con el original cerca del borde derecho: la segunda copia no sale de lo que se ve', async () => {
    draft.sa1 = canvas({ layout: { t1: { x: 1324, y: 1800 }, t2: { x: 400, y: 0 } } });
    await st().selectSubjectArea('sa1');
    useModelerStore.setState({ flow: flowOf(), tblClipboard: { table: TABLES[0] as never, cols: [] } });
    await st().pasteTable();
    expect(draft.sa1.layout![st().selectedTableId!]).toEqual({ x: 1360, y: 1836 });
    await st().pasteTable();
    expect(headerShown(draft.sa1.layout![st().selectedTableId!])).toBe(true);
  });
});
