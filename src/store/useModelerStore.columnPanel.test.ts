import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/governance.service', () => ({
  deleteColumn: vi.fn().mockResolvedValue({}),
  deleteRelationship: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/features/modeler/services/modeler.service', () => ({}));
import { useModelerStore } from './useModelerStore';

// Doc 49: el Properties de columna es un sidebar propio (selectedColumnId);
// estas pruebas fijan el contrato de apertura/cierre respecto a la selección.
describe('useModelerStore — Properties de columna (doc 49)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Sin canvas activo el reload() interno es no-op (no pega al backend).
    useModelerStore.setState({
      activeSaId: null, dirty: false,
      selectedTableId: null, selectedEdgeId: null, selectedColumnId: null, panelFocusColId: null,
    });
  });

  it('focusColumnInPanel abre el panel de columna (tabla + columna seleccionadas)', () => {
    useModelerStore.getState().focusColumnInPanel('t1', 'c1');
    const s = useModelerStore.getState();
    expect(s.selectedTableId).toBe('t1');
    expect(s.selectedColumnId).toBe('c1');
    expect(s.selectedEdgeId).toBeNull();
    // Ya no navega el panel de tabla: el deep-link queda para el botón Back.
    expect(s.panelFocusColId).toBeNull();
  });

  it('seleccionar una tabla o un edge cierra el panel de columna', () => {
    useModelerStore.getState().focusColumnInPanel('t1', 'c1');
    useModelerStore.getState().setSelectedTable('t2');
    expect(useModelerStore.getState().selectedColumnId).toBeNull();
    useModelerStore.getState().focusColumnInPanel('t1', 'c1');
    useModelerStore.getState().setSelectedEdge('r1');
    expect(useModelerStore.getState().selectedColumnId).toBeNull();
  });

  it('cerrar el panel de columna conserva la tabla (vuelve al panel de tabla)', () => {
    useModelerStore.getState().focusColumnInPanel('t1', 'c1');
    useModelerStore.getState().setSelectedColumn(null);
    const s = useModelerStore.getState();
    expect(s.selectedColumnId).toBeNull();
    expect(s.selectedTableId).toBe('t1');
  });

  it('deleteColumn cierra el panel si la columna borrada era la abierta', async () => {
    useModelerStore.setState({ selectedColumnId: 'c1' });
    await useModelerStore.getState().deleteColumn('c1');
    expect(useModelerStore.getState().selectedColumnId).toBeNull();
  });

  it('deleteColumn no toca el panel si la borrada es OTRA columna', async () => {
    useModelerStore.setState({ selectedColumnId: 'c2' });
    await useModelerStore.getState().deleteColumn('c1');
    expect(useModelerStore.getState().selectedColumnId).toBe('c2');
  });
});
