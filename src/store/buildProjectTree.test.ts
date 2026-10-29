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

// Nada queda escondido (doc 134 §4.5): lo que cuelga de una carpeta que ya no
// existe, o de un ciclo que formaron dos versiones, se ve en la raíz.
describe('buildProjectTree — nada queda escondido', () => {
  /** Todos los canvases del árbol, en cualquier carpeta. */
  const allCanvases = (tree: ReturnType<typeof buildProjectTree>): string[] => {
    const inFolder = (n: ReturnType<typeof buildProjectTree>['folders'][number]): string[] =>
      [...n.canvases.map((c) => c.id), ...n.folders.flatMap(inFolder)];
    return [...tree.canvases.map((c) => c.id), ...tree.folders.flatMap(inFolder)].sort();
  };
  /** Todas las carpetas del árbol, con repetición si una aparece dos veces. */
  const allFolders = (tree: ReturnType<typeof buildProjectTree>): string[] => {
    const walk = (n: ReturnType<typeof buildProjectTree>['folders'][number]): string[] => [n.folder.id, ...n.folders.flatMap(walk)];
    return tree.folders.flatMap(walk).sort();
  };

  it('una carpeta cuyo padre no existe va a la raíz con lo suyo', () => {
    const tree = buildProjectTree(project, [F('f1', 'gone', 'Huérfana'), F('f2', 'f1', 'Hija')], [SA('c1', 'f2', 'Modelo')]);
    expect(tree.folders.map((n) => n.folder.id)).toEqual(['f1']);
    expect(tree.folders[0].folders.map((n) => n.folder.id)).toEqual(['f2']);
    expect(allCanvases(tree)).toEqual(['c1']);
  });

  it('un canvas cuya carpeta no existe va a la raíz', () => {
    const tree = buildProjectTree(project, [F('f1', null, 'Dom')], [SA('c1', 'gone', 'Suelto'), SA('c2', 'f1', 'Adentro')]);
    expect(tree.canvases.map((c) => c.id)).toEqual(['c1']);
    expect(allCanvases(tree)).toEqual(['c1', 'c2']);
  });

  it('un ciclo entre dos carpetas: la de menor nombre a la raíz y la otra adentro, cada una una vez', () => {
    const folders = [F('a', 'b', 'Beta'), F('b', 'a', 'Alfa')];
    const tree = buildProjectTree(project, folders, [SA('c1', 'a', 'X'), SA('c2', 'b', 'Y')]);
    expect(tree.folders.map((n) => n.folder.id)).toEqual(['b']);
    expect(tree.folders[0].folders.map((n) => n.folder.id)).toEqual(['a']);
    expect(allFolders(tree)).toEqual(['a', 'b']);
    expect(allCanvases(tree)).toEqual(['c1', 'c2']);
  });

  it('una cadena que termina en una carpeta inexistente cuelga de su primera carpeta que existe', () => {
    const tree = buildProjectTree(project, [F('f7', 'f8', 'Siete'), F('f8', 'gone', 'Ocho')], [SA('c7', 'f7', 'M')]);
    expect(tree.folders.map((n) => n.folder.id)).toEqual(['f8']);
    expect(tree.folders[0].folders.map((n) => n.folder.id)).toEqual(['f7']);
    expect(allCanvases(tree)).toEqual(['c7']);
  });

  it('una carpeta que es su propio padre va a la raíz', () => {
    const tree = buildProjectTree(project, [F('s', 's', 'Sola')], [SA('c1', 's', 'M')]);
    expect(allFolders(tree)).toEqual(['s']);
    expect(allCanvases(tree)).toEqual(['c1']);
  });
});
