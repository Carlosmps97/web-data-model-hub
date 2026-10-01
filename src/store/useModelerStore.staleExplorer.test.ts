// Doc 105 (H4, A4-o2 incompleto) — respuestas TARDÍAS de la sesión anterior
// (se abrió otra versión, modo o proyecto mientras cargaban) no pisan la
// actual. `_explorerSeq` cubría proyectos, árbol y esquemas; quedaban:
//  (a) la recarga del canvas del refresco viejo: sólo miraba `_loadSeq`, que el
//      refresco nuevo no sube si el canvas no existe en la sesión nueva — el
//      canvas del draft quedaba abierto, con su diagrama, en producción;
//  (b) el árbol que relee una mutación del Explorer (renombrar, crear, borrar,
//      mover): sin `isCurrent`, el árbol del draft pisaba el de producción.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../features/modeler/services/structure.service', () => ({
  listProjects: vi.fn(),
  listFolders: vi.fn(),
  listSubjectAreas: vi.fn(),
  projectDeletionPending: vi.fn(async () => false),
  renameFolder: vi.fn(async () => ({})),
  createSubjectArea: vi.fn(async () => ({ id: 'saNuevo' })),
}));
vi.mock('../features/modeler/services/schemas.service', () => ({ listSchemas: vi.fn(async () => []) }));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));

import * as struct from '../features/modeler/services/structure.service';
import { trackRevalidation } from '../features/modeler/lib/sessionGuard';
import { ApiError } from '@/services/http';
import * as mod from '../features/modeler/services/modeler.service';
import { useSessionStore } from './useSessionStore';
import { useModelerStore } from './useModelerStore';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
const st = () => useModelerStore.getState();
/** La revalidación degrada la sesión a producción (la versión se transfirió). */
const toProduction = () => useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly' });

const P1 = { id: 'p1', name: 'Uno' };
// Canvas que SÓLO existe en el draft cs1 (creado en esa versión).
const SA_DRAFT = { id: 'saD', projectId: 'p1', name: 'Solo en el draft', folderId: null, tableIds: ['tD'], layout: {} };
const SA_PROD = { id: 'saP', projectId: 'p1', name: 'Publicado', folderId: null, tableIds: ['tP'], layout: {} };
const dia = (sa: { id: string }, tag: string) =>
  ({ subjectArea: sa, tables: [{ id: 'tD', physicalName: tag }], columns: [], relationships: [], views: [] }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(struct.listProjects).mockResolvedValue([P1] as never);
  vi.mocked(struct.listFolders).mockResolvedValue([] as never);
  // Editando cs1 existe el canvas del draft; en producción (sin versión), el publicado.
  vi.mocked(struct.listSubjectAreas).mockImplementation(async () =>
    (useSessionStore.getState().activeChangesetId === 'cs1' ? [SA_DRAFT, SA_PROD] : [SA_PROD]) as never);
  vi.mocked(mod.loadDiagram).mockImplementation(async (saId: string) => dia({ id: saId }, `DIAGRAMA_${saId}`));
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useModelerStore.setState({
    projects: [], activeProjectId: 'p1', activeSaId: 'saD', diagram: dia(SA_DRAFT, 'DRAFT_VIEJO'), trees: {},
    folders: [], subjectAreas: [SA_DRAFT as never], schemas: [], dirty: false, projectDeletionPending: false, openingSaId: null,
  });
});
afterEach(async () => { await sleep(10); });

describe('recarga del canvas de un refresco viejo (doc 105, H4a)', () => {
  it('el diagrama tardío de la sesión anterior NO re-abre un canvas que la sesión nueva ya cerró', async () => {
    const late = deferred<unknown>();
    vi.mocked(mod.loadDiagram).mockImplementationOnce(() => late.promise as never);   // R1 (cs1): queda en vuelo
    const r1 = st().refreshExplorer();
    await sleep(5);                               // R1 ya está en selectSubjectArea('saD')
    expect(mod.loadDiagram).toHaveBeenCalledTimes(1);
    toProduction();
    await st().refreshExplorer();                 // R2: en producción el canvas no existe
    expect(st().activeSaId).toBeNull();
    late.resolve(dia(SA_DRAFT, 'DRAFT_VIEJO'));   // llega el diagrama del DRAFT pedido por R1
    await r1;
    expect({ activeSaId: st().activeSaId, table: st().diagram?.tables[0]?.physicalName ?? null })
      .toEqual({ activeSaId: null, table: null });   // antes: { activeSaId: 'saD', table: 'DRAFT_VIEJO' }
  });

  it('tampoco un canvas que el usuario pidió en la sesión anterior (clic en el Explorer)', async () => {
    const late = deferred<unknown>();
    vi.mocked(mod.loadDiagram).mockImplementationOnce(() => late.promise as never);
    const click = st().selectSubjectArea('saD');  // editando cs1
    toProduction();
    await st().refreshExplorer();
    late.resolve(dia(SA_DRAFT, 'DRAFT_VIEJO'));
    await click;
    expect(st().activeSaId).toBeNull();
    expect(st().diagram).toBeNull();
  });

  it('un refresco nuevo apaga el spinner de una apertura que ya no le corresponde', async () => {
    const late = deferred<unknown>();
    vi.mocked(mod.loadDiagram).mockImplementationOnce(() => late.promise as never);
    const click = st().selectSubjectArea('saD');
    expect(st().openingSaId).toBe('saD');
    toProduction();
    const r2 = st().refreshExplorer();
    expect(st().openingSaId).toBeNull();
    await r2;
    late.resolve(dia(SA_DRAFT, 'DRAFT_VIEJO'));
    await click;
    expect(st().openingSaId).toBeNull();
  });

  it('la misma sesión: el canvas que sigue existiendo se recarga normal', async () => {
    await st().refreshExplorer();
    expect(st().activeSaId).toBe('saD');
    expect(st().diagram?.tables[0]?.physicalName).toBe('DIAGRAMA_saD');
  });
});

describe('árbol que relee una mutación del Explorer (doc 105, H4b)', () => {
  it('el árbol tardío de renombrar una carpeta (draft) no pisa el Explorer de la sesión nueva', async () => {
    const late = deferred<unknown>();
    // Editando cs1: renombrar carpeta → _refreshProject(p1) con su lectura en vuelo.
    vi.mocked(struct.listSubjectAreas).mockImplementationOnce(() => late.promise as never);
    const rename = st().renameFolder('f1', 'Nuevo', 'p1');
    await sleep(5);
    toProduction();
    await st().refreshExplorer();
    expect(st().subjectAreas.map((x) => x.id)).toEqual(['saP']);   // producción
    late.resolve([SA_DRAFT, SA_PROD]);                             // llega la del draft
    await rename;
    expect(st().subjectAreas.map((x) => x.id)).toEqual(['saP']);   // antes: ['saD', 'saP']
    expect(st().trees.p1.subjectAreas.map((x) => x.id)).toEqual(['saP']);
  });

  it('también si llega ANTES de que empiece el refresco de la sesión nueva', async () => {
    const late = deferred<unknown>();
    vi.mocked(struct.listSubjectAreas).mockImplementationOnce(() => late.promise as never);
    const rename = st().renameFolder('f1', 'Nuevo', 'p1');
    await sleep(5);
    toProduction();                                   // su refresco (efecto de WorkspaceScreen) aún no corre
    late.resolve([SA_DRAFT, SA_PROD]);
    await rename;
    expect(st().subjectAreas.map((x) => x.id)).toEqual(['saD']);   // sin tocar: lo arregla el refresco
    expect(st().trees).toEqual({});
  });

  it('crear un canvas: si la sesión cambió, no lo abre en la nueva (ahí no existe)', async () => {
    const late = deferred<unknown>();
    vi.mocked(struct.listSubjectAreas).mockImplementationOnce(() => late.promise as never);
    const create = st().createCanvas('p1', null, 'Nuevo');
    await sleep(5);
    toProduction();
    await st().refreshExplorer();
    late.resolve([SA_DRAFT, SA_PROD, { ...SA_DRAFT, id: 'saNuevo' }]);
    await create;
    expect(mod.loadDiagram).not.toHaveBeenCalledWith('saNuevo');
    expect(st().activeSaId).not.toBe('saNuevo');
    expect(st().subjectAreas.map((x) => x.id)).toEqual(['saP']);
  });

  it('la misma sesión: la mutación refresca el árbol como siempre', async () => {
    await st().renameFolder('f1', 'Nuevo', 'p1');
    expect(st().subjectAreas.map((x) => x.id)).toEqual(['saD', 'saP']);
  });
});

// Doc 105 (ronda 3, R7-C): tampoco las otras lecturas del árbol — expandir un
// proyecto (`loadProjectTree`), `selectProject`, `loadFolders` — escriben si
// llegan cuando la sesión ya es otra (o empezó un refresco más nuevo).
describe('otras lecturas del árbol (doc 105, R7-C)', () => {
  it('loadProjectTree tardío de la sesión anterior no pisa el árbol de la nueva', async () => {
    const late = deferred<unknown>();
    vi.mocked(struct.listSubjectAreas).mockImplementationOnce(() => late.promise as never);
    const expand = st().loadProjectTree('p1');                   // ModelExplorer.ensureProjectOpen (cs1)
    toProduction();
    await st().refreshExplorer();
    expect(st().trees.p1?.subjectAreas.map((s) => s.id)).toEqual(['saP']);
    late.resolve([SA_DRAFT, SA_PROD]);
    await expand;
    expect(st().trees.p1?.subjectAreas.map((s) => s.id)).toEqual(['saP']);   // antes: ['saD', 'saP']
  });

  it('selectProject tardío tampoco', async () => {
    const late = deferred<unknown>();
    vi.mocked(struct.listSubjectAreas).mockImplementationOnce(() => late.promise as never);
    const pick = st().selectProject('p1');
    toProduction();
    await st().refreshExplorer();
    late.resolve([SA_DRAFT, SA_PROD]);
    await pick;
    expect(st().subjectAreas.map((s) => s.id)).toEqual(['saP']);
  });

  it('loadFolders tardío tampoco', async () => {
    const late = deferred<unknown>();
    const FOLDER = { id: 'fD', projectId: 'p1', name: 'Solo en el draft', parentFolderId: null, order: 0 };
    vi.mocked(struct.listFolders).mockImplementationOnce(() => late.promise as never);
    const load = st().loadFolders('p1');
    toProduction();
    await st().refreshExplorer();
    late.resolve([FOLDER]);
    await load;
    expect(st().folders).toEqual([]);
  });
});

// Doc 105 (ronda 3): `refreshExplorer` y un cambio SÓLO de modo; Refresh con
// una apertura de canvas en vuelo.
describe('refresco del Explorer: sesión movida y apertura en vuelo (doc 105, ronda 3)', () => {
  it('un 403 de la versión y la revalidación la pasó a solo lectura (MISMA versión): termina en silencio', async () => {
    vi.mocked(struct.listProjects).mockImplementationOnce(async () => {
      trackRevalidation(new Promise<void>((r) => setTimeout(() => {
        useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly', changesetId: 'cs1' }); r();
      }, 5)));
      throw new ApiError('Only the owner can edit this version.', 403, null, '/api/changesets/cs1/effective/projects');
    });
    await expect(st().refreshExplorer()).resolves.toBeUndefined();   // antes: re-lanzaba (sólo miraba la versión)
  });

  it('Refresh mientras se abre otro canvas: esa apertura no se pierde', async () => {
    const lateX = deferred<unknown>();
    vi.mocked(mod.loadDiagram).mockImplementation(async (id: string) => (id === 'saP' ? lateX.promise : dia({ id }, `DIAGRAMA_${id}`)) as never);
    const click = st().selectSubjectArea('saP', 'p1');       // clic en el Explorer (misma sesión)
    const refresh = st().refreshExplorer();                  // …y Refresh antes de que llegue
    lateX.resolve(dia({ id: 'saP' }, 'DIAGRAMA_saP'));
    await Promise.all([click, refresh]);
    await sleep(5);
    expect({ activeSaId: st().activeSaId, openingSaId: st().openingSaId, table: st().diagram?.tables[0]?.physicalName })
      .toEqual({ activeSaId: 'saP', openingSaId: null, table: 'DIAGRAMA_saP' });
  });
});
