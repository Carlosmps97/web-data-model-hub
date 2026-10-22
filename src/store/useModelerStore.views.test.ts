// Vistas en el canvas: saveAllLayout persiste layout[viewId] y focusTable
// sobre un nodo 'view' centra sin seleccionar (nunca abre el PropertiesPanel).
// Mock del service: `import * as mod` accede
// a las funciones recién al invocarlas, así el mock parcial alcanza.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// El layout se graba por la capa changeset-aware (sin escritura directa a
// producción); aquí solo importa qué posiciones arma saveAllLayout.
vi.mock('@/features/modeler/services/structure.service', () => ({
  setSubjectAreaLayout: vi.fn().mockResolvedValue({}),
}));
import { setSubjectAreaLayout } from '@/features/modeler/services/structure.service';
import { useModelerStore } from './useModelerStore';

type FakeNode = { id: string; type: string; position: { x: number; y: number } };
const fakeFlow = (nodes: FakeNode[]) => ({
  getNodes: () => nodes,
  getNode: (id: string) => nodes.find((n) => n.id === id),
  fitView: vi.fn().mockResolvedValue(true),
  // focusTable centra con setCenter (position+tamaño con fallback) y no con
  // fitView: con onlyRenderVisibleElements el nodo puede no estar medido.
  getZoom: () => 1,
  setCenter: vi.fn().mockResolvedValue(true),
}) as never;

beforeEach(() => {
  useModelerStore.setState({ activeSaId: 'sa1', flow: null, selectedTableId: null, selectedEdgeId: null, dirty: false });
  vi.clearAllMocks();
});

describe('useModelerStore — vistas en canvas', () => {
  it('saveAllLayout persiste tablas y vistas (los shapes viven en drawings)', async () => {
    useModelerStore.setState({
      // Guarda el canvas abierto: sin diagrama no hay nada que guardar.
      diagram: { subjectArea: { id: 'sa1', name: 'sa1', tableIds: [], layout: {} }, tables: [], columns: [], relationships: [], views: [] } as never,
      flow: fakeFlow([
        { id: 't1', type: 'table', position: { x: 1, y: 2 } },
        { id: 'v1', type: 'view', position: { x: 3, y: 4 } },
        { id: 's1', type: 'shape', position: { x: 5, y: 6 } },
      ]),
    });
    await useModelerStore.getState().saveAllLayout();
    expect(setSubjectAreaLayout).toHaveBeenCalledWith('sa1', { t1: { x: 1, y: 2 }, v1: { x: 3, y: 4 } });
  });

  it('focusTable sobre un nodo view centra sin abrir selección (sin PropertiesPanel)', () => {
    useModelerStore.setState({ flow: fakeFlow([{ id: 'v1', type: 'view', position: { x: 0, y: 0 } }]) });
    useModelerStore.getState().focusTable('v1');
    expect(useModelerStore.getState().selectedTableId).toBeNull();
  });

  it('focusTable sobre una tabla la sigue seleccionando', () => {
    useModelerStore.setState({ flow: fakeFlow([{ id: 't1', type: 'table', position: { x: 0, y: 0 } }]) });
    useModelerStore.getState().focusTable('t1');
    expect(useModelerStore.getState().selectedTableId).toBe('t1');
  });
});
