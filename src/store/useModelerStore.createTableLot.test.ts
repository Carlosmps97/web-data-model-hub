// Crear tabla, CTAS y pegar tabla en un solo lote (doc 133 §4): la tabla (con
// sus columnas y, al pegar, el esquema que nace con ella) y su caja en el canvas
// viajan en un solo envío —todo o nada—. Si el envío queda sin respuesta, se
// relee la tabla: si está, se creó y su Undo pasa el candado; si no, no se creó
// nada. Backend en memoria; `structure.service` es el real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn(), info: vi.fn() } }));
vi.mock('@/services/changeset.service', async (orig) => {
  const actual = await (await import('@/store/draftLedger.testutil')).withDraftLedger(await orig());
  return { ...actual, effective: vi.fn(), recordChange: vi.fn(), recordChangesBulk: vi.fn() };
});
vi.mock('../features/modeler/services/modeler.service', () => ({
  loadDiagram: vi.fn(), listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(async () => []), listProjects: vi.fn(async () => []),
}));
vi.mock('../features/modeler/services/schemas.service', () => ({
  deleteSchema: vi.fn(async () => ({})), listSchemas: vi.fn(async () => []), schemaImpact: vi.fn(async () => ({ tables: 1, views: 0 })),
}));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return {
    ...actual, listRelationships: vi.fn(), listColumns: vi.fn(), tableUsage: vi.fn(),
    physicalize: vi.fn(), searchTables: vi.fn(), listDomains: vi.fn(),
  };
});
vi.mock('@/services/views.service', () => ({
  listViews: vi.fn(async () => []), listViewsForTables: vi.fn(async () => []), tableViews: vi.fn(async () => ({ views: [], total: 0 })),
}));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));
vi.mock('@/features/modeler/lib/canvasFocus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/modeler/lib/canvasFocus')>();
  // Lo que se ve del canvas: el alta nace en su centro.
  return { ...actual, canvasView: () => ({ center: { x: 1000, y: 2000 }, rect: { left: 400, top: 1700, right: 1600, bottom: 2300 } }) };
});

import * as csvc from '@/services/changeset.service';
import { ApiError } from '@/services/http';
import { forgetDraftSeqs } from '@/services/draftSeqs';
import * as mod from '../features/modeler/services/modeler.service';
import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import { draftLedger } from './draftLedger.testutil';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { StaleUndoError, useUndoStore } from './useUndoStore';
import type { CanonicalColumn, CanonicalTable } from '@/services/governance.service';
import type { SubjectArea } from '../features/modeler/services/modeler.service';

const CS = 'cs1';
const NETWORK = "Couldn't reach the server — check your connection.";
const T1: CanonicalTable = { id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente', schema: 'STG' } as CanonicalTable;
const C1 = { id: 'k', tableId: 't1', physicalName: 'CODCLIENTE', logicalName: 'cod', dataType: 'STRING', typeOverridden: false, ordinal: 0, isPrimaryKey: true } as CanonicalColumn;

let tables = new Map<string, CanonicalTable>();
let cols = new Map<string, CanonicalColumn>();
let schemaIds = new Set<string>();
let draft: Record<string, SubjectArea> = {};
let lots: string[][] = [];
let log: string[] = [];
let fault: null | 'rejected' | 'lost' | 'lost-saved' | 'name-taken' = null;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const st = () => useModelerStore.getState();
const labels = () => useUndoStore.getState().stack.map((e) => e.label);
const created = () => [...tables.values()].filter((t) => t.id !== 't1');

function apply(changes: csvc.BulkChange[]): void {
  for (const c of changes) {
    const p = structuredClone(c.payload) as never;
    if (c.collection === 'canonical_tables') { if (c.op === 'delete') tables.delete(c.entityId); else tables.set(c.entityId, p); }
    if (c.collection === 'canonical_columns') { if (c.op === 'delete') cols.delete(c.entityId); else cols.set(c.entityId, p); }
    if (c.collection === 'schemas') { if (c.op === 'delete') schemaIds.delete(c.entityId); else schemaIds.add(c.entityId); }
  }
  for (const c of changes) {
    if (c.collection !== 'subject_areas') continue;
    const sa = structuredClone(c.payload) as unknown as SubjectArea;
    sa.tableIds = sa.tableIds.filter((t) => tables.has(t));
    draft[c.entityId] = sa;
  }
  for (const c of changes) {
    if (c.collection !== 'canonical_tables' || c.op !== 'delete') continue;
    for (const sa of Object.values(draft)) {
      if (!sa.tableIds.includes(c.entityId) || changes.some((x) => x.collection === 'subject_areas' && x.entityId === sa.id)) continue;
      sa.tableIds = sa.tableIds.filter((t) => t !== c.entityId);
      delete sa.layout?.[c.entityId];
    }
  }
}

const flowOf = () => ({
  getNodes: () => Object.entries(st().diagram?.subjectArea.layout ?? {}).map(([id, position]) => ({ id, type: 'table', position, measured: { width: 200, height: 80 } })),
  getNode: (id: string) => { const p = st().diagram?.subjectArea.layout?.[id]; return p ? { id, position: p } : undefined; },
  getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  setNodes: vi.fn(),
  screenToFlowPosition: (p: { x: number; y: number }) => p,
}) as never;

beforeEach(async () => {
  vi.resetAllMocks();
  forgetDraftSeqs();
  fault = null;
  lots = [];
  tables = new Map([['t1', { ...T1 }]]);
  cols = new Map([['k', { ...C1 }]]);
  schemaIds = new Set();
  draft = {
    sa1: { id: 'sa1', projectId: 'p', name: 'Uno', folderId: null, tableIds: ['t1'], viewIds: [], layout: { t1: { x: 0, y: 0 } },
      drawings: [], udpValues: {}, routes: {} } as SubjectArea,
  };
  vi.mocked(csvc.writeSeqOf).mockImplementation(async () => ({ writeSeq: draftLedger.seq }));
  vi.mocked(csvc.effective).mockImplementation(async (_cs, coll, opts) => {
    await sleep(1);
    if (coll === 'canonical_tables') return [...tables.values()].filter((t) => opts?.ids?.includes(t.id)).map((t) => ({ ...t })) as never;
    return (opts?.ids ?? []).filter((id) => draft[id]).map((id) => structuredClone(draft[id])) as never;
  });
  vi.mocked(csvc.recordChange).mockImplementation(async (cs, coll, id, op, payload) => {
    log.push(`put:${coll}:${id}`);
    await sleep(1);
    apply([{ collection: coll, entityId: id, op, ...(payload ? { payload } : {}) }]);
    return { writeSeq: draftLedger.write(cs) } as never;
  });
  vi.mocked(csvc.recordChangesBulk).mockImplementation(async (cs, changes) => {
    lots.push(changes.map((c) => `${c.collection}:${c.op}`));
    await sleep(2);
    const f = fault;
    fault = null;
    if (f === 'rejected') throw new ApiError('Invalid payload', 422, null, '/api/x');
    if (f === 'name-taken') {
      const t = changes.find((c) => c.collection === 'canonical_tables')!;
      throw new ApiError(`Table ${(t.payload as { physicalName: string }).physicalName} already exists in this project.`, 409, null, '/api/x');
    }
    if (f === 'lost') { draftLedger.lost(cs, changes); throw new ApiError(NETWORK, 0, null, '/api/x'); }
    apply(changes);
    if (f === 'lost-saved') { draftLedger.foreign(); draftLedger.lost(cs, changes); throw new ApiError(NETWORK, 0, null, '/api/x'); }
    return { writeSeq: draftLedger.write(cs, changes) } as never;
  });
  vi.mocked(gov.physicalize).mockImplementation(async (name: string) => ({ physical: name.toUpperCase() }));
  vi.mocked(gov.searchTables).mockImplementation(async () => [...tables.values()].map((t) => ({ ...t })));
  vi.mocked(gov.listDomains).mockImplementation(async () => []);
  vi.mocked(gov.listRelationships).mockImplementation(async () => []);
  vi.mocked(gov.listColumns).mockImplementation(async (t: string) => [...cols.values()].filter((c) => c.tableId === t).map((c) => ({ ...c })));
  vi.mocked(gov.tableUsage).mockImplementation(async (t: string) => {
    const usage = Object.values(draft).filter((sa) => sa.tableIds.includes(t)).map((sa) => ({ canvasId: sa.id }));
    return { usage, total: usage.length } as never;
  });
  vi.mocked(viewsSvc.listViews).mockImplementation(async () => [] as never);
  vi.mocked(viewsSvc.listViewsForTables).mockImplementation(async () => [] as never);
  vi.mocked(viewsSvc.tableViews).mockImplementation(async () => ({ views: [], total: 0 }) as never);
  vi.mocked(mod.loadDiagram).mockImplementation(async (saId: string) => {
    const sa = draft[saId];
    const draftSeq = draftLedger.seq;
    await sleep(1);
    if (!sa) throw new Error('404');
    const ids = sa.tableIds.filter((t) => tables.has(t));
    return {
      draftSeq, subjectArea: structuredClone(sa), views: [], relationships: [],
      tables: ids.map((t) => ({ ...tables.get(t)! })),
      columns: [...cols.values()].filter((c) => ids.includes(c.tableId)).map((c) => ({ ...c })),
    } as never;
  });
  const naming = await import('@/services/naming.service');
  vi.mocked(naming.getNamingConfig).mockImplementation(async () => ({}) as never);
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: CS, activeProjectId: 'p' });
  useUndoStore.getState().clear();
  useUndoStore.setState({ busy: false });
  useModelerStore.setState({ activeSaId: null, diagram: null, dirty: false, flow: null, activeProjectId: 'p', viewMode: 'physical',
    selectedTableId: null, selectedViewId: null, selectedColumnId: null, tblClipboard: null } as never);
  await st().selectSubjectArea('sa1');
  useModelerStore.setState({ flow: flowOf() });
  log = [];
});
afterEach(async () => { await sleep(10); });

const createIt = () => st().createTable({ logicalName: 'nueva', physicalName: 'M_NUEVA' });
const ctas = () => st().createTableFromSources({ logicalName: 'copia', columns: [
  { logicalName: 'cod', physicalName: 'CODCLIENTE', dataType: 'STRING', typeOverridden: false, isPrimaryKey: true, sourceTable: 'M_CLIENTE' },
  { logicalName: 'nombre', physicalName: 'NOMBRE', dataType: 'STRING', typeOverridden: false, isPrimaryKey: false, sourceTable: 'M_CLIENTE' },
] as never });
const paste = () => {
  useModelerStore.setState({ tblClipboard: { table: { ...T1 }, cols: [{ ...C1 }] } });
  return st().pasteTable();
};

describe('crear tabla: un solo lote', () => {
  it('la tabla y su caja en el canvas van en un solo envío', async () => {
    await createIt();
    expect(lots).toEqual([['canonical_tables:upsert', 'subject_areas:upsert']]);
    expect(log).toEqual([]);
    const [t] = created();
    expect(t.physicalName).toBe('M_NUEVA');
    expect(draft.sa1.tableIds).toEqual(['t1', t.id]);
    expect(draft.sa1.layout[t.id]).toBeDefined();
    expect(labels()).toEqual(['Create table M_NUEVA']);
  });

  it('si el servidor rechaza el lote, no se crea nada y no queda Undo', async () => {
    fault = 'rejected';
    await expect(createIt()).rejects.toThrow('Invalid payload');
    expect(created()).toEqual([]);
    expect(draft.sa1.tableIds).toEqual(['t1']);
    expect(labels()).toEqual([]);
  });

  it('sin respuesta, pero se grabó: sigue como creada, con su Undo, que pasa el candado', async () => {
    fault = 'lost-saved';
    await createIt();
    expect(created()).toHaveLength(1);
    expect(labels()).toEqual(['Create table M_NUEVA']);
    expect(await useUndoStore.getState().undoLast()).toBe('Create table M_NUEVA');
    expect(created()).toEqual([]);
    expect(draft.sa1.tableIds).toEqual(['t1']);
  });

  it('sin respuesta y no se grabó: no se creó nada, sin Undo', async () => {
    fault = 'lost';
    await expect(createIt()).rejects.toThrow('No response from the server: nothing was created. Try again.');
    expect(created()).toEqual([]);
    expect(labels()).toEqual([]);
  });

  it('si la sesión cambia mientras lee su canvas, no se envía nada', async () => {
    const read = vi.mocked(csvc.effective).getMockImplementation()!;
    vi.mocked(csvc.effective).mockImplementation(async (cs, coll, opts) => {
      if (coll === 'subject_areas') useSessionStore.setState({ activeChangesetId: 'cs2' });
      return read(cs, coll, opts);
    });
    await expect(createIt()).rejects.toThrow();
    expect(lots).toEqual([]);
    expect(created()).toEqual([]);
  });

  it('si el canvas ya no está en la versión, no se crea nada', async () => {
    delete draft.sa1;
    await expect(createIt()).rejects.toThrow('This canvas is no longer in the working copy.');
    expect(lots).toEqual([]);
    expect(created()).toEqual([]);
  });
});

describe('CTAS: un solo lote', () => {
  it('la tabla, sus columnas y su caja en el canvas van en un solo envío', async () => {
    await ctas();
    expect(lots).toEqual([['canonical_tables:upsert', 'canonical_columns:upsert', 'canonical_columns:upsert', 'subject_areas:upsert']]);
    expect(log).toEqual([]);
    const [t] = created();
    expect(draft.sa1.tableIds).toEqual(['t1', t.id]);
    expect(labels()).toEqual(['Create table COPIA']);
  });

  it('sin respuesta, pero se grabó: su Undo pasa el candado', async () => {
    fault = 'lost-saved';
    await ctas();
    expect(await useUndoStore.getState().undoLast()).toBe('Create table COPIA');
    expect(created()).toEqual([]);
  });

  it('sin respuesta y no se grabó: nada creado, sin Undo', async () => {
    fault = 'lost';
    await expect(ctas()).rejects.toThrow('No response from the server: nothing was created. Try again.');
    expect(created()).toEqual([]);
    expect(labels()).toEqual([]);
  });

  it('deshacer una CTAS ancha (su borrado: más de 1000 cambios) sin respuesta y sin grabar: el reintento no admite una escritura ajena', async () => {
    const wide = Array.from({ length: 1100 }, (_, i) => ({ logicalName: `w${i}`, physicalName: `W${i}`, dataType: 'STRING', typeOverridden: false, isPrimaryKey: false }));
    await st().createTableFromSources({ logicalName: 'ancha', columns: wide as never });
    fault = 'lost';
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow('Press Undo to try again.');
    expect(created()).toHaveLength(1);
    draftLedger.foreign();                                             // otra pestaña
    await expect(useUndoStore.getState().undoLast()).rejects.toBeInstanceOf(StaleUndoError);
    expect(created()).toHaveLength(1);
  });

  it('con más columnas de las que entran en un envío, por partes como antes', async () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({ logicalName: `c${i}`, physicalName: `C${i}`, dataType: 'STRING', typeOverridden: false, isPrimaryKey: false }));
    await st().createTableFromSources({ logicalName: 'ancha', columns: many as never });
    expect(lots.every((l) => !l.includes('subject_areas:upsert'))).toBe(true);
    expect(log).toEqual(['put:subject_areas:sa1']);
    const [t] = created();
    expect(draft.sa1.tableIds).toEqual(['t1', t.id]);
    expect([...cols.values()].filter((c) => c.tableId === t.id)).toHaveLength(2000);
  });
});

describe('pegar tabla: un solo lote', () => {
  it('la copia, sus columnas y su caja en el canvas van en un solo envío', async () => {
    expect(await paste()).toBe('M_CLIENTE_copy_1');
    expect(lots).toEqual([['canonical_tables:upsert', 'canonical_columns:upsert', 'subject_areas:upsert']]);
    expect(log).toEqual([]);
    expect(labels()).toEqual(['Paste table M_CLIENTE_copy_1']);
  });

  it('si otra versión ganó el nombre, reintenta con otro: cada intento, un solo envío', async () => {
    fault = 'name-taken';
    expect(await paste()).toBe('M_CLIENTE_copy_2');
    expect(lots).toHaveLength(2);
    expect(lots[1]).toEqual(['canonical_tables:upsert', 'canonical_columns:upsert', 'subject_areas:upsert']);
  });

  it('sin respuesta, pero se grabó: su Undo pasa el candado', async () => {
    fault = 'lost-saved';
    expect(await paste()).toBe('M_CLIENTE_copy_1');
    expect(await useUndoStore.getState().undoLast()).toBe('Paste table M_CLIENTE_copy_1');
    expect(created()).toEqual([]);
  });

  it('sin respuesta y no se grabó: nada pegado, sin Undo', async () => {
    fault = 'lost';
    await expect(paste()).rejects.toThrow('No response from the server: nothing was pasted. Try again.');
    expect(created()).toEqual([]);
    expect(labels()).toEqual([]);
  });
});
