import { describe, it, expect } from 'vitest';
import { projectMeta, sortProjects } from './projects';

describe('lib/projects', () => {
  it('sortProjects ordena A–Z sin distinguir mayúsculas ni tildes', () => {
    const s = sortProjects([{ id: 'b', name: 'VENTAS LOGICO' }, { id: 'c', name: 'modelo ventas' }, { id: 'a', name: 'Árbol' }]);
    expect(s.map((p) => p.name)).toEqual(['Árbol', 'modelo ventas', 'VENTAS LOGICO']);
  });

  it('projectMeta: producción más reciente y drafts propios por proyecto', () => {
    const m = projectMeta([
      { id: '1', projectId: 'a', status: 'approved', appliedAt: '2026-09-01', versionLabel: 'v1', title: null, owner: 'x', reviewers: [], deletesProject: false },
      { id: '2', projectId: 'a', status: 'approved', appliedAt: '2026-09-03', versionLabel: 'v2', title: null, owner: 'x', reviewers: [], deletesProject: false },
      { id: '3', projectId: 'a', status: 'draft', appliedAt: null, versionLabel: 'v3', title: null, owner: 'me', reviewers: [], deletesProject: false },
      { id: '4', projectId: 'b', status: 'draft', appliedAt: null, versionLabel: 'v1', title: null, owner: 'other', reviewers: [], deletesProject: false },
      // approved sin appliedAt = publish interrumpido: no es producción
      { id: '5', projectId: 'b', status: 'approved', appliedAt: null, versionLabel: 'v2', title: null, owner: 'x', reviewers: [], deletesProject: false },
    ], 'me');
    expect(m.a).toEqual({ production: 'v2', productionRow: expect.objectContaining({ id: '2' }), drafts: 1 });
    expect(m.b).toEqual({ production: null, productionRow: null, drafts: 0 });
  });
});
