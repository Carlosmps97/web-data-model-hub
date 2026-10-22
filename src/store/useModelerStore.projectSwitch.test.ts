import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Cambio de proyecto con un canvas abierto: al pasar la sesión de A a B,
 * `refreshExplorer()` debe dejar el workspace en B (proyecto activo, árbol,
 * esquemas) y soltar el canvas de A (que no existe en B). El disparo lo hace
 * `WorkspaceScreen` por la clave de sesión (`canvasSessionKey`, que incluye el
 * proyecto).
 */
vi.mock('@/features/modeler/services/structure.service', () => ({
  listProjects: vi.fn(),
  listFolders: vi.fn(),
  listSubjectAreas: vi.fn(),
  projectDeletionPending: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/features/modeler/services/schemas.service', () => ({
  listSchemas: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/features/modeler/services/modeler.service', () => ({
  loadDiagram: vi.fn(),
}));

import * as struct from '@/features/modeler/services/structure.service';
import { useSessionStore } from '@/store/useSessionStore';
import { useModelerStore } from './useModelerStore';

const PROJECTS = [{ id: 'A', name: 'Modelo Ventas' }, { id: 'B', name: 'VENTAS FISICO' }];
const SA_A = { id: 'sa-a', projectId: 'A', name: 'Canvas A', folderId: null, tableIds: [], layout: {} };
const SA_B = { id: 'sa-b', projectId: 'B', name: 'Canvas B', folderId: null, tableIds: [], layout: {} };

describe('useModelerStore.refreshExplorer — cambio de proyecto en la misma sesión', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(struct.listProjects).mockResolvedValue(PROJECTS as never);
    vi.mocked(struct.listFolders).mockResolvedValue([] as never);
    vi.mocked(struct.listSubjectAreas).mockImplementation(async (pid: string) =>
      (pid === 'A' ? [SA_A] : [SA_B]) as never);
    // Estado previo: proyecto A abierto en solo lectura con su canvas activo.
    useSessionStore.setState({ openMode: 'readonly', activeChangesetId: null, activeProjectId: 'A', activeVersionLabel: 'v3' });
    useModelerStore.setState({
      projects: PROJECTS as never, activeProjectId: 'A', activeSaId: 'sa-a',
      diagram: { subjectArea: SA_A, tables: [], columns: [], relationships: [], views: [] } as never,
      trees: { A: { folders: [], subjectAreas: [SA_A as never] } }, subjectAreas: [SA_A as never],
      selectedTableId: 't1', dirty: false, projectDeletionPending: false,
    });
  });

  it('readonly A → readonly B: el workspace queda en B y suelta el canvas de A', async () => {
    useSessionStore.getState().openModel({ projectId: 'B', mode: 'readonly', versionLabel: 'v1' });
    await useModelerStore.getState().refreshExplorer();
    const s = useModelerStore.getState();
    expect(s.activeProjectId).toBe('B');
    expect(Object.keys(s.trees)).toEqual(['B']);                 // el árbol de A se purga
    expect(s.subjectAreas.map((x) => x.id)).toEqual(['sa-b']);
    expect(s.activeSaId).toBeNull();                              // el canvas de A no existe en B
    expect(s.diagram).toBeNull();
    expect(s.selectedTableId).toBeNull();
  });

  it('reabrir el mismo proyecto conserva el canvas y lo recarga', async () => {
    const mod = await import('@/features/modeler/services/modeler.service');
    vi.mocked(mod.loadDiagram).mockResolvedValue({
      subjectArea: SA_A, tables: [], columns: [], relationships: [], views: [],
    } as never);
    useSessionStore.getState().openModel({ projectId: 'A', mode: 'readonly', versionLabel: 'v3' });
    await useModelerStore.getState().refreshExplorer();
    const s = useModelerStore.getState();
    expect(s.activeProjectId).toBe('A');
    expect(s.activeSaId).toBe('sa-a');
    expect(mod.loadDiagram).toHaveBeenCalledWith('sa-a');
  });
});
