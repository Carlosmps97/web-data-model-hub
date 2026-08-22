import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/governance/services/governance.service', () => ({
  deleteRelationship: vi.fn().mockResolvedValue({}),
  deleteColumn: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/features/modeler/services/modeler.service', () => ({}));
import * as gov from '@/features/governance/services/governance.service';
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
