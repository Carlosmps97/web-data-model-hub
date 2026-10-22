// recordChangesBulk: un lote de cambios viaja en tandas de 1000 por
// PUT /changes/bulk; enviar la cascada cambio por cambio serían miles de
// requests secuenciales en tablas grandes (minutos de espera).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/http', () => ({
  apiGet: vi.fn(),
  LONG_TIMEOUT_MS: 120_000,
  apiPost: vi.fn(),
  apiPut: vi.fn().mockResolvedValue({ id: 'cs1', title: 't', owner: 'ana', status: 'draft' }),
}));
import { apiPut } from '@/services/http';
import { recordChangesBulk, type BulkChange } from './changeset.service';

const del = (i: number): BulkChange => ({ collection: 'canonical_columns', entityId: `c${i}`, op: 'delete' });

beforeEach(() => vi.clearAllMocks());

describe('recordChangesBulk', () => {
  it('trocea en tandas de 1000 secuenciales contra /changes/bulk', async () => {
    const items = Array.from({ length: 2500 }, (_, i) => del(i));
    const res = await recordChangesBulk('cs1', items);
    expect(vi.mocked(apiPut).mock.calls.map(([url]) => url))
      .toEqual(Array(3).fill('/api/changesets/cs1/changes/bulk'));
    expect(vi.mocked(apiPut).mock.calls.map(([, body]) => (body as { changes: BulkChange[] }).changes.length))
      .toEqual([1000, 1000, 500]);
    expect(res).toEqual({ id: 'cs1', title: 't', owner: 'ana', status: 'draft' });
  });

  it('conserva el orden de los ítems dentro y entre tandas', async () => {
    const items = Array.from({ length: 1200 }, (_, i) => del(i));
    await recordChangesBulk('cs1', items);
    const sent = vi.mocked(apiPut).mock.calls.flatMap(([, body]) => (body as { changes: BulkChange[] }).changes);
    expect(sent.map((c) => c.entityId)).toEqual(items.map((c) => c.entityId));
  });

  it('lote vacío = cero requests (el backend exige min 1 por tanda)', async () => {
    const res = await recordChangesBulk('cs1', []);
    expect(apiPut).not.toHaveBeenCalled();
    expect(res).toBeUndefined();
  });
});
