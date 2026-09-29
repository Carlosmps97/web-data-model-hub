// Doc 102 (D1): el combo Version del Reporting — producción + MIS versiones sin
// publicar del proyecto (borrador o en revisión).
import { describe, expect, it } from 'vitest';
import type { VersionRow } from '@/types/versioning';
import { levelsFileName, ownOpenVersions, productionLabel, versionOptionLabel } from './reportVersions';

const v = (over: Partial<VersionRow>): VersionRow => ({
  id: 'x', versionLabel: 'v1', title: null, owner: 'ana', status: 'draft', projectId: 'p1',
  deletesProject: false, reviewers: [], ...over,
});

describe('reportVersions', () => {
  it('solo mis draft / en revisión del proyecto, la más reciente primero', () => {
    const rows = [
      v({ id: 'a', updatedAt: '2026-09-01' }), v({ id: 'b', status: 'submitted', updatedAt: '2026-09-03' }),
      v({ id: 'c', owner: 'luis' }), v({ id: 'd', projectId: 'p2' }), v({ id: 'e', status: 'approved', appliedAt: 'x' }),
      v({ id: 'f', status: 'rejected' }),
    ];
    expect(ownOpenVersions(rows, 'p1', 'ana').map((r) => r.id)).toEqual(['b', 'a']);
    expect(ownOpenVersions(rows, 'p1', null)).toEqual([]);
  });
  it('etiquetas', () => {
    expect(versionOptionLabel(v({ versionLabel: 'v14', title: 'Carga Excel' }))).toBe('v14 · Carga Excel — draft');
    expect(versionOptionLabel(v({ versionLabel: 'v14', title: 'v14', status: 'submitted' }))).toBe('v14 — in review');
    expect(productionLabel(v({ versionLabel: 'v12', status: 'approved' }))).toBe('Production · v12');
    expect(productionLabel(null)).toBe('Production');
  });
  it('nombre del Excel por niveles: la versión propia va en el nombre', () => {
    const d = new Date(2026, 8, 28, 12, 0, 0);   // hora LOCAL: el nombre usa la fecha local
    expect(levelsFileName('MODELO DDV', null, d)).toBe('data-model-hub-report-MODELO_DDV-2026-09-28.xlsx');
    expect(levelsFileName('MODELO DDV', 'v14', d)).toBe('data-model-hub-report-MODELO_DDV-v14-2026-09-28.xlsx');
  });
  it('la fecha del nombre es la LOCAL de quien exporta (como la plantilla), no la UTC', () => {
    // Lima 23:59 ya es el día siguiente en UTC; 00:00 de un huso al este de UTC, el anterior.
    expect(levelsFileName('MODELO DDV', null, new Date(2026, 8, 28, 23, 59, 59)))
      .toBe('data-model-hub-report-MODELO_DDV-2026-09-28.xlsx');
    expect(levelsFileName('MODELO DDV', 'v14', new Date(2026, 8, 28, 0, 0, 1)))
      .toBe('data-model-hub-report-MODELO_DDV-v14-2026-09-28.xlsx');
  });
});
