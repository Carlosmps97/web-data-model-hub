import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/governance.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/governance.service')>();
  return { bulk: actual.bulk, recordChangesBulk: vi.fn().mockResolvedValue({}) };
});
vi.mock('@/features/modeler/services/modeler.service', () => ({}));
import * as gov from '@/services/governance.service';
import * as csvc from '@/services/changeset.service';
import { useSessionStore } from '@/store/useSessionStore';
import { useModelerStore } from './useModelerStore';

describe('useModelerStore.deleteColumn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Sin canvas activo el reload() interno es no-op (no pega al backend).
    useModelerStore.setState({ activeSaId: null, dirty: false });
  });

  it('borra las relaciones afectadas y la columna en un solo lote', async () => {
    await useModelerStore.getState().deleteColumn('c1', ['r1', 'r2']);
    expect(gov.recordChangesBulk).toHaveBeenCalledTimes(1);
    expect(vi.mocked(gov.recordChangesBulk).mock.calls[0][0]).toEqual([
      { collection: 'relationships', entityId: 'r1', op: 'delete' },
      { collection: 'relationships', entityId: 'r2', op: 'delete' },
      { collection: 'canonical_columns', entityId: 'c1', op: 'delete' },
    ]);
    expect(useModelerStore.getState().dirty).toBe(true);
  });

  it('sin relaciones borra solo la columna', async () => {
    await useModelerStore.getState().deleteColumn('c1');
    expect(vi.mocked(gov.recordChangesBulk).mock.calls).toEqual([[[{ collection: 'canonical_columns', entityId: 'c1', op: 'delete' }], 1]]);
  });
});


describe('useModelerStore.deleteProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ openMode: 'editing', activeProjectId: 'p1', activeChangesetId: 'cs1' });
    useSessionStore.setState({ activeChangesetId: 'cs1' });
    useModelerStore.setState({ activeProjectId: 'p1', activeSaId: null, dirty: false, projectDeletionPending: false });
  });

  it('graba un solo cambio y deja el draft en deletion pending', async () => {
    const rec = vi.spyOn(csvc, 'recordChange').mockResolvedValue(undefined as never);
    await useModelerStore.getState().deleteProject('p1');
    expect(rec).toHaveBeenCalledTimes(1);
    expect(rec).toHaveBeenCalledWith('cs1', 'projects', 'p1', 'delete');
    expect(useModelerStore.getState().projectDeletionPending).toBe(true);
    expect(useModelerStore.getState().dirty).toBe(true);
  });

  it('en solo lectura no graba nada', async () => {
    useSessionStore.setState({ openMode: 'readonly' });
    const rec = vi.spyOn(csvc, 'recordChange').mockResolvedValue(undefined as never);
    await expect(useModelerStore.getState().deleteProject('p1')).rejects.toThrow('working copy in edit mode');
    expect(rec).not.toHaveBeenCalled();
    expect(useModelerStore.getState().projectDeletionPending).toBe(false);
  });
});
