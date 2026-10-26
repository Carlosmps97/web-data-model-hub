// Borrar varias columnas de una tabla (menú del canvas) cuesta lo mismo que
// borrar una: las relaciones y las vistas de la tabla se leen una vez, las FK de
// la otra punta una vez por tabla hija, y todo va en un solo lote (relaciones,
// FK huérfanas, columnas y cada vista una vez). Un solo Undo lo repone todo.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return {
    ...actual,
    listRelationships: vi.fn(), listColumns: vi.fn(), recordChangesBulk: vi.fn(),
    updateColumn: vi.fn(), updateRelationship: vi.fn(), deleteRelationship: vi.fn(), deleteColumn: vi.fn(),
  };
});
vi.mock('@/services/views.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/views.service')>();
  return { ...actual, listViews: vi.fn(), updateView: vi.fn() };
});
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import { toast } from 'sonner';
import * as gov from '@/services/governance.service';
import { ApiError } from '@/services/http';
import * as viewsSvc from '@/services/views.service';
import { SessionChangedError } from '../features/modeler/lib/sessionGuard';
import * as mod from '../features/modeler/services/modeler.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';

const col = (id: string, tableId: string, ordinal: number, extra: object = {}) =>
  ({ id, tableId, physicalName: id.toUpperCase(), logicalName: id, dataType: 'INT', typeOverridden: false, ordinal, ...extra });
const PA = col('pa', 'tP', 0, { isPrimaryKey: true });
const PB = col('pb', 'tP', 1, { isPrimaryKey: true });
const C1 = col('c1', 'tP', 2);
const HA = col('ha', 'tH', 0, { isForeignKey: true });
const HB = col('hb', 'tH', 1, { isForeignKey: true });
const AID = col('aid', 'tA', 0, { isPrimaryKey: true });
const APAR = col('apar', 'tA', 1, { isForeignKey: true });
const rel = (id: string, parentTableId: string, childTableId: string, pairs: [string, string][]) => ({
  id, parentTableId, childTableId, identifying: false, parentCardinality: 'one', childCardinality: 'many',
  pairs: pairs.map(([parentColumnId, childColumnId]) => ({ parentColumnId, childColumnId })),
});
const R1 = rel('r1', 'tP', 'tH', [['pa', 'ha'], ['pb', 'hb']]);
const RA = rel('rA', 'tA', 'tA', [['aid', 'apar']]);   // recursiva
// La vista en el estado efectivo (con el CREATE VIEW de Erwin) y su copia del diagrama (sin él).
const V1 = { id: 'v1', name: 'VU_P', tableId: 'tP', sourceTableIds: ['tP'], showOnCanvas: true, sql: 'CREATE VIEW VU_P AS …',
  sources: [{ tableId: 'tP', column: 'PA', outputAlias: 'PA' }, { tableId: 'tP', column: 'PB', outputAlias: 'PB' },
    { tableId: 'tP', column: 'C1', outputAlias: 'C1' }, { expression: '1', outputAlias: 'UNO' }] };
const V1_COPY = Object.fromEntries(Object.entries(V1).filter(([k]) => k !== 'sql'));
const DIA = {
  subjectArea: { id: 'sa1', projectId: 'p1', name: 'C', folderId: null, tableIds: ['tP', 'tH', 'tA'], viewIds: ['v1'], layout: {} },
  tables: [{ id: 'tH', physicalName: 'H', logicalName: 'h' }, { id: 'tP', physicalName: 'P', logicalName: 'p' }, { id: 'tA', physicalName: 'A', logicalName: 'a' }],
  columns: [HA, HB, PA, PB, C1, AID, APAR], relationships: [R1, RA], views: [V1_COPY], productionStamp: '1:a',
};
const RELS: Record<string, unknown[]> = { tP: [R1], tH: [R1], tA: [RA] };
const st = () => useModelerStore.getState();
const lot = (call = 0) => vi.mocked(gov.recordChangesBulk).mock.calls[call][0];
const relReads = () => vi.mocked(gov.listRelationships).mock.calls.map((c) => c[0]);

beforeEach(async () => {
  vi.clearAllMocks();
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useUndoStore.setState({ stack: [], busy: false });
  vi.mocked(gov.listRelationships).mockImplementation(async (t) => structuredClone(RELS[t ?? ''] ?? []) as never);
  vi.mocked(gov.listColumns).mockImplementation(async () => [] as never);
  vi.mocked(gov.recordChangesBulk).mockImplementation(async () => ({}) as never);
  vi.mocked(viewsSvc.listViews).mockImplementation(async (t) => (t === 'tP' ? [structuredClone(V1)] : []) as never);
  vi.mocked(mod.loadDiagram).mockImplementation(async () => structuredClone(DIA) as never);
  useModelerStore.setState({ projects: [{ id: 'p1', name: 'Uno' } as never], activeProjectId: 'p1', activeSaId: null, diagram: null,
    subjectAreas: [DIA.subjectArea] as never, openingSaId: null, viewMode: 'physical', selectedColumnId: null, colSel: null, dirty: false });
  await st().selectSubjectArea('sa1');
  vi.clearAllMocks();
});

describe('borrar varias columnas: un solo lote', () => {
  it('relaciones, FK huérfanas, las columnas y cada vista una vez, en un solo request', async () => {
    await st().deleteColumns(['pa', 'pb', 'c1'], ['r1']);
    expect(gov.recordChangesBulk).toHaveBeenCalledTimes(1);
    expect(lot()).toEqual([
      { collection: 'relationships', entityId: 'r1', op: 'delete' },
      { collection: 'canonical_columns', entityId: 'ha', op: 'upsert', payload: { ...HA, isForeignKey: false } },
      { collection: 'canonical_columns', entityId: 'hb', op: 'upsert', payload: { ...HB, isForeignKey: false } },
      { collection: 'canonical_columns', entityId: 'pa', op: 'delete' },
      { collection: 'canonical_columns', entityId: 'pb', op: 'delete' },
      { collection: 'canonical_columns', entityId: 'c1', op: 'delete' },
      { collection: 'views', entityId: 'v1', op: 'upsert', payload: { ...V1, sources: [V1.sources[3]] } },
    ]);
    expect(vi.mocked(gov.recordChangesBulk).mock.calls[0][1]).toBe(7);
    expect(toast.success).toHaveBeenCalledWith('Columns also removed from 1 view(s)');
  });

  it('lee las relaciones y las vistas de la tabla una vez, y las de cada tabla hija una vez', async () => {
    await st().deleteColumns(['pa', 'pb', 'c1'], ['r1']);
    expect(relReads()).toEqual(['tP', 'tH']);
    expect(viewsSvc.listViews).toHaveBeenCalledTimes(1);
    expect(gov.listColumns).not.toHaveBeenCalled();   // las hijas están en el diagrama
  });

  it('recursiva con las dos puntas elegidas: la columna borrada no recibe además el FK en false', async () => {
    await st().deleteColumns(['aid', 'apar'], ['rA']);
    const ids = lot().map((c) => `${c.collection}:${c.op}:${c.entityId}`);
    expect(ids).toEqual(['relationships:delete:rA', 'canonical_columns:delete:aid', 'canonical_columns:delete:apar']);
  });

  it('recursiva con la hija viva: su FK se apaga releyendo lo ya leído de la tabla', async () => {
    await st().deleteColumns(['aid'], ['rA']);
    expect(lot().map((c) => `${c.collection}:${c.op}:${c.entityId}`))
      .toEqual(['relationships:delete:rA', 'canonical_columns:upsert:apar', 'canonical_columns:delete:aid']);
    expect(relReads()).toEqual(['tA']);
  });

  it('2000 cambios van en un solo request; con más, avisa sin grabar ni marcar cambios', async () => {
    const big = (n: number) => Array.from({ length: n }, (_, i) => col(`z${i}`, 'tZ', i));
    const ok = big(2000);
    await st().deleteColumns(ok.map((c) => c.id), [], { cols: ok as never });
    expect(vi.mocked(gov.recordChangesBulk).mock.calls[0][1]).toBe(2000);
    vi.clearAllMocks();
    useModelerStore.setState({ dirty: false });
    useUndoStore.setState({ stack: [], busy: false });
    const tooMany = big(2001);
    await expect(st().deleteColumns(tooMany.map((c) => c.id), [], { cols: tooMany as never }))
      .rejects.toThrow('This delete needs 2001 changes and the limit is 2000 at a time: nothing was deleted. Delete fewer columns at a time.');
    expect(gov.recordChangesBulk).not.toHaveBeenCalled();
    expect(st().dirty).toBe(false);
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('si el backend rechaza el lote, no se borra nada: sin Undo, con la selección y el panel como estaban', async () => {
    useModelerStore.setState({ colSel: { tableId: 'tH', ids: ['ha'], anchor: 'ha' }, selectedColumnId: 'ha' });
    vi.mocked(gov.recordChangesBulk).mockRejectedValueOnce(
      new ApiError("Relationship must migrate the parent's full primary key (parent has 2 PK column(s), got 1 pair(s)).", 409));
    await expect(st().deleteColumns(['ha'], ['r1'])).rejects.toThrow(/full primary key/);
    expect(useUndoStore.getState().stack).toEqual([]);
    expect(st().colSel).toEqual({ tableId: 'tH', ids: ['ha'], anchor: 'ha' });
    expect(st().selectedColumnId).toBe('ha');
  });

  it('al terminar se limpia la selección y se cierra el Properties de una columna borrada', async () => {
    useModelerStore.setState({ colSel: { tableId: 'tP', ids: ['pa', 'pb'], anchor: 'pa' }, selectedColumnId: 'pb' });
    await st().deleteColumns(['pa', 'pb'], ['r1']);
    expect(st().colSel).toBeNull();
    expect(st().selectedColumnId).toBeNull();
  });

  it('ids repetidos cuentan una vez (lote, Undo y aviso)', async () => {
    await st().deleteColumns(['pa', 'pa', 'pb'], ['r1', 'r1']);
    expect(lot().map((c) => `${c.collection}:${c.op}:${c.entityId}`)).toEqual([
      'relationships:delete:r1', 'canonical_columns:upsert:ha', 'canonical_columns:upsert:hb',
      'canonical_columns:delete:pa', 'canonical_columns:delete:pb', 'views:upsert:v1',
    ]);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Delete 2 columns']);
  });

  it('no recorre el diagrama una vez por columna (canvas de decenas de miles de columnas)', async () => {
    let finds = 0;
    const d = st().diagram!;
    const columns = new Proxy(d.columns, { get: (t, k, r) => { if (k === 'find') finds += 1; return Reflect.get(t, k, r); } });
    useModelerStore.setState({ diagram: { ...d, columns } });
    await st().deleteColumns(['pa', 'pb', 'c1'], ['r1']);
    expect(finds).toBe(0);
  });

  it('en lógico, los textos de varias dicen attributes', async () => {
    useModelerStore.setState({ viewMode: 'logical' });
    await st().deleteColumns(['pa', 'pb', 'c1'], ['r1']);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Delete 3 attributes']);
    // Las vistas son del modelo físico: listan columnas.
    expect(toast.success).toHaveBeenCalledWith('Columns also removed from 1 view(s)');
    vi.mocked(viewsSvc.listViews).mockRejectedValueOnce(new ApiError('red', 0));
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow("Couldn't read the views of these 3 attributes: nothing was undone.");
  });

  it('en lógico, también con una sola: «Delete attribute <nombre lógico>»; en físico, el físico', async () => {
    useModelerStore.setState({ viewMode: 'logical' });
    await st().deleteColumns(['pa'], ['r1']);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Delete attribute pa']);
    expect(toast.success).toHaveBeenCalledWith('Column also removed from 1 view(s)');
    useModelerStore.setState({ viewMode: 'physical' });
    await st().deleteColumns(['pb'], ['r1']);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Delete attribute pa', 'Delete column PB']);
  });

  it('una relación del impacto que ya no toca las columnas (otro borrado la recortó) no se toca', async () => {
    const trimmed = { ...R1, pairs: [R1.pairs[1]] };   // ya solo pb→hb
    vi.mocked(gov.listRelationships).mockImplementation(async () => [structuredClone(trimmed)] as never);
    await st().deleteColumns(['pa'], ['r1']);
    expect(lot().filter((c) => c.collection === 'relationships')).toEqual([]);
  });

  it('una relación del impacto que ya no es de esta tabla (re-apuntada) no se borra', async () => {
    vi.mocked(gov.listRelationships).mockImplementation(async () => [] as never);
    await st().deleteColumns(['pa'], ['r1']);
    expect(lot().filter((c) => c.collection === 'relationships')).toEqual([]);
  });

  it('columnas de dos tablas: rechaza sin leer ni grabar', async () => {
    await expect(st().deleteColumns(['pa', 'ha'], [])).rejects.toThrow("Columns from more than one table can't be deleted together");
    expect(gov.listRelationships).not.toHaveBeenCalled();
    expect(viewsSvc.listViews).not.toHaveBeenCalled();
    expect(gov.recordChangesBulk).not.toHaveBeenCalled();
  });

  it('si la versión cambia mientras lee, no graba nada en la otra', async () => {
    let release!: () => void;
    vi.mocked(viewsSvc.listViews).mockImplementationOnce(() => new Promise((r) => { release = () => r([structuredClone(V1)] as never); }));
    const del = st().deleteColumns(['pa', 'pb'], ['r1']);
    await Promise.resolve();
    useSessionStore.setState({ activeChangesetId: 'cs2' });
    release();
    await expect(del).rejects.toBeInstanceOf(SessionChangedError);
    expect(gov.recordChangesBulk).not.toHaveBeenCalled();
  });
});

describe('deshacer el borrado de varias columnas', () => {
  it('un solo lote repone columnas, FK, relación y cada columna en su vista, en su lugar', async () => {
    await st().deleteColumns(['pa', 'pb', 'c1'], ['r1']);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Delete 3 columns']);
    // La vista vigente, después del borrado y con una columna nueva al final.
    const NEW = { tableId: 'tP', column: 'PZ', outputAlias: 'PZ' };
    vi.mocked(viewsSvc.listViews).mockResolvedValueOnce([{ ...V1, sources: [V1.sources[3], NEW] }] as never);
    await useUndoStore.getState().undoLast();
    expect(gov.recordChangesBulk).toHaveBeenCalledTimes(2);
    expect(lot(1)).toEqual([
      { collection: 'canonical_columns', entityId: 'pa', op: 'upsert', payload: PA },
      { collection: 'canonical_columns', entityId: 'pb', op: 'upsert', payload: PB },
      { collection: 'canonical_columns', entityId: 'c1', op: 'upsert', payload: C1 },
      { collection: 'canonical_columns', entityId: 'ha', op: 'upsert', payload: HA },
      { collection: 'canonical_columns', entityId: 'hb', op: 'upsert', payload: HB },
      { collection: 'relationships', entityId: 'r1', op: 'upsert', payload: R1 },
      { collection: 'views', entityId: 'v1', op: 'upsert', payload: { ...V1, sources: [...V1.sources, NEW] } },
    ]);
    expect(vi.mocked(gov.recordChangesBulk).mock.calls[1][1]).toBe(7);
  });

  it('si no puede leer las vistas, no escribe nada y queda para reintentar', async () => {
    await st().deleteColumns(['pa', 'pb', 'c1'], ['r1']);
    vi.mocked(viewsSvc.listViews).mockRejectedValueOnce(new ApiError('red', 0));
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow("Couldn't read the views of these 3 columns: nothing was undone.");
    expect(gov.recordChangesBulk).toHaveBeenCalledTimes(1);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Delete 3 columns']);
  });
});
