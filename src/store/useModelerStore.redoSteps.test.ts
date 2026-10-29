// Redo de las acciones simétricas del store: deshacer → rehacer → deshacer
// graba lo mismo que la acción y que su Undo, por los mismos servicios, con el
// contador de escrituras de la versión al día (`draftLedger`). Trazo de un wire,
// colores, color de una tabla/vista, Auto-arrange, editar una columna (con
// rename y con la llave), reordenar, la llave al soltar y editar una relación.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/changeset.service', async (orig) =>
  (await import('@/store/draftLedger.testutil')).withDraftLedger(await orig()));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('../features/modeler/services/structure.service', () => ({
  setWireRoute: vi.fn(), arrangeSubjectArea: vi.fn(), setCanvasColors: vi.fn(),
}));
vi.mock('../features/modeler/lib/arrangeGraph', () => ({ arrangeDiagram: vi.fn() }));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return {
    ...actual,
    updateColumn: vi.fn(), recordChangesBulk: vi.fn(), updateRelationship: vi.fn(), createTable: vi.fn(),
    currentTable: vi.fn(), listColumns: vi.fn(),
  };
});
vi.mock('@/services/views.service', () => ({ listViews: vi.fn(), updateView: vi.fn(), currentView: vi.fn(), viewWriteDoc: (id: string, body: object) => ({ ...body, id }) }));

import * as struct from '../features/modeler/services/structure.service';
import { arrangeDiagram } from '../features/modeler/lib/arrangeGraph';
import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import type { View } from '@/services/views.service';
import { draftLedger } from './draftLedger.testutil';
import { inObjectOrder, useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';

const CS = 'cs1';
const st = () => useModelerStore.getState;
const realReload = useModelerStore.getState().reload;
const undo = () => useUndoStore.getState().undoLast();
const redo = () => useUndoStore.getState().redoLast();
const redoLabels = () => useUndoStore.getState().redoStack.map((e) => e.label);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Col = gov.CanonicalColumn;
const col = (id: string, ordinal: number, over: Partial<Col> = {}): Col =>
  ({ id, tableId: 't1', physicalName: id.toUpperCase(), logicalName: id, dataType: 'INT', typeOverridden: false, ordinal, ...over });
const REL = { id: 'r1', parentTableId: 't1', childTableId: 't2', identifying: false, parentCardinality: 'one', childCardinality: 'many',
  pairs: [{ parentColumnId: 'k', childColumnId: 'c' }] } as unknown as gov.Relationship;

/** La working copy que leen `currentTable`/`currentView`/`listViews` y graban los mocks. */
let tables: Map<string, gov.CanonicalTable>;
let views: Map<string, View>;

function setDiagram(cols: Col[], over: Record<string, unknown> = {}) {
  useModelerStore.setState({
    activeSaId: 'sa1', dirty: false,
    diagram: {
      subjectArea: { id: 'sa1', projectId: 'p', name: 'Canvas', tableIds: ['t1', 't2'], viewIds: [], layout: {}, routes: {}, colors: {} },
      tables: [...tables.values()], columns: cols, relationships: [REL], views: [...views.values()],
      ...over,
    } as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.getState().openModel({ projectId: 'p', mode: 'editing', changesetId: CS });
  useUndoStore.getState().clear();
  useModelerStore.setState({ reload: vi.fn(async () => {}) });
  tables = new Map([['t1', { id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente', description: 'd' } as gov.CanonicalTable]]);
  views = new Map([['v1', { id: 'v1', name: 'VW_CLIENTE', tableId: 't1', sourceTableIds: ['t1'], sources: [{ column: 'A', tableId: 't1' }] } as View]]);
  const wrote = async () => { draftLedger.write(CS); return {} as never; };
  vi.mocked(struct.setWireRoute).mockImplementation(wrote);
  vi.mocked(struct.arrangeSubjectArea).mockImplementation(wrote);
  vi.mocked(struct.setCanvasColors).mockImplementation(wrote);
  vi.mocked(gov.updateColumn).mockImplementation(wrote);
  vi.mocked(gov.recordChangesBulk).mockImplementation(wrote);
  vi.mocked(gov.updateRelationship).mockImplementation(wrote);
  vi.mocked(gov.createTable).mockImplementation(async (t) => { tables.set(t.id, t); draftLedger.write(CS); return {} as never; });
  vi.mocked(gov.currentTable).mockImplementation(async (id) => tables.get(id) ?? null);
  vi.mocked(gov.listColumns).mockImplementation(async () => []);
  vi.mocked(viewsSvc.listViews).mockImplementation(async () => [...views.values()]);
  vi.mocked(viewsSvc.currentView).mockImplementation(async (id) => views.get(id) ?? null);
  vi.mocked(viewsSvc.updateView).mockImplementation(async (id, v) => { views.set(id, { ...(v as View), id }); draftLedger.write(CS); return v as never; });
});
afterEach(() => { useModelerStore.setState({ reload: realReload }); });

/** Deshacer → rehacer → deshacer, comprobando que cada paso dejó su contrario. */
async function roundTrip(label: string) {
  expect(await undo()).toBe(label);
  expect(redoLabels()).toEqual([label]);
  expect(await redo()).toBe(label);
  expect(await undo()).toBe(label);
}

describe('Redo de acciones simétricas', () => {
  it('trazo de un wire: rehacer graba el trazo nuevo', async () => {
    setDiagram([]);
    const R1 = [{ x: 200, y: 40 }, { x: 200, y: 160 }];
    await st()().setWireRoute('r1', R1);
    await roundTrip('Reroute wire');
    expect(vi.mocked(struct.setWireRoute).mock.calls.map((c) => c.slice(0, 3)))
      .toEqual([['sa1', 'r1', R1], ['sa1', 'r1', null], ['sa1', 'r1', R1], ['sa1', 'r1', null]]);
  });

  it('colores de cajas: rehacer pone el color nuevo', async () => {
    setDiagram([]);
    await st()().applyCanvasColors({ t1: 'theme:th2' });
    await roundTrip('Change color');
    expect(vi.mocked(struct.setCanvasColors).mock.calls)
      .toEqual([['sa1', { t1: 'theme:th2' }], ['sa1', { t1: null }], ['sa1', { t1: 'theme:th2' }], ['sa1', { t1: null }]]);
  });

  it('color de una tabla: deshacer y rehacer solo tocan el color, sobre el documento vigente', async () => {
    setDiagram([]);
    await st()().setObjectColor('t1', 'theme:th2');
    tables.set('t1', { ...tables.get('t1')!, description: 'otra' });   // otra escritura grabó la definición
    await undo();
    expect(tables.get('t1')).toMatchObject({ color: null, description: 'otra' });
    await redo();
    expect(tables.get('t1')).toMatchObject({ color: 'theme:th2', description: 'otra' });
    expect(await undo()).toBe('Change color of M_CLIENTE');
  });

  it('un guardado en la fila de una tabla (aún leyendo) al pulsar Redo lo cancela: el paso no corre', async () => {
    setDiagram([]);
    await st()().setObjectColor('v1', 'theme:th3');
    await undo();
    const saving = inObjectOrder('t1', async () => {
      await sleep(30);                                   // lee el documento vigente
      await gov.createTable({ ...tables.get('t1')!, description: 'nueva' });
    });
    await expect(redo()).rejects.toThrow("This version changed after the undo: there's nothing to redo.");
    await saving;
    expect(views.get('v1')!.color ?? null).toBeNull();
    expect(tables.get('t1')!.description).toBe('nueva');
  });

  it('color de una vista: rehacer lo vuelve a poner', async () => {
    setDiagram([]);
    await st()().setObjectColor('v1', 'theme:th3');
    await roundTrip('Change color of VW_CLIENTE');
    expect(vi.mocked(viewsSvc.updateView).mock.calls.map(([, v]) => (v as View).color)).toEqual(['theme:th3', null, 'theme:th3', null]);
  });

  it('Auto-arrange: rehacer vuelve a las posiciones calculadas y deja los trazos en cero', async () => {
    const R = [{ x: 1, y: 1 }];
    setDiagram([], { subjectArea: { id: 'sa1', projectId: 'p', name: 'Canvas', tableIds: ['t1'], viewIds: [], layout: {}, routes: { r1: R }, colors: {} } });
    useModelerStore.setState({ flow: { getNodes: () => [{ id: 't1', type: 'table', position: { x: 5, y: 6 } }] } as never });
    const pos = { t1: { x: 10, y: 20 } };
    vi.mocked(arrangeDiagram).mockResolvedValue(pos as never);
    await st()().autoOrganize();
    await roundTrip('Auto-arrange');
    const calls = vi.mocked(struct.arrangeSubjectArea).mock.calls.map((c) => c.slice(1));
    expect(calls).toEqual([[pos], [{ t1: { x: 5, y: 6 } }, { r1: R }], [pos], [{ t1: { x: 5, y: 6 } }, { r1: R }]]);
    expect(useModelerStore.getState().canvasRoutes).toEqual({ r1: R });
    await redo();
    expect(useModelerStore.getState().canvasRoutes).toEqual({});
  });

  it('editar una columna con rename: la vista se re-apunta en el mismo lote; deshacer y rehacer, igual', async () => {
    setDiagram([col('a', 0), col('k', 1)]);
    vi.mocked(gov.listColumns).mockImplementation(async () => [col('k', 1)]);   // ninguna homónima conserva el nombre
    const lots: gov.BulkChange[][] = [];
    vi.mocked(gov.recordChangesBulk).mockImplementation(async (changes) => {
      lots.push(changes);
      for (const ch of changes) if (ch.collection === 'views') views.set(ch.entityId, { ...(ch.payload as unknown as View), id: ch.entityId });
      draftLedger.write(CS);
      return {} as never;
    });
    const colOf = (lot: gov.BulkChange[]) => lot.find((ch) => ch.collection === 'canonical_columns')!.payload;
    await st()().updateColumn('a', { physicalName: 'A2', description: 'nueva' });
    expect(views.get('v1')!.sources?.map((x) => x.column)).toEqual(['A2']);
    await undo();
    expect(colOf(lots.at(-1)!)).toMatchObject({ id: 'a', physicalName: 'A' });
    expect(views.get('v1')!.sources?.map((x) => x.column)).toEqual(['A']);
    await redo();
    expect(colOf(lots.at(-1)!)).toMatchObject({ id: 'a', physicalName: 'A2', description: 'nueva', ordinal: 0 });
    expect(views.get('v1')!.sources?.map((x) => x.column)).toEqual(['A2']);
    expect(lots.map((lot) => lot.map((ch) => ch.collection))).toEqual(Array(3).fill(['canonical_columns', 'views']));
    expect(await undo()).toBe('Edit column A');
  });

  it('entrar a la llave: rehacer graba el mismo lote que la acción', async () => {
    setDiagram([col('k', 0, { isPrimaryKey: true }), col('a', 1), col('c', 2)]);
    await st()().updateColumn('c', { isPrimaryKey: true });
    await roundTrip('Edit column C');
    const lots = vi.mocked(gov.recordChangesBulk).mock.calls.map(([ch]) => ch);
    expect(lots[2]).toEqual(lots[0]);
    expect(lots[3]).toEqual(lots[1]);
    expect(Object.fromEntries(lots[0].map((ch) => [ch.entityId, (ch.payload as unknown as Col).ordinal]))).toEqual({ c: 1, a: 2 });
    expect(Object.fromEntries(lots[1].map((ch) => [ch.entityId, (ch.payload as unknown as Col).ordinal]))).toEqual({ c: 2, a: 1 });
  });

  it('reordenar: rehacer pone los ordinales nuevos sobre lo vigente', async () => {
    setDiagram([col('a', 0), col('b', 1), col('c', 2)]);
    await st()().reorderColumns('t1', ['c', 'a', 'b']);
    await roundTrip('Reorder columns');
    const writes = vi.mocked(gov.updateColumn).mock.calls.map(([c]) => `${c.id}:${c.ordinal}`);
    expect(writes).toEqual(['c:0', 'a:1', 'b:2', 'a:0', 'b:1', 'c:2', 'c:0', 'a:1', 'b:2', 'a:0', 'b:1', 'c:2']);
  });

  it('la llave al soltar en el bloque: rehacer la vuelve a marcar', async () => {
    setDiagram([col('k', 0, { isPrimaryKey: true }), col('b', 1)]);
    await st()().applyCanvasDrop('t1', { order: null, key: [{ id: 'b', isPrimaryKey: true }] } as never);
    await roundTrip('Edit key');
    expect(vi.mocked(gov.updateColumn).mock.calls.map(([c]) => [c.id, !!c.isPrimaryKey]))
      .toEqual([['b', true], ['b', false], ['b', true], ['b', false]]);
  });

  it('editar una relación: rehacer graba la relación editada', async () => {
    setDiagram([]);
    await st()().updateRelationship({ ...REL, parentCardinality: 'zeroOrOne' } as unknown as gov.Relationship);
    await roundTrip('Edit relationship');
    expect(vi.mocked(gov.updateRelationship).mock.calls.map(([r]) => r.parentCardinality))
      .toEqual(['zeroOrOne', 'one', 'zeroOrOne', 'one']);
  });
});
