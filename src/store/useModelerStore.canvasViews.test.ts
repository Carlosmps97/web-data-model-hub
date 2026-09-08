// Doc 70 §2.3: membresía de vistas en el canvas desde el store — importar una
// tabla NO arrastra sus vistas (salvo withViews), add/remove de vistas con
// Undo, y poda de vistas huérfanas al quitar una tabla. Servicios mockeados.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/modeler/services/structure.service', () => ({
  getSubjectArea: vi.fn(),
  setSubjectAreaMembers: vi.fn().mockResolvedValue({}),
  setSubjectAreaViews: vi.fn().mockResolvedValue({}),
  setSubjectAreaTables: vi.fn().mockResolvedValue({}),
  setSubjectAreaLayout: vi.fn().mockResolvedValue({}),
  removeTableFromCanvas: vi.fn().mockResolvedValue(undefined),
  removeViewFromCanvas: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/views.service', () => ({ listViewsForTables: vi.fn() }));

import * as struct from '@/features/modeler/services/structure.service';
import * as mod from '@/features/modeler/services/modeler.service';
import * as viewsSvc from '@/services/views.service';
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
  vi.mocked(struct.getSubjectArea).mockResolvedValue({ id: 'sa1', projectId: 'p', name: 's', tableIds: ['t1', 't2'], viewIds: null, layout: {} });
  useModelerStore.setState({ activeSaId: 'sa1', flow: null, diagram: JSON.parse(JSON.stringify(DIAGRAM)), selectedViewId: null, dirty: false });
  useUndoStore.setState({ stack: [], busy: false });
});

describe('useModelerStore — vistas como miembros del canvas (doc 70)', () => {
  it('addExistingTables SIN opción: la tabla entra sola y la membresía de vistas se conserva', async () => {
    await useModelerStore.getState().addExistingTables(['t3']);
    expect(struct.setSubjectAreaMembers).toHaveBeenCalledWith('sa1', { tableIds: ['t1', 't2', 't3'], viewIds: ['v1'] });
    expect(viewsSvc.listViewsForTables).not.toHaveBeenCalled();
    expect(useModelerStore.getState().dirty).toBe(true);
  });

  it('addExistingTables con withViews suma las vistas de la tabla y el Undo las retira', async () => {
    vi.mocked(viewsSvc.listViewsForTables).mockResolvedValue([
      { id: 'v9', name: 'T3_VU', sourceTableIds: ['t3'] },
      { id: 'v1', name: 'dup', sourceTableIds: ['t1', 't3'] },   // ya miembro → no se duplica
    ]);
    await useModelerStore.getState().addExistingTables(['t3'], { withViews: true });
    expect(viewsSvc.listViewsForTables).toHaveBeenCalledWith(['t3']);
    expect(struct.setSubjectAreaMembers).toHaveBeenCalledWith('sa1', { tableIds: ['t1', 't2', 't3'], viewIds: ['v1', 'v9'] });

    const label = await useUndoStore.getState().undoLast();
    expect(label).toBe('Add 1 table + 1 view to canvas');
    expect(struct.removeTableFromCanvas).toHaveBeenCalledWith('sa1', 't3');
    expect(struct.setSubjectAreaMembers).toHaveBeenLastCalledWith('sa1', { viewIds: ['v1'] });
  });

  it('addViewsToCanvas: une sin duplicar y es no-op si ya eran miembros', async () => {
    await useModelerStore.getState().addViewsToCanvas(['v1']);
    expect(struct.setSubjectAreaViews).not.toHaveBeenCalled();
    await useModelerStore.getState().addViewsToCanvas(['v1', 'v2']);
    expect(struct.setSubjectAreaViews).toHaveBeenCalledWith('sa1', ['v1', 'v2']);
    const label = await useUndoStore.getState().undoLast();
    expect(label).toBe('Add 1 view to canvas');
    expect(struct.setSubjectAreaViews).toHaveBeenLastCalledWith('sa1', ['v1']);
  });

  it('removeViewFromCanvas: quita membresía, cierra su panel y el Undo la devuelve', async () => {
    useModelerStore.setState({ selectedViewId: 'v1' });
    await useModelerStore.getState().removeViewFromCanvas('v1');
    expect(struct.removeViewFromCanvas).toHaveBeenCalledWith('sa1', 'v1', []);
    expect(useModelerStore.getState().selectedViewId).toBeNull();
    // el diagrama recargado (mock) sigue trayendo v1: el Undo re-une sin duplicar
    const label = await useUndoStore.getState().undoLast();
    expect(label).toBe('Remove M_CLIENTE from canvas');
    expect(struct.setSubjectAreaViews).toHaveBeenCalledWith('sa1', ['v1']);
  });

  it('removeTableFromArea poda las vistas que quedan sin fuente y el Undo las restaura', async () => {
    // quitar t1: v1 (sólo t1) queda huérfana; v2 sobrevive por t2
    useModelerStore.setState({ diagram: { ...JSON.parse(JSON.stringify(DIAGRAM)), subjectArea: { ...SA, viewIds: ['v1', 'v2'] } } as never });
    await useModelerStore.getState().removeTableFromArea('t1');
    expect(struct.removeTableFromCanvas).toHaveBeenCalledWith('sa1', 't1', ['v2']);
    // tras el remove, el canvas efectivo ya no tiene t1: el Undo la devuelve
    vi.mocked(struct.getSubjectArea).mockResolvedValue({ id: 'sa1', projectId: 'p', name: 's', tableIds: ['t2'], viewIds: ['v2'], layout: {} });
    await useUndoStore.getState().undoLast();
    expect(struct.setSubjectAreaTables).toHaveBeenCalledWith('sa1', ['t2', 't1']);
    expect(struct.setSubjectAreaViews).toHaveBeenCalledWith('sa1', ['v1', 'v2']);
  });

  it('removeTableFromArea sin huérfanas no toca la membresía de vistas', async () => {
    await useModelerStore.getState().removeTableFromArea('t2');   // v2 sobrevive por t1
    expect(struct.removeTableFromCanvas).toHaveBeenCalledWith('sa1', 't2', undefined);
  });
});
