// Alta y baja de columna: el alta escribe la columna y después sincroniza las
// vistas espejo (best-effort); la baja graba la columna y sus vistas en un solo
// lote. Las dos recargan después. Si la sesión cambia mientras tanto, lo que
// sigue (el aviso «Column also … view(s)», la recarga y el tick del Explorer)
// no corresponde a la sesión en pantalla: se corta.
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
    createColumn: vi.fn(async () => ({})), recordChangesBulk: vi.fn(async () => ({})), listDomains: vi.fn(async () => []),
    listRelationships: vi.fn(async () => []), listColumns: vi.fn(async () => []),
  };
});
vi.mock('@/services/views.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/views.service')>();
  return { viewWriteDoc: actual.viewWriteDoc, listViews: vi.fn(), updateView: vi.fn() };
});
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import { toast } from 'sonner';
import * as gov from '@/services/governance.service';
import * as viewsSvc from '@/services/views.service';
import * as mod from '../features/modeler/services/modeler.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';
import { useUndoStore } from './useUndoStore';

const COD = { id: 'c1', tableId: 't1', physicalName: 'COD', logicalName: 'cod', dataType: 'STRING', typeOverridden: false, ordinal: 0 };
// Vista espejo de t1: refleja todas sus columnas.
const MIRROR = { id: 'v1', name: 'VU_T1', tableId: 't1', sourceTableIds: ['t1'], sources: [{ tableId: 't1', column: 'COD', outputAlias: 'COD' }] };
const DIA = {
  subjectArea: { id: 'sa1', projectId: 'p1', name: 'C', tableIds: ['t1'], layout: {} },
  tables: [{ id: 't1', physicalName: 'T1', logicalName: 't1' }], columns: [COD], relationships: [], views: [],
};
/** La sincronización de vistas escribe y, mientras tanto, se abre otra versión. */
const switchDuringSync = () => vi.mocked(viewsSvc.updateView).mockImplementation(async () => {
  useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
  return {} as never;
});

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useModelerStore.setState({ activeSaId: 'sa1', diagram: structuredClone(DIA) as never, openingSaId: null, naming: null, explorerTick: 0 });
  useUndoStore.setState({ stack: [], busy: false });
  vi.mocked(viewsSvc.listViews).mockResolvedValue([structuredClone(MIRROR)] as never);
  vi.mocked(mod.loadDiagram).mockResolvedValue(structuredClone(DIA) as never);
});

describe('la cola de alta/baja de columna es de su sesión', () => {
  it('alta: si la sesión cambia mientras sincroniza vistas, no avisa ni recarga', async () => {
    switchDuringSync();
    await useModelerStore.getState().addColumn('t1', { logicalName: 'NUEVA', mode: 'physical' });
    expect(viewsSvc.updateView).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(mod.loadDiagram).not.toHaveBeenCalled();
  });

  it('baja: si la sesión cambia mientras graba el lote (con la vista), no avisa ni recarga', async () => {
    vi.mocked(gov.recordChangesBulk).mockImplementationOnce(async () => {
      useSessionStore.getState().openModel({ projectId: 'p1', mode: 'editing', changesetId: 'cs2' });
      return {} as never;
    });
    await useModelerStore.getState().deleteColumn('c1');
    expect(vi.mocked(gov.recordChangesBulk).mock.calls[0][0].map((c) => `${c.collection}:${c.entityId}`))
      .toEqual(['canonical_columns:c1', 'views:v1']);
    expect(viewsSvc.updateView).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(mod.loadDiagram).not.toHaveBeenCalled();
  });

  it('sin cambio de sesión, avisa y recarga', async () => {
    vi.mocked(viewsSvc.updateView).mockResolvedValue({} as never);
    await useModelerStore.getState().addColumn('t1', { logicalName: 'NUEVA', mode: 'physical' });
    expect(toast.success).toHaveBeenCalledWith('Column also added to 1 mirror view(s)');
    expect(mod.loadDiagram).toHaveBeenCalled();
    vi.clearAllMocks();
    await useModelerStore.getState().deleteColumn('c1');
    expect(toast.success).toHaveBeenCalledWith('Column also removed from 1 view(s)');
    expect(mod.loadDiagram).toHaveBeenCalled();
  });

  it('el Undo del alta saca la columna de las vistas aunque el diagrama en pantalla no la tenga', async () => {
    vi.mocked(viewsSvc.updateView).mockResolvedValue({} as never);
    await useModelerStore.getState().addColumn('t1', { logicalName: 'NUEVA', mode: 'physical' });
    const withNew = vi.mocked(viewsSvc.updateView).mock.calls[0][1];       // la espejo, ya con la columna nueva
    vi.mocked(viewsSvc.listViews).mockResolvedValue([{ ...MIRROR, ...withNew }] as never);
    expect(useModelerStore.getState().diagram!.columns.map((c) => c.id)).toEqual(['c1']);   // la recarga no la trajo
    await useUndoStore.getState().undoLast();
    const lot = vi.mocked(gov.recordChangesBulk).mock.calls.at(-1)![0];
    expect(lot.map((c) => `${c.collection}:${c.op}`)).toEqual(['canonical_columns:delete', 'views:upsert']);
    expect((lot[1].payload as { sources: unknown[] }).sources).toEqual(MIRROR.sources);
  });
});
