// Mover en el Explorer, en fila (doc 134 §4.3): cada movimiento decide con el árbol
// que dejó el anterior, así dos arrastres seguidos (A dentro de B y enseguida B
// dentro de A) no arman un ciclo. Mover el canvas abierto actualiza su carpeta en
// el diagrama (la búsqueda ⌘K arranca acotada a ella).
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../features/modeler/services/structure.service', () => ({
  listProjects: vi.fn(async () => []),
  listFolders: vi.fn(async () => []),
  listSubjectAreas: vi.fn(async () => []),
  projectDeletionPending: vi.fn(async () => false),
  moveFolder: vi.fn(async () => ({})),
  updateSubjectArea: vi.fn(async () => ({})),
}));
vi.mock('../features/modeler/services/schemas.service', () => ({ listSchemas: vi.fn(async () => []) }));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));

import * as struct from '../features/modeler/services/structure.service';
import type { Folder, SubjectArea } from '../features/modeler/services/modeler.service';
import { useSessionStore } from './useSessionStore';
import { useModelerStore } from './useModelerStore';

const tick = () => new Promise<void>((r) => setTimeout(r, 5));
let folders: Folder[];
const canvases: SubjectArea[] = [{ id: 'C1', projectId: 'p1', name: 'Uno', folderId: 'A', tableIds: [], layout: {} }];
const st = () => useModelerStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  folders = [{ id: 'A', projectId: 'p1', parentFolderId: null, name: 'A', order: 0 }, { id: 'B', projectId: 'p1', parentFolderId: null, name: 'B', order: 0 }];
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useModelerStore.setState({ activeProjectId: 'p1', activeSaId: null, diagram: null, trees: { p1: { folders, subjectAreas: canvases } } });
  vi.mocked(struct.moveFolder).mockImplementation(async (id, parentFolderId) => {
    await tick();
    folders = folders.map((f) => (f.id === id ? { ...f, parentFolderId } : f));
    return {} as never;
  });
  vi.mocked(struct.listFolders).mockImplementation(async () => { await tick(); return folders; });
  vi.mocked(struct.listSubjectAreas).mockImplementation(async () => canvases);
});

describe('movimientos en fila', () => {
  it('A dentro de B y enseguida B dentro de A: el segundo ve el primero y no arma un ciclo', async () => {
    const [first, second] = await Promise.allSettled([st().moveFolder('A', 'B', 'p1'), st().moveFolder('B', 'A', 'p1')]);
    expect(first.status).toBe('fulfilled');
    expect(second).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: "A folder can't be moved inside itself" }) });
    expect(struct.moveFolder).toHaveBeenCalledTimes(1);
  });

  it('mover el canvas abierto actualiza su carpeta en el diagrama', async () => {
    useModelerStore.setState({ activeSaId: 'C1', diagram: { subjectArea: { ...canvases[0] }, tables: [], columns: [], relationships: [], views: [] } as never });
    await st().moveCanvas('C1', 'B', 'p1');
    expect(st().diagram?.subjectArea.folderId).toBe('B');
    expect(struct.updateSubjectArea).toHaveBeenCalledWith('C1', { projectId: 'p1', folderId: 'B' });
  });

  it('renombrar manda solo el nombre (no pisa una carpeta cambiada en otra pestaña)', async () => {
    await st().renameCanvas('C1', 'Nuevo', 'p1');
    expect(struct.updateSubjectArea).toHaveBeenCalledWith('C1', { projectId: 'p1', name: 'Nuevo' });
  });
});
