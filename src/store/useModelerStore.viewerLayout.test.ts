import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/modeler/services/modeler.service', () => ({}));
vi.mock('@/features/modeler/services/structure.service', () => ({
  setSubjectAreaLayout: vi.fn(async () => ({})),
  arrangeSubjectArea: vi.fn(async () => ({})),
}));
vi.mock('@/features/modeler/lib/arrangeGraph', () => ({
  arrangeDiagram: vi.fn(async () => ({ t1: { x: 10, y: 20 }, t2: { x: 30, y: 40 } })),
}));

import * as struct from '@/features/modeler/services/structure.service';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';

const diagram = {
  subjectArea: { id: 'sa1', name: 'Canvas', layout: { t1: { x: 0, y: 0 } } },
  tables: [{ id: 't1' }, { id: 't2' }], columns: [], relationships: [], views: [],
} as never;

// Doc 84 E: en modo visor mover/auto-arreglar vive SOLO en la sesión.
describe('useModelerStore — layout efímero del visor (doc 84 E)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModelerStore.setState({
      activeSaId: 'sa1', diagram, dirty: false, viewerLayout: {}, viewerHintShown: false,
      flow: { getNodes: () => [], setNodes: vi.fn() } as never,
    });
  });

  it('setViewerPos acumula posiciones por canvas sin tocar el backend', () => {
    const st = useModelerStore.getState();
    st.setViewerPos('sa1', 't1', { x: 5, y: 6 });
    st.setViewerPos('sa1', 't2', { x: 7, y: 8 });
    st.setViewerPos('sa2', 't1', { x: 1, y: 1 });
    expect(useModelerStore.getState().viewerLayout).toEqual({
      sa1: { t1: { x: 5, y: 6 }, t2: { x: 7, y: 8 } },
      sa2: { t1: { x: 1, y: 1 } },
    });
    expect(struct.setSubjectAreaLayout).not.toHaveBeenCalled();
    expect(useModelerStore.getState().dirty).toBe(false);
  });

  it('autoOrganize en modo visor aplica a los nodos vivos y recuerda, pero NO persiste', async () => {
    useSessionStore.setState({ openMode: 'readonly' });
    useModelerStore.setState({ diagram });   // Doc 105 (R7-A): cambiar de sesión limpia el canvas — se carga DENTRO de ella.
    await useModelerStore.getState().autoOrganize();
    const st = useModelerStore.getState();
    expect(st.viewerLayout.sa1).toEqual({ t1: { x: 10, y: 20 }, t2: { x: 30, y: 40 } });
    expect(struct.setSubjectAreaLayout).not.toHaveBeenCalled();
    expect(struct.arrangeSubjectArea).not.toHaveBeenCalled();
    expect(st.dirty).toBe(false);
    expect((st.flow as unknown as { setNodes: ReturnType<typeof vi.fn> }).setNodes).toHaveBeenCalledTimes(1);
  });

  it('autoOrganize en edición sigue persistiendo el layout', async () => {
    useSessionStore.setState({ openMode: 'editing' });
    useModelerStore.setState({ diagram });   // Doc 105 (R7-A): cambiar de sesión limpia el canvas — se carga DENTRO de ella.
    useModelerStore.setState({ reload: vi.fn(async () => undefined) } as never);
    await useModelerStore.getState().autoOrganize();
    // Doc 99: las posiciones se graban con `arrangeSubjectArea`, que en la
    // MISMA escritura reinicia los trazos manuales de los wires.
    expect(struct.arrangeSubjectArea).toHaveBeenCalledWith('sa1', { t1: { x: 10, y: 20 }, t2: { x: 30, y: 40 } });
    expect(useModelerStore.getState().viewerLayout).toEqual({});
  });
});
