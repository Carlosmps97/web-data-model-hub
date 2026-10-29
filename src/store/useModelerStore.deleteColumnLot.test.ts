// «Delete column…» graba en un solo request las relaciones elegidas (recortadas
// o borradas), la FK que queda huérfana, la columna y las vistas que la listan:
// juntas o nada. Las vistas se leen una vez, antes de escribir, y viajan con su
// documento del estado efectivo (con `sql`), no con la copia del diagrama. Su
// Undo vuelve a poner la columna en esas vistas sobre su documento vigente.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/changeset.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/changeset.service')>()),
  writeSeqOf: async () => ({ writeSeq: 0 }),   // el candado del Undo lee el contador (doc 133): nada ajeno
}));
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

import * as gov from '@/services/governance.service';
import { ApiError } from '@/services/http';
import * as viewsSvc from '@/services/views.service';
import * as mod from '../features/modeler/services/modeler.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';

const col = (id: string, tableId: string, ordinal: number, extra: object = {}) =>
  ({ id, tableId, physicalName: id.toUpperCase(), logicalName: id, dataType: 'INT', typeOverridden: false, ordinal, ...extra });
const PA = col('pa', 'tP', 0, { isPrimaryKey: true });
const PB = col('pb', 'tP', 1, { isPrimaryKey: true });
const HA = col('ha', 'tH', 0, { isForeignKey: true });
const HB = col('hb', 'tH', 1, { isForeignKey: true });
const R1 = { id: 'r1', parentTableId: 'tP', childTableId: 'tH', identifying: false, parentCardinality: 'one', childCardinality: 'many',
  pairs: [{ parentColumnId: 'pa', childColumnId: 'ha' }, { parentColumnId: 'pb', childColumnId: 'hb' }] };
// La vista en el estado efectivo (con el CREATE VIEW de Erwin) y su copia del diagrama (sin él).
const V1 = { id: 'v1', name: 'VU_P', tableId: 'tP', sourceTableIds: ['tP'], showOnCanvas: true, sql: 'CREATE VIEW VU_P AS …',
  sources: [{ tableId: 'tP', column: 'PA', outputAlias: 'PA' }, { tableId: 'tP', column: 'PB', outputAlias: 'PB' }, { expression: '1', outputAlias: 'UNO' }] };
const V1_COPY = Object.fromEntries(Object.entries(V1).filter(([k]) => k !== 'sql'));
// Una vista legacy (sin `sourceTableIds`): el lote la normaliza como `updateView`.
const V2 = { id: 'v2', name: 'VU_P2', tableId: 'tP', sources: [{ column: 'PB', outputAlias: 'PB' }] };
const DIA = {
  subjectArea: { id: 'sa1', projectId: 'p1', name: 'C', folderId: null, tableIds: ['tP', 'tH'], viewIds: ['v1'], layout: {} },
  tables: [{ id: 'tH', physicalName: 'H', logicalName: 'h' }, { id: 'tP', physicalName: 'P', logicalName: 'p' }],
  columns: [HA, HB, PA, PB], relationships: [R1], views: [V1_COPY], productionStamp: '1:a',
};
const lot = (call = 0) => vi.mocked(gov.recordChangesBulk).mock.calls[call][0];

beforeEach(async () => {
  vi.clearAllMocks();
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useUndoStore.setState({ stack: [], busy: false });
  vi.mocked(gov.listRelationships).mockImplementation(async () => [structuredClone(R1)] as never);
  vi.mocked(gov.listColumns).mockImplementation(async () => [] as never);
  vi.mocked(gov.recordChangesBulk).mockImplementation(async () => ({}) as never);
  vi.mocked(viewsSvc.listViews).mockImplementation(async () => [structuredClone(V1), structuredClone(V2)] as never);
  vi.mocked(mod.loadDiagram).mockImplementation(async () => structuredClone(DIA) as never);
  useModelerStore.setState({ projects: [{ id: 'p1', name: 'Uno' } as never], activeProjectId: 'p1', activeSaId: null, diagram: null,
    subjectAreas: [DIA.subjectArea] as never, openingSaId: null, viewMode: 'physical', selectedColumnId: null });
  await useModelerStore.getState().selectSubjectArea('sa1');
});

describe('borrar una columna: un solo lote', () => {
  it('relación recortada, FK huérfana, columna y vistas van juntas; las vistas se leen una vez', async () => {
    await useModelerStore.getState().deleteColumn('pb', ['r1']);
    expect(gov.recordChangesBulk).toHaveBeenCalledTimes(1);
    expect(lot()).toEqual([
      { collection: 'relationships', entityId: 'r1', op: 'upsert', payload: { ...R1, pairs: [R1.pairs[0]] } },
      { collection: 'canonical_columns', entityId: 'hb', op: 'upsert', payload: { ...HB, isForeignKey: false } },
      { collection: 'canonical_columns', entityId: 'pb', op: 'delete' },
      { collection: 'views', entityId: 'v1', op: 'upsert', payload: { ...V1, sources: [V1.sources[0], V1.sources[2]] } },
      { collection: 'views', entityId: 'v2', op: 'upsert', payload: { ...V2, sources: [], sourceTableIds: ['tP'] } },
    ]);
    expect(viewsSvc.listViews).toHaveBeenCalledTimes(1);
    for (const one of [gov.updateColumn, gov.updateRelationship, gov.deleteRelationship, gov.deleteColumn, viewsSvc.updateView]) {
      expect(one).not.toHaveBeenCalled();
    }
  });

  it('si el lote no se graba (una vista que no valida), no se borra nada, no queda Undo y el panel sigue abierto', async () => {
    useModelerStore.setState({ selectedColumnId: 'pb' });
    vi.mocked(gov.recordChangesBulk).mockRejectedValueOnce(new ApiError('views/v1: name: Field required', 422));
    await expect(useModelerStore.getState().deleteColumn('pb', ['r1'])).rejects.toThrow('views/v1');
    expect(gov.recordChangesBulk).toHaveBeenCalledTimes(1);
    expect(viewsSvc.updateView).not.toHaveBeenCalled();
    expect(useUndoStore.getState().stack).toEqual([]);
    expect(useModelerStore.getState().selectedColumnId).toBe('pb');
  });

  it('un lote de más de mil cambios va igual en un solo request', async () => {
    // 600 relaciones de un solo par, cada una con su hija: 600 bajas y 600 FK que se apagan.
    const many = Array.from({ length: 600 }, (_, i) => ({ ...R1, id: `r${i}`, pairs: [{ parentColumnId: 'pb', childColumnId: `h${i}` }] }));
    const children = many.map((_, i) => ({ ...HB, id: `h${i}` }));
    vi.mocked(gov.listRelationships).mockImplementation(async () => structuredClone(many) as never);
    vi.mocked(gov.listColumns).mockImplementation(async () => structuredClone(children) as never);
    await useModelerStore.getState().deleteColumn('pb', many.map((r) => r.id));
    expect(gov.recordChangesBulk).toHaveBeenCalledTimes(1);
    const [changes, chunk] = vi.mocked(gov.recordChangesBulk).mock.calls[0];
    expect(changes.length).toBeGreaterThan(1000);
    expect(chunk).toBe(changes.length);
  });

  it('el Undo repone columna, FK y relación, y la columna en sus vistas sobre su documento vigente', async () => {
    await useModelerStore.getState().deleteColumn('pb', ['r1']);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Delete column PB']);
    // Después del borrado: v1 se renombró y ganó una columna; v2 sigue sin fuentes.
    const v1Now = { ...V1, name: 'VU_P_NUEVA', sources: [V1.sources[0], V1.sources[2], { tableId: 'tP', column: 'PZ', outputAlias: 'PZ' }] };
    vi.mocked(viewsSvc.listViews).mockResolvedValueOnce([v1Now, { ...V2, sources: [], sourceTableIds: ['tP'] }] as never);
    await useUndoStore.getState().undoLast();
    expect(gov.recordChangesBulk).toHaveBeenCalledTimes(2);
    expect(lot(1)).toEqual([
      { collection: 'canonical_columns', entityId: 'pb', op: 'upsert', payload: PB },
      { collection: 'canonical_columns', entityId: 'hb', op: 'upsert', payload: HB },
      { collection: 'relationships', entityId: 'r1', op: 'upsert', payload: R1 },
      { collection: 'views', entityId: 'v1', op: 'upsert',
        payload: { ...v1Now, sources: [V1.sources[0], V1.sources[1], V1.sources[2], v1Now.sources[2]] } },
      // La fuente legacy vuelve con su tabla explícita.
      { collection: 'views', entityId: 'v2', op: 'upsert', payload: { ...V2, sourceTableIds: ['tP'], sources: [{ ...V2.sources[0], tableId: 'tP' }] } },
    ]);
    expect(vi.mocked(gov.recordChangesBulk).mock.calls[1][1]).toBe(5);
    expect(viewsSvc.updateView).not.toHaveBeenCalled();
  });

  it('el Undo no toca una vista borrada, que ya volvió a listar la columna o que ya no lee de esa tabla', async () => {
    await useModelerStore.getState().deleteColumn('pb', ['r1']);
    vi.mocked(viewsSvc.listViews).mockResolvedValueOnce([structuredClone(V1)] as never);   // v1 ya la tiene; v2 no existe
    await useUndoStore.getState().undoLast();
    expect(lot(1).map((c) => c.collection)).toEqual(['canonical_columns', 'canonical_columns', 'relationships']);
    // Re-apuntada a otra tabla después del borrado (el draft la sigue devolviendo para tP).
    await useModelerStore.getState().deleteColumn('pb', ['r1']);
    vi.mocked(viewsSvc.listViews).mockResolvedValueOnce([{ ...V1, tableId: 'tQ', sourceTableIds: ['tQ'],
      sources: [{ tableId: 'tQ', column: 'QX', outputAlias: 'QX' }] }] as never);
    await useUndoStore.getState().undoLast();
    expect(lot(3).map((c) => c.collection)).toEqual(['canonical_columns', 'canonical_columns', 'relationships']);
  });

  it('si el Undo no puede leer las vistas, no escribe nada y queda para reintentar', async () => {
    await useModelerStore.getState().deleteColumn('pb', ['r1']);
    vi.mocked(viewsSvc.listViews).mockRejectedValueOnce(new ApiError('red', 0));
    await expect(useUndoStore.getState().undoLast()).rejects.toThrow("Couldn't read the views of PB: nothing was undone. Press Undo to try again.");
    expect(gov.recordChangesBulk).toHaveBeenCalledTimes(1);
    expect(useUndoStore.getState().stack.map((e) => e.label)).toEqual(['Delete column PB']);
  });
});
