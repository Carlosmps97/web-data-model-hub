import { describe, expect, it } from 'vitest';
import { canManageVersion, showStartedBy, startedBy, transferTargets, versionActionBlock } from './versionAdmin';
import type { OwnershipTransfer, SimUserDto } from '@/types/versioning';

const T1: OwnershipTransfer = { from: 'ana', to: 'beto', by: 'ana', at: '2026-09-29T10:00:00Z' };
const T2: OwnershipTransfer = { from: 'beto', to: 'carla', by: 'admin', at: '2026-09-29T11:00:00Z', note: 'vacaciones' };
const hasOf = (...perms: string[]) => (p: string) => perms.includes(p);

describe('versionAdmin (doc 104)', () => {
  it('startedBy: quien la inició es el origen de la PRIMERA transferencia', () => {
    expect(startedBy({ transfers: [T1, T2] })).toBe('ana');
    expect(startedBy({ transfers: [] })).toBeNull();
    expect(startedBy({})).toBeNull();
  });

  it('showStartedBy: sólo si quien la inició no es el dueño actual (A→B→A no lo muestra)', () => {
    expect(showStartedBy({ owner: 'carla', transfers: [T1, T2] })).toBe('ana');
    expect(showStartedBy({ owner: 'ana', transfers: [T1, { ...T2, from: 'beto', to: 'ana' }] })).toBeNull();
    expect(showStartedBy({ owner: 'ana', transfers: [] })).toBeNull();
  });

  it('canManageVersion: owner que edita o administrador', () => {
    const v = { owner: 'ana' };
    expect(canManageVersion(v, 'ana', hasOf('model.edit'))).toBe(true);
    expect(canManageVersion(v, 'ana', hasOf('model.view'))).toBe(false);      // su rol ya no edita
    expect(canManageVersion(v, 'carla', hasOf('model.edit'))).toBe(false);    // ajena
    expect(canManageVersion(v, 'root', hasOf('admin.manage'))).toBe(true);
    expect(canManageVersion(v, null, hasOf('model.edit'))).toBe(false);
  });

  it('versionActionBlock: sólo drafts; en revisión dice cómo seguir; publicada nunca', () => {
    expect(versionActionBlock({ status: 'draft' }, 'transfer')).toBeNull();
    expect(versionActionBlock({ status: 'draft' }, 'delete')).toBeNull();
    expect(versionActionBlock({ status: 'submitted' }, 'transfer')).toMatch(/withdraw/i);
    expect(versionActionBlock({ status: 'submitted' }, 'delete')).toMatch(/withdraw/i);
    expect(versionActionBlock({ status: 'approved', appliedAt: '2026-09-01' }, 'delete')).toMatch(/history/i);
    expect(versionActionBlock({ status: 'approved', appliedAt: null }, 'transfer')).toMatch(/history/i);
    // `rejected` legacy: se elimina, no se transfiere.
    expect(versionActionBlock({ status: 'rejected' }, 'delete')).toBeNull();
    expect(versionActionBlock({ status: 'rejected' }, 'transfer')).not.toBeNull();
  });

  it('transferTargets: todos menos el dueño actual, A–Z', () => {
    const users: SimUserDto[] = [
      { id: 'zoe', name: 'Zoe', initials: 'ZO' },
      { id: 'ana', name: 'Ana', initials: 'AN' },
      { id: 'beto', name: 'beto', initials: 'BE' },
    ];
    expect(transferTargets(users, 'ana').map((u) => u.id)).toEqual(['beto', 'zoe']);
    expect(transferTargets(users, null).map((u) => u.id)).toEqual(['ana', 'beto', 'zoe']);
  });
});
