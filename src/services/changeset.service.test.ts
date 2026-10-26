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
import { onDraftWrite, recordChange, recordChangesBulk, type BulkChange } from './changeset.service';

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

  it('con `chunkSize` del largo del lote, un solo request', async () => {
    const items = Array.from({ length: 1500 }, (_, i) => del(i));
    await recordChangesBulk('cs1', items, items.length);
    expect(vi.mocked(apiPut).mock.calls.map(([, body]) => (body as { changes: BulkChange[] }).changes.length)).toEqual([1500]);
  });

  it('lote vacío = cero requests (el backend exige min 1 por tanda)', async () => {
    const res = await recordChangesBulk('cs1', []);
    expect(apiPut).not.toHaveBeenCalled();
    expect(res).toBeUndefined();
  });
});

describe('onDraftWrite', () => {
  it('avisa cada escritura al terminar, con su número en el draft (sin número si falló)', async () => {
    const seen: [string, number, number | undefined][] = [];
    const off = onDraftWrite((cs, changes, seq) => seen.push([cs, changes.length, seq]));
    try {
      vi.mocked(apiPut).mockResolvedValueOnce({ writeSeq: 4 } as never);
      await recordChange('cs1', 'canonical_columns', 'c1', 'delete');
      vi.mocked(apiPut).mockResolvedValueOnce({ writeSeq: 5 } as never).mockRejectedValueOnce(new Error('red'));
      await expect(recordChangesBulk('cs1', Array.from({ length: 1500 }, (_, i) => del(i)))).rejects.toThrow('red');
      expect(seen).toEqual([['cs1', 1, 4], ['cs1', 1000, 5], ['cs1', 500, undefined]]);
    } finally {
      off();
    }
  });

  it('un observador roto no cambia la escritura, no corta el lote ni deja sin aviso a los demás', async () => {
    const off = onDraftWrite(() => { throw new Error('roto'); });
    const seen: number[] = [];
    const offOk = onDraftWrite((_cs, changes) => seen.push(changes.length));
    try {
      // Solo para esta escritura: la respuesta simulada no queda para las pruebas siguientes.
      vi.mocked(apiPut).mockResolvedValueOnce({ id: 'cs1', writeSeq: 9 } as never);
      await expect(recordChange('cs1', 'canonical_columns', 'c1', 'delete')).resolves.toEqual({ id: 'cs1', writeSeq: 9 });
      await recordChangesBulk('cs1', Array.from({ length: 1500 }, (_, i) => del(i)));
      expect(apiPut).toHaveBeenCalledTimes(3);
      expect(seen).toEqual([1, 1000, 500]);
    } finally {
      off();
      offOk();
    }
  });
});

