import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/governance.service', () => ({}));
vi.mock('@/features/modeler/services/modeler.service', () => ({}));
import { useModelerStore } from './useModelerStore';

// El Properties de vista es un sidebar propio (selectedViewId) con exclusión
// mutua total contra tabla/columna/edge — contrato de selección.
describe('useModelerStore — Properties de vista', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModelerStore.setState({
      activeSaId: null, dirty: false,
      selectedTableId: null, selectedEdgeId: null, selectedColumnId: null,
      selectedViewId: null, panelFocusColId: null,
    });
  });

  it('setSelectedView abre el panel de vista y cierra los otros contextos', () => {
    useModelerStore.setState({ selectedTableId: 't1', selectedColumnId: 'c1' });
    useModelerStore.getState().setSelectedView('v1');
    const s = useModelerStore.getState();
    expect(s.selectedViewId).toBe('v1');
    expect(s.selectedTableId).toBeNull();
    expect(s.selectedColumnId).toBeNull();
    expect(s.selectedEdgeId).toBeNull();
  });

  it('seleccionar tabla o edge cierra el panel de vista', () => {
    useModelerStore.getState().setSelectedView('v1');
    useModelerStore.getState().setSelectedTable('t1');
    expect(useModelerStore.getState().selectedViewId).toBeNull();
    useModelerStore.getState().setSelectedView('v1');
    useModelerStore.getState().setSelectedEdge('r1');
    expect(useModelerStore.getState().selectedViewId).toBeNull();
  });

  it('click en fila de tabla (focusColumnInPanel) cierra el panel de vista', () => {
    useModelerStore.getState().setSelectedView('v1');
    useModelerStore.getState().focusColumnInPanel('t1', 'c1');
    const s = useModelerStore.getState();
    expect(s.selectedViewId).toBeNull();
    expect(s.selectedColumnId).toBe('c1');
  });

  it('setSelectedTable(null) (pane click) también limpia la vista', () => {
    useModelerStore.getState().setSelectedView('v1');
    useModelerStore.getState().setSelectedTable(null);
    expect(useModelerStore.getState().selectedViewId).toBeNull();
  });
});
