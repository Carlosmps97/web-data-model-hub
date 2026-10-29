// Mover canvases y carpetas desde el Explorer (doc 134 §4.3): el store valida con
// las reglas de `explorerMove` antes de grabar — nunca dentro de sí misma, nada si
// ya está ahí, nunca junto a un homónimo — y relee el árbol del proyecto. Borrar
// una carpeta va por su cascada (`deleteFolderTree`).
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../features/modeler/services/structure.service', () => ({
  listProjects: vi.fn(async () => []),
  listFolders: vi.fn(async () => []),
  listSubjectAreas: vi.fn(async () => []),
  projectDeletionPending: vi.fn(async () => false),
  moveFolder: vi.fn(async () => ({})),
  updateSubjectArea: vi.fn(async () => ({})),
  deleteFolderTree: vi.fn(async () => ({ folders: [], canvases: [] })),
}));
vi.mock('../features/modeler/services/schemas.service', () => ({ listSchemas: vi.fn(async () => []) }));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));

import * as struct from '../features/modeler/services/structure.service';
import type { Folder, SubjectArea } from '../features/modeler/services/modeler.service';
import { useSessionStore } from './useSessionStore';
import { useModelerStore } from './useModelerStore';

const folder = (id: string, name: string, parentFolderId: string | null = null): Folder => ({ id, projectId: 'p1', parentFolderId, name, order: 0 });
const canvas = (id: string, name: string, folderId: string | null = null): SubjectArea =>
  ({ id, projectId: 'p1', name, folderId, tableIds: [], layout: {} });
const FOLDERS = [folder('F1', 'Riesgos'), folder('F2', 'Dominio', 'F1'), folder('F3', 'Modelo', 'F2'), folder('F4', 'Ventas')];
const CANVASES = [canvas('C1', 'Clientes', 'F1'), canvas('C2', 'clientes')];
const st = () => useModelerStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useModelerStore.setState({
    activeProjectId: 'p1', activeSaId: null, diagram: null,
    trees: { p1: { folders: FOLDERS, subjectAreas: CANVASES } }, folders: FOLDERS, subjectAreas: CANVASES,
  });
  vi.mocked(struct.listFolders).mockResolvedValue(FOLDERS);
  vi.mocked(struct.listSubjectAreas).mockResolvedValue(CANVASES);
});

describe('moveCanvas / moveFolder', () => {
  it('un canvas junto a un homónimo no se mueve y dice por qué', async () => {
    await expect(st().moveCanvas('C2', 'F1', 'p1')).rejects.toThrow('A canvas named “clientes” already exists in “Riesgos”');
    expect(struct.updateSubjectArea).not.toHaveBeenCalled();
  });

  it('una carpeta dentro de una subcarpeta suya no se mueve', async () => {
    await expect(st().moveFolder('F1', 'F3', 'p1')).rejects.toThrow("A folder can't be moved inside itself");
    expect(struct.moveFolder).not.toHaveBeenCalled();
  });

  it('a su carpeta actual no graba nada', async () => {
    await expect(st().moveFolder('F2', 'F1', 'p1')).resolves.toBe(false);
    await expect(st().moveCanvas('C1', 'F1', 'p1')).resolves.toBe(false);
    expect(struct.moveFolder).not.toHaveBeenCalled();
    expect(struct.updateSubjectArea).not.toHaveBeenCalled();
    expect(struct.listFolders).not.toHaveBeenCalled();
  });

  it('lo válido se graba con el documento del canvas o de la carpeta y relee el árbol', async () => {
    await expect(st().moveFolder('F2', 'F4', 'p1')).resolves.toBe(true);
    expect(struct.moveFolder).toHaveBeenCalledWith('F2', 'F4');
    await st().moveCanvas('C1', 'F4', 'p1');
    expect(struct.updateSubjectArea).toHaveBeenCalledWith('C1', { projectId: 'p1', folderId: 'F4' });
    expect(struct.listFolders).toHaveBeenCalledWith('p1');
  });
});

describe('deleteFolder', () => {
  it('borra con su cascada y relee el árbol', async () => {
    await st().deleteFolder('F1', 'p1');
    expect(struct.deleteFolderTree).toHaveBeenCalledWith('F1', 'p1');
    expect(struct.listSubjectAreas).toHaveBeenCalledWith('p1');
  });
});
