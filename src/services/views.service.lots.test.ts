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
    vi.mocked(apiGet).mockImplementation(async () => [{ id: 'v1', name: 'V1', sourceTableIds: ['t0'] }] as never);
    const out = await listViewsForTables(ids(250));
    const lots = vi.mocked(apiGet).mock.calls.map(([u]) => decodeURIComponent(String(u).split('tableIds=')[1]).split(','));
    expect(VIEW_IDS_PER_GET).toBe(100);
    expect(lots.map((l) => l.length)).toEqual([100, 100, 50]);
    expect(lots.flat()).toEqual(ids(250));
    expect(out).toEqual([{ id: 'v1', name: 'V1', sourceTableIds: ['t0'] }]);
  });
  it('sin tablas no pide nada', async () => {
    expect(await listViewsForTables([])).toEqual([]);
    expect(apiGet).not.toHaveBeenCalled();
    expect(csvc.effective).not.toHaveBeenCalled();
  });
});

/** Doc 105 (P2): con draft pedía UN estado efectivo POR TABLA (250 tablas = 250
 *  GET, cada uno relee la cabecera y el ledger de vistas). Ahora: tandas de
 *  100 tablas por GET (`tableIds`), y un filtro de respaldo por fuentes — un
 *  backend viejo ignora `tableIds` y devolvería TODAS las vistas del proyecto. */
describe('listViewsForTables con draft (doc 105)', () => {
  beforeEach(() => { state.activeChangesetId = 'cs1'; });

  it('tandas de 100 tablas por lectura del estado efectivo', async () => {
    vi.mocked(csvc.effective).mockResolvedValue([] as never);
    await listViewsForTables(ids(250));
    const calls = vi.mocked(csvc.effective).mock.calls;
    expect(calls.map(([cs, coll]) => [cs, coll])).toEqual([['cs1', 'views'], ['cs1', 'views'], ['cs1', 'views']]);
    expect(calls.map(([, , opts]) => (opts as { tableIds: string[] }).tableIds.length)).toEqual([100, 100, 50]);
    expect(calls.flatMap(([, , opts]) => (opts as { tableIds: string[] }).tableIds)).toEqual(ids(250));
  });

  it('descarta vistas cuyas fuentes no están entre las tablas pedidas (backend viejo)', async () => {
    vi.mocked(csvc.effective).mockResolvedValue([
      { id: 'v1', name: 'V1', sourceTableIds: ['t1'] },
      { id: 'v9', name: 'V9', sourceTableIds: ['t-otra'] },
      { id: 'v3', name: 'V3', tableId: 't2' },
    ] as never);
    expect((await listViewsForTables(['t1', 't2'])).map((v) => v.id)).toEqual(['v1', 'v3']);
  });

  it('todo o nada: si una tanda falla, falla la lectura (el llamador avisa)', async () => {
    vi.mocked(csvc.effective).mockResolvedValueOnce([] as never).mockRejectedValueOnce(new Error('HTTP 502'));
    await expect(listViewsForTables(ids(150))).rejects.toThrow('HTTP 502');
  });
});
