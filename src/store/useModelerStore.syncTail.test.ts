// Doc 105 (ronda 3) — alta y baja de columna: después de escribir la columna
// sincronizan las vistas espejo (best-effort) y recargan. Si la sesión cambió
// durante esa sincronización, lo que sigue (el aviso «Column also … view(s)»,
// la recarga y el tick del Explorer) ya no es de la sesión en pantalla: se corta.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return {
    ...actual,
    createColumn: vi.fn(async () => ({})), deleteColumn: vi.fn(async () => ({})), listDomains: vi.fn(async () => []),
    listRelationships: vi.fn(async () => []), listColumns: vi.fn(async () => []),
  };
});
vi.mock('@/services/views.service', () => ({ listViews: vi.fn(), updateView: vi.fn() }));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import { toast } from 'sonner';
import * as viewsSvc from '@/services/views.service';
import * as mod from '../features/modeler/services/modeler.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';

const COD = { id: 'c1', tableId: 't1', physicalName: 'COD', logicalName: 'cod', dataType: 'STRING', typeOverridden: false, ordinal: 0 };
// Vista espejo de t1: refleja TODAS sus columnas.
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
  vi.mocked(viewsSvc.listViews).mockResolvedValue([structuredClone(MIRROR)] as never);
  vi.mocked(mod.loadDiagram).mockResolvedValue(structuredClone(DIA) as never);
});

describe('la cola de alta/baja de columna es de su sesión (doc 105, ronda 3)', () => {
  it('alta: si la sesión cambió mientras sincronizaba vistas, no avisa ni recarga', async () => {
    switchDuringSync();
    await useModelerStore.getState().addColumn('t1', { logicalName: 'NUEVA', mode: 'physical' });
    expect(viewsSvc.updateView).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(mod.loadDiagram).not.toHaveBeenCalled();
  });

  it('baja: ídem', async () => {
    switchDuringSync();
    await useModelerStore.getState().deleteColumn('c1');
    expect(viewsSvc.updateView).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(mod.loadDiagram).not.toHaveBeenCalled();
  });

  it('sin cambio de sesión, avisa y recarga como siempre', async () => {
    vi.mocked(viewsSvc.updateView).mockResolvedValue({} as never);
    await useModelerStore.getState().addColumn('t1', { logicalName: 'NUEVA', mode: 'physical' });
    expect(toast.success).toHaveBeenCalledWith('Column also added to 1 mirror view(s)');
    expect(mod.loadDiagram).toHaveBeenCalled();
  });
});
