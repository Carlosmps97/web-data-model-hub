// La recarga que cierra casi toda edición del canvas.
//  · Pedida mientras se abre otro canvas, no se descarta («esa apertura trae el
//    diagrama al día»): si esa apertura falla, quedaría en pantalla el diagrama
//    previo a la edición y la siguiente edición de la misma columna (upsert del
//    documento completo) pisaría la anterior; si abre, un cambio estructural debe
//    llegar al Explorer (`explorerTick`).
//  · Una recarga pendiente no queda colgada si el refresco del Explorer no
//    reabre nada.
//  · Si la recarga falla (red, timeout, 5xx), cierra el canvas y lo dice: lo que
//    queda en pantalla es anterior a la escritura y conservarlo dejaría editar
//    datos desactualizados. Un 404, con su propio aviso. Un error de la versión
//    espera la revalidación (si la sesión cambia, la revalidación ya avisó).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
function deferred<T>() {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}
let write: ReturnType<typeof deferred<unknown>> | null = null;
vi.mock('@/services/changeset.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/changeset.service')>();
  return { ...actual, effective: vi.fn(async () => []), recordChangesBulk: vi.fn(async () => ({})), recordChange: vi.fn(async () => (write ? write.promise : {})) };
});
vi.mock('../features/modeler/services/structure.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/modeler/services/structure.service')>();
  return { ...actual, listProjects: vi.fn(), listFolders: vi.fn(async () => []), listSubjectAreas: vi.fn(), projectDeletionPending: vi.fn(async () => false) };
});
vi.mock('../features/modeler/services/schemas.service', () => ({ listSchemas: vi.fn(async () => []) }));
vi.mock('../features/modeler/services/modeler.service', () => ({ loadDiagram: vi.fn() }));
vi.mock('@/services/naming.service', () => ({ getNamingConfig: vi.fn(async () => ({})) }));

import { toast } from 'sonner';
import * as csvc from '@/services/changeset.service';
import { ApiError } from '@/services/http';
import * as struct from '../features/modeler/services/structure.service';
import * as mod from '../features/modeler/services/modeler.service';
import { trackRevalidation } from '../features/modeler/lib/sessionGuard';
import { useModelerStore } from './useModelerStore';
import { useSessionStore } from './useSessionStore';

const st = () => useModelerStore.getState();
const tick = () => new Promise((r) => setTimeout(r, 0));
const SA = (id: string) => ({ id, projectId: 'p1', name: id, folderId: null, tableIds: id === 'sa1' ? ['t1'] : [], layout: {} });
let server = { description: 'old', physicalName: 'A' };
const diaA = () => ({
  subjectArea: SA('sa1'), tables: [{ id: 't1', logicalName: 't', physicalName: 'T1' }],
  columns: [{ id: 'c1', tableId: 't1', logicalName: 'a', physicalName: server.physicalName, dataType: 'INT', typeOverridden: false, ordinal: 0, description: server.description }],
  relationships: [], views: [],
});
const diaB = () => ({ subjectArea: SA('sa2'), tables: [], columns: [], relationships: [], views: [] });
const shown = () => vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));

beforeEach(async () => {
  vi.clearAllMocks();
  write = null;
  server = { description: 'old', physicalName: 'A' };
  vi.mocked(struct.listProjects).mockResolvedValue([{ id: 'p1', name: 'Uno' }] as never);
  vi.mocked(struct.listSubjectAreas).mockResolvedValue([SA('sa1'), SA('sa2')] as never);
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1', activeProjectId: 'p1' });
  useModelerStore.setState({ projects: [{ id: 'p1', name: 'Uno' } as never], activeProjectId: 'p1', activeSaId: null, diagram: null, trees: {}, folders: [], subjectAreas: [SA('sa1'), SA('sa2')] as never, openingSaId: null });
  vi.mocked(mod.loadDiagram).mockImplementation(async (id: string) => (id === 'sa2' ? diaB() : diaA()) as never);
  await st().selectSubjectArea('sa1');
});
afterEach(async () => { await new Promise((r) => setTimeout(r, 5)); });

/** Una edición de c1 cuyo guardado termina mientras se abre `sa2` (clic en el Explorer). */
async function editWhileOpeningB(fields: object, onServer: () => void) {
  write = deferred();
  const w = write;
  const edit = st().updateColumn('c1', fields as never);
  await tick();
  const openB = deferred<unknown>();
  vi.mocked(mod.loadDiagram).mockImplementation(async (id: string) => (id === 'sa2' ? openB.promise : diaA()) as never);
  const opening = st().selectSubjectArea('sa2').then(() => null, (e: unknown) => e);
  onServer();
  write = null;
  w.resolve({});
  await edit;                                       // su reload() queda pendiente: hay una apertura en vuelo
  return { openB, opening };
}

describe('recarga pedida mientras se abre otro canvas', () => {
  it('si esa apertura falla, al terminar se recarga el canvas editado (la edición siguiente no pisa la anterior)', async () => {
    const { openB, opening } = await editWhileOpeningB({ description: 'new' }, () => { server.description = 'new'; });
    openB.reject(new Error('Network error'));
    await opening;
    expect(st().activeSaId).toBe('sa1');
    expect(st().diagram?.columns[0].description).toBe('new');
    vi.mocked(csvc.recordChange).mockClear();
    await st().updateColumn('c1', { isNullable: false } as never);
    expect(JSON.stringify(vi.mocked(csvc.recordChange).mock.calls)).toContain('"description":"new"');
  });

  it('si esa apertura se instala, el Explorer se entera (explorerTick)', async () => {
    const tick0 = st().explorerTick;
    const { openB, opening } = await editWhileOpeningB({ physicalName: 'A_RENAMED' }, () => { server.physicalName = 'A_RENAMED'; });
    openB.resolve(diaB());
    await opening;
    expect(st().activeSaId).toBe('sa2');
    expect(st().explorerTick).toBeGreaterThan(tick0);
    // se consumió: volver a A es una carga, sin recarga de más
    vi.mocked(mod.loadDiagram).mockImplementation(async () => diaA() as never);
    const loads = vi.mocked(mod.loadDiagram).mock.calls.length;
    await st().selectSubjectArea('sa1');
    expect(vi.mocked(mod.loadDiagram).mock.calls.length - loads).toBe(1);
  });

  it('sin edición pendiente, abrir otro canvas no toca el Explorer', async () => {
    const tick0 = st().explorerTick;
    await st().selectSubjectArea('sa2');
    expect(st().explorerTick).toBe(tick0);
  });

  it('un refresco que no reabre nada descarta lo pendiente (no queda colgado)', async () => {
    const { openB } = await editWhileOpeningB({ description: 'new' }, () => { server.description = 'new'; });
    vi.mocked(struct.listSubjectAreas).mockResolvedValue([] as never);   // los canvases desaparecieron
    await st().refreshExplorer();
    openB.resolve(diaB());
    await tick(); await tick();
    // Más tarde el canvas vuelve y se abre con un clic: sin recarga de más.
    vi.mocked(mod.loadDiagram).mockImplementation(async () => diaA() as never);
    const loads = vi.mocked(mod.loadDiagram).mock.calls.length;
    await st().selectSubjectArea('sa1');
    expect(vi.mocked(mod.loadDiagram).mock.calls.length - loads).toBe(1);
  });
});

describe('una recarga que falla no cierra el canvas en silencio', () => {
  const url = '/api/subject-areas/sa1/diagram?changesetId=cs1';

  it('red o timeout: se cierra y se dice por qué', async () => {
    vi.mocked(mod.loadDiagram).mockRejectedValueOnce(new ApiError("The server didn't respond within 30s — try again in a moment.", 0, null, url));
    await st().reload();
    expect({ activeSaId: st().activeSaId, diagram: st().diagram }).toEqual({ activeSaId: null, diagram: null });
    expect(shown()).toEqual(["Couldn't reload the canvas: The server didn't respond within 30s. Open it again from the explorer."]);
  });

  it('5xx: ídem', async () => {
    vi.mocked(mod.loadDiagram).mockRejectedValueOnce(new ApiError('Internal server error', 500, null, url));
    await st().reload();
    expect({ activeSaId: st().activeSaId, diagram: st().diagram }).toEqual({ activeSaId: null, diagram: null });
    expect(shown()).toEqual(["Couldn't reload the canvas: Internal server error. Open it again from the explorer."]);
  });

  it('404 (el canvas no existe en esta versión): se cierra y se dice', async () => {
    vi.mocked(mod.loadDiagram).mockRejectedValueOnce(new ApiError('Subject area not found', 404, null, url));
    await st().reload();
    expect({ activeSaId: st().activeSaId, diagram: st().diagram }).toEqual({ activeSaId: null, diagram: null });
    expect(shown()).toEqual(['This canvas is no longer in this version, so it was closed. Open another one from the explorer.']);
  });

  it('un error de la versión que la revalidación cambia: calla (el aviso lo da la revalidación)', async () => {
    vi.mocked(mod.loadDiagram).mockImplementationOnce(async () => {
      trackRevalidation(new Promise<void>((res) => setTimeout(() => {
        useSessionStore.getState().openModel({ projectId: 'p1', mode: 'readonly' }); res();
      }, 10)));
      throw new ApiError('This version was deleted.', 404, null, url);
    });
    await st().reload();
    expect(shown()).toEqual([]);
  });
});
