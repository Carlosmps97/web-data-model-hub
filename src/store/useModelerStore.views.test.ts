// Vistas en el canvas (F3): saveAllLayout persiste layout[viewId] y focusTable
// sobre un nodo 'view' centra SIN seleccionar (nunca abre el PropertiesPanel).
// Mock del service (patrón useIdentityStore.test.ts): `import * as mod` accede
// a las funciones recién al invocarlas, así el mock parcial alcanza.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/modeler/services/modeler.service', () => ({
  setSubjectAreaLayout: vi.fn().mockResolvedValue({}),
}));
import { setSubjectAreaLayout } from '@/features/modeler/services/modeler.service';
import { useModelerStore } from './useModelerStore';

type FakeNode = { id: string; type: string; position: { x: number; y: number } };
const fakeFlow = (nodes: FakeNode[]) => ({
  getNodes: () => nodes,
  getNode: (id: string) => nodes.find((n) => n.id === id),
  fitView: vi.fn().mockResolvedValue(true),
}) as never;

beforeEach(() => {
  useModelerStore.setState({ activeSaId: 'sa1', flow: null, selectedTableId: null, selectedEdgeId: null, dirty: false });
  vi.clearAllMocks();
});

describe('useModelerStore — vistas en canvas (F3)', () => {
  it('saveAllLayout persiste tablas Y vistas (los shapes viven en drawings)', async () => {
    useModelerStore.setState({
      flow: fakeFlow([
        { id: 't1', type: 'table', position: { x: 1, y: 2 } },
        { id: 'v1', type: 'view', position: { x: 3, y: 4 } },
        { id: 's1', type: 'shape', position: { x: 5, y: 6 } },
      ]),
    });
    await useModelerStore.getState().saveAllLayout();
    expect(setSubjectAreaLayout).toHaveBeenCalledWith('sa1', { t1: { x: 1, y: 2 }, v1: { x: 3, y: 4 } });
  });

  it('focusTable sobre un nodo VIEW centra sin abrir selección (sin PropertiesPanel)', () => {
    useModelerStore.setState({ flow: fakeFlow([{ id: 'v1', type: 'view', position: { x: 0, y: 0 } }]) });
    useModelerStore.getState().focusTable('v1');
    expect(useModelerStore.getState().selectedTableId).toBeNull();
  });

  it('focusTable sobre una tabla la sigue seleccionando (regresión)', () => {
    useModelerStore.setState({ flow: fakeFlow([{ id: 't1', type: 'table', position: { x: 0, y: 0 } }]) });
    useModelerStore.getState().focusTable('t1');
    expect(useModelerStore.getState().selectedTableId).toBe('t1');
  });
});
