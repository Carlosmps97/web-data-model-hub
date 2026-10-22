// Quién puede abrir una versión en el canvas (espejo del backend).
import { describe, expect, it } from 'vitest';
import { canOpenVersion } from './versioning.service';

const none = () => false;
const admin = (p: string) => p === 'admin.manage';
const viewAll = (p: string) => p === 'versions.view_all';

describe('canOpenVersion', () => {
  it('publicadas (pasadas y actual): todos', () => {
    expect(canOpenVersion({ status: 'approved', appliedAt: '2026-09-01', owner: 'ana' }, 'beto', none)).toBe(true);
  });
  it('no publicadas: dueño y revisores asignados', () => {
    const draft = { status: 'draft' as const, owner: 'ana', reviewers: [] as string[] };
    expect(canOpenVersion(draft, 'ana', none)).toBe(true);
    expect(canOpenVersion(draft, 'beto', none)).toBe(false);
    expect(canOpenVersion({ status: 'submitted', owner: 'ana', reviewers: ['qa'] }, 'qa', none)).toBe(true);
    // aprobada pero sin appliedAt (publish interrumpido) sigue siendo "no publicada"
    expect(canOpenVersion({ status: 'approved', appliedAt: null, owner: 'ana' }, 'beto', none)).toBe(false);
  });
  it('ajenas: solo versions.view_all o admin.manage', () => {
    const draft = { status: 'draft' as const, owner: 'ana' };
    expect(canOpenVersion(draft, 'beto', viewAll)).toBe(true);
    expect(canOpenVersion(draft, 'beto', admin)).toBe(true);
    expect(canOpenVersion(draft, null, none)).toBe(false);
  });
});
