// Redo de las altas y de los borrados en cascada, contra un backend en memoria
// que se porta como el real: el lote aplica cada cambio, borrar una tabla o una
// vista la saca de todo canvas que la lista (con su posición), un canvas se graba
// podado de lo borrado y cada escritura sube el contador de la versión
// (`draftLedger`). `structure.service` y el `reload` del store son los reales.
//  · Deshacer → rehacer → deshacer deja el modelo y los canvases exactamente como
//    después de la acción y como antes de ella.
//  · Rehacer un borrado lo recalcula con lo vigente; deshacer «Create table» con
//    otro canvas abierto también deja qué rehacer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/changeset.service', async (orig) => ({
  ...(await import('@/store/draftLedger.testutil')).withDraftLedger(await orig()),
  effective: vi.fn(), recordChange: vi.fn(), recordChangesBulk: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock('../features/modeler/services/modeler.service', () => ({
  loadDiagram: vi.fn(), listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(async () => []), listProjects: vi.fn(async () => []),
}));
vi.mock('../features/modeler/services/schemas.service', () => ({
  deleteSchema: vi.fn(), listSchemas: vi.fn(async () => []), schemaImpact: vi.fn(),
}));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return {
    ...actual,
    recordChangesBulk: vi.fn(), deleteTable: vi.fn(), createTable: vi.fn(), createColumn: vi.fn(), updateColumn: vi.fn(),
    deleteRelationship: vi.fn(), currentTable: vi.fn(), listColumns: vi.fn(), listRelationships: vi.fn(), tableUsage: vi.fn(),
    physicalize: vi.fn(async (name: string) => ({ physical: name.toUpperCase() })), listDomains: vi.fn(async () => []),
    searchTables: vi.fn(async () => []),
  };
});
vi.mock('@/services/views.service', () => ({
  listViews: vi.fn(), listViewsForTables: vi.fn(async () => []), tableViews: vi.fn(), deleteView: vi.fn(), updateView: vi.fn(),
  currentView: vi.fn(), viewWriteDoc: (id: string, body: object) => ({ ...body, id }),
}));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => null) }));

import * as csvc from '@/services/changeset.service';
import { ApiError } from '@/services/http';
import * as mod from '../features/modeler/services/modeler.service';
import * as schemas from '../features/modeler/services/schemas.service';
import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import type { View } from '@/services/views.service';
import type { SubjectArea } from '../features/modeler/services/modeler.service';
import { draftLedger } from './draftLedger.testutil';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';
import { openOtherCanvasWhileStepRuns } from './historyCanvas.testutil';

type Col = gov.CanonicalColumn;
type Rel = gov.Relationship;
const CS = 'cs1';
const R1 = [{ x: 200, y: 40 }];
const R2 = [{ x: 300, y: 90 }];
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const st = () => useModelerStore.getState();
const undo = () => useUndoStore.getState().undoLast();
const redo = () => useUndoStore.getState().redoLast();
const redoLabels = () => useUndoStore.getState().redoStack.map((e) => e.label);

// ── Backend en memoria ──────────────────────────────────────────────────────
let tables: Map<string, gov.CanonicalTable>;
let columns: Map<string, Col>;
let rels: Map<string, Rel>;
let views: Map<string, View>;
let schemaRows: Map<string, { id: string; name: string; kind: string }>;
let draft: Record<string, SubjectArea>;
const clone = <T>(x: T): T => structuredClone(x);

/** Borrar una tabla o una vista la saca de todo canvas que la lista (con su posición). */
function cascade(field: 'tableIds' | 'viewIds', id: string) {
  for (const sa of Object.values(draft)) {
    const list = sa[field];
    if (!Array.isArray(list) || !list.includes(id)) continue;
    (sa as unknown as Record<string, string[]>)[field] = list.filter((x) => x !== id);
    if (sa.layout) delete sa.layout[id];
  }
}
function apply(ch: gov.BulkChange) {
  const p = ch.payload as never;
  const del = ch.op === 'delete';
  switch (ch.collection) {
    case 'canonical_tables': if (del) { tables.delete(ch.entityId); cascade('tableIds', ch.entityId); } else tables.set(ch.entityId, clone(p)); break;
    case 'canonical_columns': if (del) columns.delete(ch.entityId); else columns.set(ch.entityId, clone(p)); break;
    case 'relationships': if (del) rels.delete(ch.entityId); else rels.set(ch.entityId, clone(p)); break;
    case 'views': if (del) { views.delete(ch.entityId); cascade('viewIds', ch.entityId); } else views.set(ch.entityId, clone(p)); break;
    case 'schemas': if (del) schemaRows.delete(ch.entityId); else schemaRows.set(ch.entityId, clone(p)); break;
    default: throw new Error(`colección inesperada ${ch.collection}`);
  }
}
const write = async (changes: gov.BulkChange[]) => {
  await sleep(1); changes.forEach(apply); draftLedger.write(CS, changes);
  return {} as never;
};
/** Graba un canvas como el backend: sin lo que el draft ya no tiene. */
function saveCanvas(id: string, op: 'upsert' | 'delete', payload?: Record<string, unknown>) {
  if (op === 'delete') { delete draft[id]; return; }
  const sa = clone(payload) as unknown as SubjectArea;
  sa.tableIds = sa.tableIds.filter((t) => tables.has(t));
  if (Array.isArray(sa.viewIds)) sa.viewIds = sa.viewIds.filter((v) => views.has(v));
  draft[id] = sa;
}
/** Lo que le pasa al próximo envío único (`canvasLot`): sin respuesta, grabado o no. */
let lotFault: null | 'lost' | 'lost-saved' = null;
const NO_ANSWER = "The server didn't respond within 30s — try again in a moment.";
const sources = (v: View) => [...new Set([...(v.sourceTableIds ?? []), ...(v.sources ?? []).map((s) => s.tableId)])].filter(Boolean) as string[];
const listedIn = (vid: string) => Object.values(draft).filter((sa) => (sa.viewIds ?? []).includes(vid)).map((sa) => ({ id: sa.id, name: sa.name }));

function diagramOf(saId: string) {
  const sa = draft[saId];
  if (!sa) throw new Error('404');
  const ids = sa.tableIds.filter((t) => tables.has(t));
  return {
    draftSeq: draftLedger.seq,
    subjectArea: clone(sa),
    tables: ids.map((t) => clone(tables.get(t)!)),
    columns: [...columns.values()].filter((c) => ids.includes(c.tableId)).map(clone),
    relationships: [...rels.values()].filter((r) => ids.includes(r.parentTableId) && ids.includes(r.childTableId)).map(clone),
    views: (sa.viewIds ?? []).filter((v) => views.has(v)).map((v) => clone(views.get(v)!)),
  };
}
/** Lo que el modelo y los canvases tienen, para comparar (listas sin orden). */
function snapshot() {
  const byId = <T>(m: Map<string, T>) => clone(Object.fromEntries([...m.entries()].sort(([a], [b]) => a.localeCompare(b))));
  return clone({
    tables: byId(tables), columns: byId(columns), rels: byId(rels), views: byId(views), schemas: byId(schemaRows),
    canvases: Object.fromEntries(Object.values(draft).map((sa) => [sa.id, {
      tableIds: [...sa.tableIds].sort(), viewIds: [...(sa.viewIds ?? [])].sort(), layout: sa.layout ?? {}, routes: sa.routes ?? {}, colors: sa.colors ?? {},
    }])),
  });
}

const flowOf = () => ({
  getNodes: () => Object.entries(st().diagram?.subjectArea.layout ?? {}).map(([id, position]) => ({ id, type: 'table', position, measured: { width: 200, height: 80 } })),
  getNode: (id: string) => { const p = st().diagram?.subjectArea.layout?.[id]; return p ? { id, position: p } : undefined; },
  getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  setNodes: vi.fn(),
  screenToFlowPosition: (p: { x: number; y: number }) => p,
}) as never;

async function open(saId: string) {
  await st().selectSubjectArea(saId);
  useModelerStore.setState({ flow: flowOf() });
}

beforeEach(async () => {
  vi.clearAllMocks();
  tables = new Map([
    ['t1', { id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente', schema: 'STG' }],
    ['t2', { id: 't2', physicalName: 'M_CUENTA', logicalName: 'Cuenta', schema: 'STG' }],
  ] as [string, gov.CanonicalTable][]);
  columns = new Map([
    ['k', { id: 'k', tableId: 't1', physicalName: 'CODCLIENTE', logicalName: 'cod', dataType: 'STRING', typeOverridden: false, ordinal: 0, isPrimaryKey: true }],
    ['a', { id: 'a', tableId: 't1', physicalName: 'NOMBRE', logicalName: 'nombre', dataType: 'STRING', typeOverridden: false, ordinal: 1 }],
    ['c', { id: 'c', tableId: 't2', physicalName: 'CODCLIENTE', logicalName: 'cod', dataType: 'STRING', typeOverridden: false, ordinal: 0, isForeignKey: true }],
  ] as [string, Col][]);
  rels = new Map([['r1', { id: 'r1', parentTableId: 't1', childTableId: 't2', identifying: false,
    parentCardinality: 'one', childCardinality: 'many', pairs: [{ parentColumnId: 'k', childColumnId: 'c' }] } as unknown as Rel]]);
  views = new Map([['v1', { id: 'v1', name: 'V_CLIENTE', tableId: 't1', sourceTableIds: ['t1'], showOnCanvas: true,
    sources: [{ column: 'CODCLIENTE', tableId: 't1' }, { column: 'NOMBRE', tableId: 't1' }] } as View]]);
  schemaRows = new Map();
  draft = {
    sa1: { id: 'sa1', projectId: 'p', name: 'Uno', folderId: null, tableIds: ['t1', 't2'], viewIds: ['v1'],
      layout: { t1: { x: 0, y: 0 }, t2: { x: 400, y: 0 }, v1: { x: 0, y: 300 } }, routes: { r1: R1 }, colors: { t1: 'theme:th1' },
      drawings: [], udpValues: {} } as SubjectArea,
    sa2: { id: 'sa2', projectId: 'p', name: 'Dos', folderId: null, tableIds: ['t1', 't2'], viewIds: ['v1'],
      layout: { t1: { x: 9, y: 9 }, t2: { x: 500, y: 9 }, v1: { x: 9, y: 209 } }, routes: { r1: R2 }, colors: {},
      drawings: [], udpValues: {} } as SubjectArea,
  };
  lotFault = null;
  vi.mocked(csvc.effective).mockImplementation(async (_cs, coll, opts) => {
    await sleep(1);
    const ids = opts?.ids ?? [];
    if (coll === 'canonical_columns') return ids.filter((id) => columns.has(id)).map((id) => clone(columns.get(id)!)) as never;
    if (coll !== 'subject_areas') throw new Error(`lectura inesperada ${coll}`);
    return ids.filter((id) => draft[id]).map((id) => clone(draft[id])) as never;
  });
  vi.mocked(csvc.recordChange).mockImplementation(async (cs, coll, id, op, payload) => {
    await sleep(1);
    if (coll !== 'subject_areas') throw new Error(`recordChange inesperado ${coll}`);
    saveCanvas(id, op, payload);
    draftLedger.write(cs);
    return {} as never;
  });
  // El envío único: el modelo y los canvases juntos, un solo número.
  vi.mocked(csvc.recordChangesBulk).mockImplementation(async (cs, changes) => {
    await sleep(1);
    const fault = lotFault;
    lotFault = null;
    if (fault === 'lost') { draftLedger.lost(cs, changes); throw new ApiError(NO_ANSWER, 0, null, '/api/x'); }
    for (const c of changes) if (c.collection !== 'subject_areas') apply(c);
    for (const c of changes) if (c.collection === 'subject_areas') saveCanvas(c.entityId, c.op, c.payload);
    if (fault === 'lost-saved') { draftLedger.foreign(); draftLedger.lost(cs, changes); throw new ApiError(NO_ANSWER, 0, null, '/api/x'); }
    draftLedger.write(cs, changes);
    return {} as never;
  });
  vi.mocked(gov.recordChangesBulk).mockImplementation(write);
  vi.mocked(gov.deleteTable).mockImplementation(async (id) => write([{ collection: 'canonical_tables', entityId: id, op: 'delete' }]));
  vi.mocked(gov.createTable).mockImplementation(async (t) => write([{ collection: 'canonical_tables', entityId: t.id, op: 'upsert', payload: { ...t } }]));
  vi.mocked(gov.createColumn).mockImplementation(async (c) => write([{ collection: 'canonical_columns', entityId: c.id, op: 'upsert', payload: { ...c } }]));
  vi.mocked(gov.updateColumn).mockImplementation(async (c) => write([{ collection: 'canonical_columns', entityId: c.id, op: 'upsert', payload: { ...c } }]));
  vi.mocked(gov.deleteRelationship).mockImplementation(async (id) => write([{ collection: 'relationships', entityId: id, op: 'delete' }]));
  vi.mocked(gov.currentTable).mockImplementation(async (id) => (tables.has(id) ? clone(tables.get(id)!) : null));
  vi.mocked(gov.listColumns).mockImplementation(async (t) => [...columns.values()].filter((c) => c.tableId === t).map(clone));
  vi.mocked(gov.listRelationships).mockImplementation(async (t) =>
    [...rels.values()].filter((r) => r.parentTableId === t || r.childTableId === t).map(clone));
  vi.mocked(gov.tableUsage).mockImplementation(async (t) => {
    const usage = Object.values(draft).filter((sa) => sa.tableIds.includes(t)).map((sa) => ({ canvasId: sa.id }));
    return { usage, total: usage.length } as never;
  });
  vi.mocked(viewsSvc.listViews).mockImplementation(async (t) => [...views.values()].filter((v) => sources(v).includes(t)).map(clone));
  vi.mocked(viewsSvc.tableViews).mockImplementation(async (t) => {
    const rows = [...views.values()].filter((v) => sources(v).includes(t)).map((v) => ({ ...clone(v), canvases: listedIn(v.id) }));
    return { views: rows, total: rows.length } as never;
  });
  vi.mocked(viewsSvc.currentView).mockImplementation(async (id) => (views.has(id) ? clone(views.get(id)!) : null));
  vi.mocked(viewsSvc.deleteView).mockImplementation(async (id) => { await write([{ collection: 'views', entityId: id, op: 'delete' }]); return { deleted: true }; });
  vi.mocked(viewsSvc.updateView).mockImplementation(async (id, body) => {
    await write([{ collection: 'views', entityId: id, op: 'upsert', payload: { ...body, id } as never }]);
    return { ...body, id } as never;
  });
  vi.mocked(mod.loadDiagram).mockImplementation(async (saId: string) => { await sleep(1); return diagramOf(saId) as never; });

  useSessionStore.setState({ openMode: 'editing', activeChangesetId: CS, activeProjectId: 'p' });
  useUndoStore.getState().clear();
  useModelerStore.setState({ activeSaId: null, diagram: null, openingSaId: null, flow: null, activeProjectId: 'p', viewMode: 'physical',
    selectedTableId: null, selectedViewId: null, selectedColumnId: null } as never);
  await open('sa1');
});
afterEach(async () => { await sleep(10); });

/** Acción → deshacer → rehacer → deshacer: el estado vuelve a cada punto. */
/** Deshacer → rehacer → deshacer deja los datos iguales. `between` corre antes
 *  del Redo. Con `otherCanvas`, ese canvas se abre apenas arranca el Redo y el
 *  último Undo (desde el doc 133 no corren con otro canvas abierto, pero puede
 *  abrirse uno mientras corren); el de la acción se reabre antes de cada uno. */
async function roundTrip(act: () => Promise<unknown>, label: string, opts: { between?: () => Promise<unknown>; otherCanvas?: string } = {}) {
  const { between, otherCanvas } = opts;
  const before = snapshot();
  const home = st().activeSaId!;
  await act();
  const after = snapshot();
  expect(after).not.toEqual(before);
  expect(await undo()).toBe(label);
  expect(snapshot()).toEqual(before);
  expect(redoLabels()).toEqual([label]);
  await between?.();
  const other = otherCanvas ? openOtherCanvasWhileStepRuns(() => open(otherCanvas)) : null;
  try {
    expect(await redo()).toBe(label);
    expect(snapshot()).toEqual(after);
    if (other) {
      await other.opened();
      expect(st().activeSaId).toBe(otherCanvas);   // el otro canvas de verdad se abrió
      await open(home);
    }
    expect(await undo()).toBe(label);
    expect(snapshot()).toEqual(before);
    if (other) { await other.opened(); expect(st().activeSaId).toBe(otherCanvas); }
  } finally { other?.stop(); }
}

describe('Redo de altas y cascadas', () => {
  it('crear una tabla: rehacer la re-crea con el mismo id en su sitio', async () => {
    await roundTrip(() => st().createTable({ logicalName: 'NUEVA', mode: 'physical' }), 'Create table NUEVA');
  });

  it('crear una tabla y deshacer/rehacer con otro canvas abierto', async () => {
    await roundTrip(() => st().createTable({ logicalName: 'NUEVA', mode: 'physical' }), 'Create table NUEVA', { otherCanvas: 'sa2' });
  });

  it('CTAS: rehacer re-crea la tabla con sus columnas', async () => {
    await roundTrip(() => st().createTableFromSources({ logicalName: 'copia', columns: [
      { logicalName: 'cod', physicalName: 'CODCLIENTE', dataType: 'STRING', typeOverridden: false, isPrimaryKey: true, sourceTable: 'M_CLIENTE' },
    ] } as never), 'Create table COPIA');
  });

  it('agregar una columna (entra a la vista espejo): rehacer la vuelve a crear y a poner en la vista', async () => {
    await roundTrip(() => st().addColumn('t1', { logicalName: 'EMAIL', mode: 'physical', dataType: 'STRING' } as never), 'Add column EMAIL');
  });

  it('borrar una tabla con vista, relación y trazos en dos canvases: rehacer la borra otra vez y deshacer repone los trazos de los dos', async () => {
    await roundTrip(() => st().deleteTable('t1'), 'Delete table M_CLIENTE');
  });

  it('borrar una tabla y deshacer/rehacer con otro canvas abierto', async () => {
    await roundTrip(() => st().deleteTable('t1'), 'Delete table M_CLIENTE', { otherCanvas: 'sa2' });
  });

  it('borrar una columna con su relación elegida (la FK de la hija se apaga): ida y vuelta', async () => {
    await roundTrip(() => st().deleteColumns(['k'], ['r1']), 'Delete column CODCLIENTE');
  });

  it('borrar una vista que está en dos canvases: ida y vuelta', async () => {
    await roundTrip(() => st().deleteView(clone(views.get('v1')!)), 'Delete view V_CLIENTE');
  });

  it('rehacer «Delete column» cuando otra relación empezó a usar la columna: no borra nada y lo dice', async () => {
    await st().deleteColumns(['a'], []);
    await undo();
    // Otro usuario publicó una relación sobre la columna (el draft la ve; esta pestaña no escribió nada).
    rels.set('r2', { id: 'r2', parentTableId: 't1', childTableId: 't2', identifying: false, parentCardinality: 'one',
      childCardinality: 'many', pairs: [{ parentColumnId: 'a', childColumnId: 'c' }] } as unknown as Rel);
    const before = snapshot();
    await expect(redo()).rejects.toThrow(
      "Couldn't redo: column NOMBRE is now used by another relationship. Delete it again to choose what happens to that relationship.");
    expect(snapshot()).toEqual(before);
    expect(redoLabels()).toEqual([]);
  });

  it('rehacer «Delete column» sigue siendo exacto en cada vuelta', async () => {
    await st().deleteColumns(['a'], []);
    await undo();
    await redo();
    await undo();
    rels.set('r2', { id: 'r2', parentTableId: 't1', childTableId: 't2', identifying: false, parentCardinality: 'one',
      childCardinality: 'many', pairs: [{ parentColumnId: 'a', childColumnId: 'c' }] } as unknown as Rel);
    await expect(redo()).rejects.toThrow('Couldn\'t redo: column NOMBRE is now used by another relationship.');
    expect(columns.has('a')).toBe(true);
  });

  it('deshacer «Add column» no mira otras relaciones (como antes)', async () => {
    await st().addColumn('t1', { logicalName: 'EMAIL', mode: 'physical', dataType: 'STRING' } as never);
    vi.mocked(gov.listRelationships).mockClear();
    await undo();
    expect(gov.listRelationships).not.toHaveBeenCalled();
  });

  it('deshacer «Add column» después de rehacerlo sigue sin mirar otras relaciones (como la primera vez)', async () => {
    await st().addColumn('t1', { logicalName: 'EMAIL', mode: 'physical', dataType: 'STRING' } as never);
    await undo();
    await redo();
    const id = [...columns.values()].find((c) => c.physicalName === 'EMAIL')!.id;
    // Una acción sin Undo (p. ej. «Sync with parent key») la puso en una relación.
    rels.set('r3', { id: 'r3', parentTableId: 't1', childTableId: 't2', identifying: false, parentCardinality: 'one',
      childCardinality: 'many', pairs: [{ parentColumnId: id, childColumnId: 'c' }] } as unknown as Rel);
    expect(await undo()).toBe('Add column EMAIL');
    expect(columns.has(id)).toBe(false);
  });

  // Un borrado en cascada relee lo vigente: si se cae a mitad, re-correrlo parte
  // de un estado a medias y su contrario saldría incompleto.
  it('rehacer «Delete table» sin respuesta y sin grabar: nada a medias, el Redo vuelve y el reintento la borra entera', async () => {
    await st().deleteTable('t1');
    const after = snapshot();
    await undo();
    const before = snapshot();
    lotFault = 'lost';
    await expect(redo()).rejects.toThrow('No response from the server: nothing was redone. Press Redo to try again.');
    expect(snapshot()).toEqual(before);
    expect(redoLabels()).toEqual(['Delete table M_CLIENTE']);
    expect(await redo()).toBe('Delete table M_CLIENTE');
    expect(snapshot()).toEqual(after);
    expect(await undo()).toBe('Delete table M_CLIENTE');
    expect(snapshot()).toEqual(before);
  });

  it('rehacer «Delete table» sin respuesta pero grabado: rehecho entero y su Undo lo repone', async () => {
    await st().deleteTable('t1');
    const after = snapshot();
    await undo();
    const before = snapshot();
    lotFault = 'lost-saved';
    expect(await redo()).toBe('Delete table M_CLIENTE');
    expect(snapshot()).toEqual(after);
    expect(await undo()).toBe('Delete table M_CLIENTE');
    expect(snapshot()).toEqual(before);
  });

  it('deshacer «Create table» sin respuesta y sin grabar: el reintento la borra y deja qué rehacer', async () => {
    await st().createTableFromSources({ logicalName: 'copia', columns: [
      { logicalName: 'cod', physicalName: 'CODCLIENTE', dataType: 'STRING', typeOverridden: false, isPrimaryKey: true, sourceTable: 'M_CLIENTE' },
    ] } as never);
    lotFault = 'lost';
    await expect(undo()).rejects.toThrow('No response from the server: nothing was undone. Press Undo to try again.');
    expect([...tables.values()].some((t) => t.physicalName === 'COPIA')).toBe(true);
    expect(await undo()).toBe('Create table COPIA');
    expect([...tables.values()].some((t) => t.physicalName === 'COPIA')).toBe(false);
    expect(redoLabels()).toEqual(['Create table COPIA']);
    expect(await redo()).toBe('Create table COPIA');
    expect([...tables.values()].some((t) => t.physicalName === 'COPIA')).toBe(true);
  });

  it('rehacer «Delete view» con la lectura de dónde se usa caída: no borra nada y la entrada vuelve para reintentar', async () => {
    await st().deleteView(clone(views.get('v1')!));
    await undo();
    vi.mocked(viewsSvc.tableViews).mockRejectedValueOnce(new Error('Bad gateway'));
    await expect(redo()).rejects.toThrow("Couldn't check where this view is used: nothing was redone. Press Redo to try again.");
    expect(views.has('v1')).toBe(true);
    expect(redoLabels()).toEqual(['Delete view V_CLIENTE']);
    expect(await redo()).toBe('Delete view V_CLIENTE');
    expect(views.has('v1')).toBe(false);
  });

  it('borrar una relación (apaga la FK de la hija): rehacer la recalcula, también con otro canvas abierto', async () => {
    await roundTrip(async () => {
      await st().deleteRelationship('r1');
      expect(columns.get('c')?.isForeignKey).toBe(false);
    }, 'Delete relationship', { otherCanvas: 'sa2' });
  });

  it('rehacer un borrado lo recalcula: una vista nueva sobre la tabla también se va, y el siguiente Undo la repone', async () => {
    await st().deleteTable('t1');
    await undo();
    // Otro usuario publicó una vista sobre la tabla (el draft la ve; esta pestaña no escribió nada).
    views.set('v2', { id: 'v2', name: 'V_NUEVA', tableId: 't1', sourceTableIds: ['t1'], sources: [{ column: 'NOMBRE', tableId: 't1' }] } as View);
    const withNew = snapshot();
    await redo();
    expect(views.has('v2')).toBe(false);
    await undo();
    expect(snapshot()).toEqual(withNew);
  });

  describe('pegar una tabla con un esquema nuevo', () => {
    const paste = () => st().pasteTable({
      table: { ...tables.get('t1')!, schema: 'STG_NUEVO' } as never, cols: [clone(columns.get('k')!) as never],
      createSchema: { name: 'STG_NUEVO' },
    });
    beforeEach(() => {
      vi.mocked(schemas.schemaImpact).mockImplementation(async (id) =>
        ({ name: 's', tables: [...tables.values()].filter((t) => t.schema === schemaRows.get(id)?.name).length, views: 0, canvases: 0 }));
      vi.mocked(schemas.listSchemas).mockImplementation(async () => [...schemaRows.values()].map(clone) as never);
      // El endpoint de borrar esquema revisa el uso en el servidor y su escritura se avisa (con número).
      vi.mocked(schemas.deleteSchema).mockImplementation(async (id) => {
        const name = schemaRows.get(id)?.name;
        if ([...tables.values()].some((t) => t.schema === name)) throw new Error("The schema still has 1 table(s)/view(s): it can't be deleted.");
        schemaRows.delete(id);
        draftLedger.write(CS, [{ collection: 'schemas', entityId: id, op: 'delete' }]);
      });
      useModelerStore.setState({ tblClipboard: { table: tables.get('t1') as never, cols: [columns.get('k') as never] } });
    });

    it('deshacer borra la tabla y el esquema; rehacer vuelve los dos, también después de una recarga', async () => {
      await roundTrip(paste, 'Paste table M_CLIENTE_copy_1', { between: () => st().reload() });
    });

    it('si mientras se deshace otra tabla empezó a usar el esquema, el servidor no lo borra', async () => {
      await paste();
      const [sid] = [...schemaRows.keys()];
      // La consulta de uso responde antes de que otra pestaña ponga una tabla en el esquema.
      vi.mocked(schemas.schemaImpact).mockResolvedValueOnce({ name: 'STG_NUEVO', tables: 0, views: 0, canvases: 0 });
      tables.set('t9', { id: 't9', physicalName: 'M_OTRA', logicalName: 'Otra', schema: 'STG_NUEVO' } as gov.CanonicalTable);
      await undo();
      expect(schemaRows.has(sid)).toBe(true);
    });

    // Desde el doc 133 el Schema manager vacía el historial al renombrar; el paso
    // igual no depende del nombre que tenía el esquema al pegar.
    it('renombrado antes de deshacer: rehacer lo repone con su nombre vigente', async () => {
      await paste();
      // El esquema cambia de nombre (el servidor propaga el nombre a sus tablas) y el canvas recarga.
      const [sid] = [...schemaRows.keys()];
      schemaRows.set(sid, { ...schemaRows.get(sid)!, name: 'STG_OTRO' });
      for (const t of tables.values()) if (t.schema === 'STG_NUEVO') tables.set(t.id, { ...t, schema: 'STG_OTRO' });
      draftLedger.write(CS, [{ collection: 'schemas', entityId: sid, op: 'upsert' }]);
      await st().reload();
      const renamed = snapshot();
      await undo();
      expect(schemaRows.size).toBe(0);
      expect(await redo()).toBe('Paste table M_CLIENTE_copy_1');
      expect(snapshot()).toEqual(renamed);
    });
  });

  it('si la recarga ve escrituras en la versión que esta pestaña no hizo, lo pendiente de rehacer se vacía', async () => {
    await st().deleteTable('t1');
    await undo();
    await st().reload();
    expect(redoLabels()).toEqual(['Delete table M_CLIENTE']);   // lo propio no cuenta
    draftLedger.foreign();                                       // otra pestaña, un esquema
    await st().reload();
    expect(redoLabels()).toEqual([]);
  });

  // Desde otro canvas no se deshace (doc 133): avisa sin tocar nada. En el suyo,
  // deshacer el alta deja qué rehacer y rehacer la devuelve igual.
  it('«Create table» no se deshace con otro canvas abierto (doc 133); en el suyo, deshacer deja qué rehacer', async () => {
    const before = snapshot();
    await st().createTable({ logicalName: 'NUEVA', mode: 'physical' });
    const after = snapshot();
    const id = Object.keys(after.tables).find((t) => !(t in before.tables))!;
    await open('sa2');
    await expect(undo()).rejects.toMatchObject({ cmd: 'undo', canvasId: 'sa1' });
    expect(snapshot()).toEqual(after);
    await open('sa1');
    expect(await undo()).toBe('Create table NUEVA');
    expect(snapshot()).toEqual(before);
    expect(redoLabels()).toEqual(['Create table NUEVA']);
    expect(await redo()).toBe('Create table NUEVA');
    expect(snapshot().canvases.sa1.tableIds).toContain(id);
    expect(snapshot()).toEqual(after);
  });
});

