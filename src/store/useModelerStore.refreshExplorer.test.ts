// `refreshExplorer`:
//  · solo el refresco más reciente escribe: la respuesta tardía de un refresco
//    anterior (otra sesión: se abrió otra versión o proyecto mientras cargaba)
//    no pisa proyectos, proyecto activo ni árbol;
//  · los fallos de esquemas y de la recarga del canvas se avisan, con el
//    criterio de sesión (sessionGuard): calla si la sesión dejó de ser la
//    pedida.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../features/modeler/services/structure.service', () => ({
  listProjects: vi.fn(),
  listFolders: vi.fn(),
  listSubjectAreas: vi.fn(),
  projectDeletionPending: vi.fn(async () => false),
}));
vi.mock('../features/modeler/services/schemas.service', () => ({ listSchemas: vi.fn(async () => []) }));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));

import { toast } from 'sonner';
import * as struct from '../features/modeler/services/structure.service';
import * as schemasSvc from '../features/modeler/services/schemas.service';
import * as mod from '../features/modeler/services/modeler.service';
import { trackRevalidation } from '../features/modeler/lib/sessionGuard';
import { ApiError } from '@/services/http';
import { useSessionStore } from './useSessionStore';
import { useModelerStore } from './useModelerStore';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const P1 = { id: 'p1', name: 'Uno' };
const P2 = { id: 'p2', name: 'Dos' };
const SA1 = { id: 'sa1', projectId: 'p1', name: 'Canvas 1', folderId: null, tableIds: [], layout: {} };
const SA2 = { id: 'sa2', projectId: 'p2', name: 'Canvas 2', folderId: null, tableIds: [], layout: {} };
const F1 = { id: 'f1', projectId: 'p1', parentFolderId: null, name: 'Carpeta 1', order: 0 };
const dia = (sa: typeof SA1) => ({ subjectArea: sa, tables: [], columns: [], relationships: [], views: [] }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(struct.listProjects).mockResolvedValue([P1, P2] as never);
  vi.mocked(struct.listFolders).mockResolvedValue([] as never);
  vi.mocked(struct.listSubjectAreas).mockImplementation(async (pid: string) => (pid === 'p1' ? [SA1] : [SA2]) as never);
  vi.mocked(schemasSvc.listSchemas).mockResolvedValue([] as never);
  vi.mocked(mod.loadDiagram).mockImplementation(async (saId: string) => dia(saId === 'sa1' ? SA1 : SA2));
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useModelerStore.setState({
    projects: [], activeProjectId: 'p1', activeSaId: 'sa1', diagram: dia(SA1), trees: {}, folders: [],
    subjectAreas: [SA1 as never], schemas: [], dirty: false, projectDeletionPending: false,
  });
});
afterEach(async () => { await sleep(10); });

describe('refreshExplorer — solo el refresco más reciente escribe', () => {
  it('la lista de proyectos tardía de la sesión anterior no pisa la de la sesión nueva', async () => {
    const late = deferred<unknown>();
    vi.mocked(struct.listProjects).mockImplementationOnce(() => late.promise as never);   // sesión 1 (cs1)
    const first = useModelerStore.getState().refreshExplorer();
    // El usuario abre otro proyecto (otra versión) antes de que llegue la respuesta.
    useSessionStore.getState().openModel({ projectId: 'p2', mode: 'editing', changesetId: 'cs2' });
    vi.mocked(struct.listProjects).mockResolvedValueOnce([P2] as never);                  // sesión 2 (cs2)
    await useModelerStore.getState().refreshExplorer();
    expect(useModelerStore.getState().activeProjectId).toBe('p2');
    late.resolve([P1, P2]);                                                              // llega la respuesta anterior
    await first;
    const s = useModelerStore.getState();
    expect(s.projects.map((p) => p.id)).toEqual(['p2']);
    expect(s.activeProjectId).toBe('p2');
    expect(s.subjectAreas.map((x) => x.id)).toEqual(['sa2']);
  });

  it('el árbol tardío de la sesión anterior (misma versión, otro modo) no pisa el vigente', async () => {
    const late = deferred<unknown>();
    vi.mocked(struct.listFolders).mockImplementationOnce(() => late.promise as never);    // editando cs1
    const first = useModelerStore.getState().refreshExplorer();
    await sleep(5);
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly', changesetId: 'cs1' });
    vi.mocked(struct.listFolders).mockResolvedValueOnce([F1] as never);
    await useModelerStore.getState().refreshExplorer();
    expect(useModelerStore.getState().folders.map((f) => f.id)).toEqual(['f1']);
    late.resolve([]);
    await first;
    expect(useModelerStore.getState().folders.map((f) => f.id)).toEqual(['f1']);
    expect(useModelerStore.getState().trees.p1?.folders.map((f) => f.id)).toEqual(['f1']);
  });

  it('los esquemas tardíos de la sesión anterior no pisan los vigentes', async () => {
    const late = deferred<unknown>();
    vi.mocked(schemasSvc.listSchemas).mockImplementationOnce(() => late.promise as never);
    const first = useModelerStore.getState().refreshExplorer();
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly' });
    vi.mocked(schemasSvc.listSchemas).mockResolvedValueOnce([{ id: 's-prod', name: 'prod' }] as never);
    await useModelerStore.getState().refreshExplorer();
    late.resolve([{ id: 's-draft', name: 'draft' }]);
    await first;
    await sleep(5);
    expect(useModelerStore.getState().schemas.map((s) => s.id)).toEqual(['s-prod']);
  });
});

describe('refreshExplorer — fallos que se avisan', () => {
  it('la recarga del canvas falla con la sesión igual: se cierra el canvas y se dice por qué', async () => {
    vi.mocked(mod.loadDiagram).mockRejectedValueOnce(new ApiError('Server error', 500, null, '/api/subject-areas/sa1/diagram'));
    await useModelerStore.getState().refreshExplorer();
    expect(useModelerStore.getState().activeSaId).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Couldn't reload the canvas.*Server error/), expect.anything());
  });

  it('la recarga del canvas falla por la versión y la revalidación cambia la sesión: calla', async () => {
    vi.mocked(mod.loadDiagram).mockImplementationOnce(async () => {
      trackRevalidation(new Promise<void>((res) => setTimeout(() => {
        useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly' }); res();
      }, 10)));
      throw new ApiError('Forbidden', 403, null, '/api/changesets/cs1/effective/subject_areas');
    });
    await useModelerStore.getState().refreshExplorer();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('los esquemas fallan con la sesión igual: se avisa con el motivo', async () => {
    vi.mocked(schemasSvc.listSchemas).mockRejectedValueOnce(new ApiError('Gateway timeout', 504, null, '/api/changesets/cs1/effective/schemas'));
    await useModelerStore.getState().refreshExplorer();
    await sleep(5);
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Couldn't load the schemas.*Gateway timeout/), expect.anything());
  });

  it('los esquemas de una sesión que el usuario ya dejó fallan: calla', async () => {
    const late = deferred<unknown>();
    vi.mocked(schemasSvc.listSchemas).mockImplementationOnce(() => late.promise.then(() => {
      throw new ApiError('Gateway timeout', 504, null, '/api/changesets/cs1/effective/schemas');
    }) as never);
    const first = useModelerStore.getState().refreshExplorer();
    useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly' });
    await useModelerStore.getState().refreshExplorer();
    late.resolve(undefined);
    await first;
    await sleep(5);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
