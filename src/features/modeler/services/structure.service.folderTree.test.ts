// Borrar una carpeta hace lo que dice su diálogo (doc 134 §4.6): en un solo lote
// se borran ella y todas sus subcarpetas, y los canvases de adentro (a cualquier
// profundidad) pasan a la raíz del proyecto. Cada canvas se decide con su
// documento leído en su cola: uno que otra pestaña sacó de la carpeta no se toca.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/changeset.service', () => ({ effective: vi.fn(), recordChange: vi.fn(), recordChangesBulk: vi.fn() }));
vi.mock('./modeler.service', () => ({}));

import * as csvc from '@/services/changeset.service';
import { useSessionStore } from '@/store/useSessionStore';
import { forgetCanvasWrites } from '../lib/canvasWrites';
import * as struct from './structure.service';
import type { Folder, SubjectArea } from './modeler.service';

const folder = (id: string, parentFolderId: string | null): Folder => ({ id, projectId: 'p1', parentFolderId, name: id, order: 0 });
const canvas = (id: string, folderId: string | null): SubjectArea =>
  ({ id, projectId: 'p1', name: id, folderId, tableIds: [], viewIds: [], layout: {}, drawings: [], udpValues: {}, routes: {} });

let folders: Record<string, Folder>;
let canvases: Record<string, SubjectArea>;
/** Lo que pasa entre la lectura del proyecto y el lote (otra pestaña que escribe). */
let afterList: (() => void) | null;
const lots = () => vi.mocked(csvc.recordChangesBulk).mock.calls.map((c) => c[1].map((ch) => `${ch.collection}:${ch.entityId}:${ch.op}`).sort());
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  forgetCanvasWrites();
  afterList = null;
  folders = Object.fromEntries([folder('F1', null), folder('F2', 'F1'), folder('F3', 'F2'), folder('F4', null)].map((f) => [f.id, f]));
  canvases = Object.fromEntries([canvas('C1', 'F1'), canvas('C3', 'F3'), canvas('C4', 'F4'), canvas('C0', null)].map((c) => [c.id, c]));
  useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1' });
  vi.mocked(csvc.effective).mockImplementation(async (_cs, coll, opts) => {
    await tick();
    const pool: Record<string, Folder | SubjectArea> = coll === 'folders' ? folders : canvases;
    const ids = opts?.ids as string[] | undefined;
    const rows = (ids ? ids.filter((id) => pool[id]).map((id) => pool[id]) : Object.values(pool)).map((d) => structuredClone(d));
    if (!ids && coll === 'subject_areas' && afterList) { afterList(); afterList = null; }
    return rows as never;
  });
  vi.mocked(csvc.recordChangesBulk).mockImplementation(async (_cs, changes) => {
    await tick();
    for (const c of changes) {
      if (c.collection === 'subject_areas') canvases[c.entityId] = structuredClone(c.payload) as unknown as SubjectArea;
      if (c.collection === 'folders' && c.op === 'delete') delete folders[c.entityId];
    }
    return {} as never;
  });
});

describe('deleteFolderTree', () => {
  it('borra la carpeta y sus subcarpetas y deja sus canvases en la raíz, en un solo lote', async () => {
    const out = await struct.deleteFolderTree('F1', 'p1');
    expect(lots()).toEqual([[
      'folders:F1:delete', 'folders:F2:delete', 'folders:F3:delete', 'subject_areas:C1:upsert', 'subject_areas:C3:upsert',
    ]]);
    expect(canvases.C1.folderId).toBeNull();
    expect(canvases.C3.folderId).toBeNull();
    expect(canvases.C4.folderId).toBe('F4');
    expect(Object.keys(folders).sort()).toEqual(['F4']);
    expect(out.folders.sort()).toEqual(['F1', 'F2', 'F3']);
    expect(out.canvases.sort()).toEqual(['C1', 'C3']);
  });

  it('un canvas que otra pestaña sacó de la carpeta antes del lote no se toca', async () => {
    afterList = () => { canvases.C3 = { ...canvases.C3, folderId: 'F4' }; };
    const out = await struct.deleteFolderTree('F1', 'p1');
    expect(lots()).toEqual([['folders:F1:delete', 'folders:F2:delete', 'folders:F3:delete', 'subject_areas:C1:upsert']]);
    expect(canvases.C3.folderId).toBe('F4');
    expect(out.canvases).toEqual(['C1']);
  });

  it('una carpeta sin canvases se borra con sus subcarpetas', async () => {
    await struct.deleteFolderTree('F4', 'p1');
    expect(lots()).toEqual([['folders:F4:delete', 'subject_areas:C4:upsert']]);
    delete canvases.C4;
    folders.F5 = folder('F5', null);
    await struct.deleteFolderTree('F5', 'p1');
    expect(lots()[1]).toEqual(['folders:F5:delete']);
  });

  it('una carpeta que ya no está no borra nada', async () => {
    await expect(struct.deleteFolderTree('nope', 'p1')).rejects.toThrow('This folder is no longer in the working copy.');
    expect(csvc.recordChangesBulk).not.toHaveBeenCalled();
  });

  it('sin sesión de edición no escribe', async () => {
    useSessionStore.setState({ openMode: 'readonly', activeChangesetId: null });
    await expect(struct.deleteFolderTree('F1', 'p1')).rejects.toThrow('Deleting a folder requires a working copy in edit mode.');
    expect(csvc.recordChangesBulk).not.toHaveBeenCalled();
    expect(csvc.recordChange).not.toHaveBeenCalled();
  });
});

describe('mover el canvas abierto mientras se graba una posición', () => {
  it('las dos escrituras van en la cola del canvas: queda la carpeta nueva y la posición nueva', async () => {
    vi.mocked(csvc.recordChange).mockImplementation(async (_cs, _coll, id, _op, payload) => {
      await tick();
      canvases[id] = structuredClone(payload) as unknown as SubjectArea;
      return {} as never;
    });
    canvases.C1 = { ...canvases.C1, layout: { t1: { x: 0, y: 0 } } };
    await Promise.all([
      struct.setSubjectAreaLayout('C1', { t1: { x: 5, y: 7 } }),
      struct.updateSubjectArea('C1', { projectId: 'p1', name: 'C1', folderId: 'F4' }),
    ]);
    expect(canvases.C1.folderId).toBe('F4');
    expect(canvases.C1.layout).toEqual({ t1: { x: 5, y: 7 } });
  });
});

describe('mover y renombrar un canvas solo tocan su campo', () => {
  beforeEach(() => {
    vi.mocked(csvc.recordChange).mockImplementation(async (_cs, _coll, id, _op, payload) => {
      canvases[id] = structuredClone(payload) as unknown as SubjectArea;
      return {} as never;
    });
  });
  it('mover no pisa un nombre que otra pestaña cambió; renombrar no pisa la carpeta', async () => {
    canvases.C1 = { ...canvases.C1, name: 'Renombrado en otra pestaña' };
    await struct.updateSubjectArea('C1', { projectId: 'p1', folderId: 'F4' });
    expect([canvases.C1.name, canvases.C1.folderId]).toEqual(['Renombrado en otra pestaña', 'F4']);
    canvases.C3 = { ...canvases.C3, folderId: 'F4' };   // movido en otra pestaña
    await struct.updateSubjectArea('C3', { projectId: 'p1', name: 'Nuevo nombre' });
    expect([canvases.C3.name, canvases.C3.folderId]).toEqual(['Nuevo nombre', 'F4']);
  });
});

describe('borrar una carpeta de un ciclo', () => {
  it('borra lo que el Explorer muestra adentro, no la carpeta que la contiene', async () => {
    folders = { a: { ...folder('a', 'b'), name: 'Beta' }, b: { ...folder('b', 'a'), name: 'Alfa' } };
    canvases = { c1: canvas('c1', 'a'), c2: canvas('c2', 'b') };
    await struct.deleteFolderTree('a', 'p1');   // a se ve dentro de b (b, «Alfa», va a la raíz)
    expect(lots()).toEqual([['folders:a:delete', 'subject_areas:c1:upsert']]);
    expect(Object.keys(folders)).toEqual(['b']);
  });
});
