import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/governance.service', () => ({
  deleteRelationship: vi.fn().mockResolvedValue({}),
  deleteColumn: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/features/modeler/services/modeler.service', () => ({}));
import * as gov from '@/services/governance.service';
import * as csvc from '@/services/changeset.service';
import { useSessionStore } from '@/store/useSessionStore';
import { useModelerStore } from './useModelerStore';

describe('useModelerStore.deleteColumn (cascade spec 10 §8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Sin canvas activo el reload() interno es no-op (no pega al backend).
    useModelerStore.setState({ activeSaId: null, dirty: false });
  });

  it('borra las relaciones afectadas ANTES que la columna', async () => {
    const order: string[] = [];
    vi.mocked(gov.deleteRelationship).mockImplementation(async (id: string) => { order.push(`rel:${id}`); return {} as never; });
    vi.mocked(gov.deleteColumn).mockImplementation(async (id: string) => { order.push(`col:${id}`); return {} as never; });
    await useModelerStore.getState().deleteColumn('c1', ['r1', 'r2']);
    expect(order).toEqual(['rel:r1', 'rel:r2', 'col:c1']);
    expect(useModelerStore.getState().dirty).toBe(true);
  });

  it('sin relaciones conserva el contrato anterior (sólo la columna)', async () => {
    await useModelerStore.getState().deleteColumn('c1');
    expect(gov.deleteRelationship).not.toHaveBeenCalled();
    expect(gov.deleteColumn).toHaveBeenCalledWith('c1');
  });
});


describe('useModelerStore.deleteProject (doc 75 D5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ openMode: 'editing', activeProjectId: 'p1', activeChangesetId: 'cs1' });
    useSessionStore.setState({ activeChangesetId: 'cs1' });
    useModelerStore.setState({ activeProjectId: 'p1', activeSaId: null, dirty: false, projectDeletionPending: false });
  });

  it('graba UN solo cambio y deja el draft en deletion pending', async () => {
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
