// El árbol del Explorer ordena carpetas (= subject areas) y canvases
// alfabéticamente, case-insensitive; `order` (Erwin) solo desempata.
import { describe, expect, it } from 'vitest';
import { buildProjectTree } from './useModelerStore';
import type { Project } from '@/types/model';
import type { Folder, SubjectArea } from '@/features/modeler/services/modeler.service';

const project = { id: 'p1', name: 'P' } as Project;
const F = (id: string, parent: string | null, name: string, order = 0) =>
  ({ id, projectId: 'p1', parentFolderId: parent, name, order }) as Folder;
const SA = (id: string, folderId: string | null, name: string) =>
  ({ id, projectId: 'p1', folderId, name, tableIds: [] }) as unknown as SubjectArea;

describe('buildProjectTree', () => {
  it('carpetas A–Z aunque `order` diga otra cosa; canvases A–Z case-insensitive', () => {
    const folders = [F('f1', null, 'zeta', 0), F('f2', null, 'Alfa', 9), F('f3', null, 'beta', 1), F('f4', 'f2', 'Sub b', 0), F('f5', 'f2', 'sub a', 1)];
    const canvases = [SA('c1', null, 'beta'), SA('c2', null, 'Alfa'), SA('c3', 'f2', 'zz'), SA('c4', 'f2', 'AA')];
    const tree = buildProjectTree(project, folders, canvases);
    expect(tree.folders.map((n) => n.folder.name)).toEqual(['Alfa', 'beta', 'zeta']);
    expect(tree.folders[0].folders.map((n) => n.folder.name)).toEqual(['sub a', 'Sub b']);
    expect(tree.folders[0].canvases.map((c) => c.name)).toEqual(['AA', 'zz']);
    expect(tree.canvases.map((c) => c.name)).toEqual(['Alfa', 'beta']);
  });
  it('`order` desempata nombres iguales (case-insensitive)', () => {
    const folders = [F('f1', null, 'Dom', 2), F('f2', null, 'dom', 1)];
    expect(buildProjectTree(project, folders, []).folders.map((n) => n.folder.id)).toEqual(['f2', 'f1']);
  });
});
