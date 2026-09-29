// Doc 102 (431): «Import existing tables» con vistas pedía TODAS las tablas en
// UNA URL — con cientos de ids pasaba el tope de cabeceras del server del front.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ activeChangesetId: null as string | null }));
vi.mock('@/store/useSessionStore', () => ({ useSessionStore: { getState: () => state } }));
vi.mock('@/services/http', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('@/services/changeset.service', () => ({ effective: vi.fn() }));
import { apiGet } from '@/services/http';
import * as csvc from '@/services/changeset.service';
import { listViewsForTables, VIEW_IDS_PER_GET } from './views.service';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

beforeEach(() => { vi.clearAllMocks(); state.activeChangesetId = null; });

describe('listViewsForTables (doc 102)', () => {
  it('producción: tandas de 100 ids por GET y sin vistas repetidas', async () => {
    vi.mocked(apiGet).mockImplementation(async () => [{ id: 'v1', name: 'V1' }] as never);
    const out = await listViewsForTables(ids(250));
    const lots = vi.mocked(apiGet).mock.calls.map(([u]) => decodeURIComponent(String(u).split('tableIds=')[1]).split(','));
    expect(VIEW_IDS_PER_GET).toBe(100);
    expect(lots.map((l) => l.length)).toEqual([100, 100, 50]);
    expect(lots.flat()).toEqual(ids(250));
    expect(out).toEqual([{ id: 'v1', name: 'V1' }]);
  });
  it('sin tablas no pide nada; con draft sigue por el estado efectivo', async () => {
    expect(await listViewsForTables([])).toEqual([]);
    expect(apiGet).not.toHaveBeenCalled();
    state.activeChangesetId = 'cs1';
    vi.mocked(csvc.effective).mockResolvedValue([{ id: 'v2', name: 'V2' }] as never);
    expect(await listViewsForTables(['t1', 't2'])).toEqual([{ id: 'v2', name: 'V2' }]);
    expect(csvc.effective).toHaveBeenCalledTimes(2);
  });
});
