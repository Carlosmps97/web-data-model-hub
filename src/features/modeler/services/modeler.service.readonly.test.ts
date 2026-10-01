import { describe, expect, it } from 'vitest';
import * as real from './modeler.service';

/** Doc 105: carpetas y canvases se escriben SÓLO por la versión en edición
 *  (structure.service); el backend rechaza las escrituras directas (409). Que
 *  vuelvan a aparecer acá sería reabrir el camino a producción sin revisión. */
describe('modeler.service sólo lee (doc 105)', () => {
  it('no exporta escrituras directas de carpetas ni canvases', () => {
    const writers = ['createFolder', 'renameFolder', 'moveFolder', 'deleteFolder', 'createSubjectArea',
      'updateSubjectArea', 'deleteSubjectArea', 'setSubjectAreaTables', 'setSubjectAreaViews',
      'setSubjectAreaLayout', 'setSubjectAreaDrawings'];
    expect(writers.filter((w) => w in real)).toEqual([]);
  });
});
