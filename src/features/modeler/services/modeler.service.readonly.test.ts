import { describe, expect, it } from 'vitest';
import * as real from './modeler.service';

/** Carpetas y canvases se escriben solo por la versión en edición
 *  (structure.service); el backend rechaza las escrituras directas (409).
 *  Exportarlas desde acá abriría un camino a producción sin revisión. */
describe('modeler.service solo lee', () => {
  it('no exporta escrituras directas de carpetas ni canvases', () => {
    const writers = ['createFolder', 'renameFolder', 'moveFolder', 'deleteFolder', 'createSubjectArea',
      'updateSubjectArea', 'deleteSubjectArea', 'setSubjectAreaTables', 'setSubjectAreaViews',
      'setSubjectAreaLayout', 'setSubjectAreaDrawings'];
    expect(writers.filter((w) => w in real)).toEqual([]);
  });
});
