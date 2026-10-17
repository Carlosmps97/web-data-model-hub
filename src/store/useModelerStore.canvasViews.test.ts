// Doc 70 §2.3: membresía de vistas en el canvas desde el store — importar una
// tabla NO arrastra sus vistas (salvo withViews), add/remove de vistas con
// Undo, y poda de vistas huérfanas al quitar una tabla. Servicios mockeados.
// Doc 100 (P5): el store pide «agrega / quita estos ids» (con la lista de vistas
// que se MUESTRA, para un canvas sin lista explícita) y el servicio arma la
// lista completa dentro de su cola — lo cubre la prueba integrada
// `useModelerStore.membership.integration.test.ts`.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/modeler/services/structure.service', () => ({
  addToCanvas: vi.fn(),
  removeFromCanvas: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/views.service', () => ({ listViewsForTables: vi.fn() }));

import * as struct from '@/features/modeler/services/structure.service';
import * as mod from '@/features/modeler/services/modeler.service';
import * as viewsSvc from '@/services/views.service';
import { gridSlot } from '@/features/modeler/lib/viewerLayout';
import { defaultViewPosition } from '@/features/modeler/lib/viewGraph';
import { useModelerStore } from './useModelerStore';
import { useUndoStore } from './useUndoStore';

const SA = { id: 'sa1', projectId: 'p', name: 's', tableIds: ['t1', 't2'], viewIds: ['v1'], layout: {} };
const DIAGRAM = {
  subjectArea: SA,
  tables: [
    { id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente' },
    { id: 't2', physicalName: 'M_CUENTA', logicalName: 'Cuenta' },
  ],
  columns: [],
  relationships: [],
  views: [
    { id: 'v1', name: 'M_CLIENTE', sourceTableIds: ['t1'] },
    { id: 'v2', name: 'MIX', sourceTableIds: ['t1', 't2'] },
  ],
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(mod.loadDiagram).mockResolvedValue(JSON.parse(JSON.stringify(DIAGRAM)));
  vi.mocked(struct.addToCanvas).mockResolvedValue({ tableIds: [], viewIds: [] });
  // Lo que salió (doc 105) y su color en el canvas (doc 112): el Undo lo repone.
  vi.mocked(struct.removeFromCanvas).mockResolvedValue({ tableIds: [], viewIds: [], layout: {}, colors: { v1: '#92D050' } });
  useModelerStore.setState({ activeSaId: 'sa1', flow: null, diagram: JSON.parse(JSON.stringify(DIAGRAM)), selectedViewId: null, dirty: false });
  useUndoStore.setState({ stack: [], busy: false });
});

describe('useModelerStore — vistas como miembros del canvas (doc 70)', () => {
  it('addExistingTables SIN opción: la tabla entra sola y la membresía de vistas se conserva', async () => {
    await useModelerStore.getState().addExistingTables(['t3']);
    // Revisión doc 114: sin canvas medible la importada entra sin posición — entonces no se fija nada.
    expect(struct.addToCanvas).toHaveBeenCalledWith('sa1', { tableIds: ['t3'], viewIds: [] }, ['v1']);
    expect(viewsSvc.listViewsForTables).not.toHaveBeenCalled();
    expect(useModelerStore.getState().dirty).toBe(true);
  });

  it('addExistingTables con withViews suma las vistas de la tabla y el Undo retira SÓLO lo que entró', async () => {
    vi.mocked(viewsSvc.listViewsForTables).mockResolvedValue([
      { id: 'v9', name: 'T3_VU', sourceTableIds: ['t3'] },
      { id: 'v1', name: 'dup', sourceTableIds: ['t1', 't3'] },   // ya miembro → el servicio no la duplica
    ]);
    vi.mocked(struct.addToCanvas).mockResolvedValueOnce({ tableIds: ['t3'], viewIds: ['v9'] });
    await useModelerStore.getState().addExistingTables(['t3'], { withViews: true });
    expect(viewsSvc.listViewsForTables).toHaveBeenCalledWith(['t3']);
    expect(struct.addToCanvas).toHaveBeenCalledWith('sa1', { tableIds: ['t3'], viewIds: ['v9', 'v1'] }, ['v1']);

    const label = await useUndoStore.getState().undoLast();
    expect(label).toBe('Add 1 table + 1 view to canvas');
    expect(struct.removeFromCanvas).toHaveBeenCalledWith('sa1', { tableIds: ['t3'], viewIds: ['v9'] }, ['v1']);
  });

  it('addExistingTables sin nada nuevo no apila Undo', async () => {
    await useModelerStore.getState().addExistingTables(['t1']);
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it('addViewsToCanvas: es no-op si ya eran miembros y el Undo retira las que entraron', async () => {
    await useModelerStore.getState().addViewsToCanvas(['v1']);
    expect(struct.addToCanvas).not.toHaveBeenCalled();
    vi.mocked(struct.addToCanvas).mockResolvedValueOnce({ tableIds: [], viewIds: ['v2'] });
    await useModelerStore.getState().addViewsToCanvas(['v1', 'v2']);
    expect(struct.addToCanvas).toHaveBeenCalledWith('sa1', { viewIds: ['v1', 'v2'] }, ['v1']);
    const label = await useUndoStore.getState().undoLast();
    expect(label).toBe('Add 1 view to canvas');
    expect(struct.removeFromCanvas).toHaveBeenLastCalledWith('sa1', { viewIds: ['v2'] }, ['v1']);
  });

  it('removeViewFromCanvas: quita membresía, cierra su panel y el Undo la devuelve', async () => {
    useModelerStore.setState({ selectedViewId: 'v1' });
    await useModelerStore.getState().removeViewFromCanvas('v1');
    expect(struct.removeFromCanvas).toHaveBeenCalledWith('sa1', { viewIds: ['v1'] }, ['v1']);
    expect(useModelerStore.getState().selectedViewId).toBeNull();
    const label = await useUndoStore.getState().undoLast();
    expect(label).toBe('Remove M_CLIENTE from canvas');
    expect(struct.addToCanvas).toHaveBeenCalledWith('sa1', { viewIds: ['v1'], colors: { v1: '#92D050' } }, ['v1']);
  });

  it('removeTableFromArea poda las vistas que quedan sin fuente y el Undo las restaura', async () => {
    // quitar t1: v1 (sólo t1) queda huérfana; v2 sobrevive por t2
    useModelerStore.setState({ diagram: { ...JSON.parse(JSON.stringify(DIAGRAM)), subjectArea: { ...SA, viewIds: ['v1', 'v2'] } } as never });
    await useModelerStore.getState().removeTableFromArea('t1');
    // Revisión doc 114: t2 (sin posición) queda donde se ve y v2, que se re-anclaría a t2, también.
    expect(struct.removeFromCanvas).toHaveBeenCalledWith('sa1', {
      tableIds: ['t1'], viewIds: ['v1'], pins: { t2: gridSlot(1), v2: defaultViewPosition(gridSlot(0)) },
    }, ['v1', 'v2']);
    await useUndoStore.getState().undoLast();
    // la lista de vistas es la de ESTE canvas al sacar la tabla (no la del diagrama al deshacer)
    expect(struct.addToCanvas).toHaveBeenCalledWith('sa1', { tableIds: ['t1'], viewIds: ['v1'], layout: {}, routes: {}, colors: { v1: '#92D050' } }, ['v1', 'v2']);
  });

  it('removeTableFromArea sin huérfanas no toca la membresía de vistas', async () => {
    await useModelerStore.getState().removeTableFromArea('t2');   // v2 sobrevive por t1
    expect(struct.removeFromCanvas).toHaveBeenCalledWith('sa1', { tableIds: ['t2'], viewIds: [], pins: { t1: gridSlot(0) } }, ['v1']);
  });
});
