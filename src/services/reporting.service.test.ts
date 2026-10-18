// Doc 102: el Reporting lee producción o una versión propia (`changesetId`) y
// los LOTES de ids van en el CUERPO (POST): en la URL, 300 ids daban 431.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/http', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
import { apiGet, apiPost } from '@/services/http';
import {
  countReportTables, listReportColumns, listReportFilters, listReportTables, queryRelationshipsReport, queryReportColumns,
  queryReportViews,
} from './reporting.service';

beforeEach(() => {
  vi.mocked(apiGet).mockReset().mockResolvedValue([]);
  vi.mocked(apiPost).mockReset().mockResolvedValue([]);
});
const url = () => new URL(String(vi.mocked(apiGet).mock.calls[0][0]), 'http://x');

describe('reporting.service (doc 102)', () => {
  it('GET con changesetId solo si hay versión propia', async () => {
    await listReportTables('p1', { limit: 50 }, 'cs1');
    expect(url().pathname).toBe('/api/reporting/tables');
    expect(Object.fromEntries(url().searchParams)).toEqual({ limit: '50', projectId: 'p1', changesetId: 'cs1' });
    vi.mocked(apiGet).mockClear();
    await listReportFilters('p1', null);
    expect(url().searchParams.has('changesetId')).toBe(false);
  });
  it('conteo con versión', async () => {
    vi.mocked(apiGet).mockResolvedValue({ total: 4 });
    expect(await countReportTables('p1', 'cs1')).toBe(4);
    expect(url().searchParams.get('changesetId')).toBe('cs1');
  });
  it('columnas de UNA tabla siguen por GET (Explorer), sin tableIds', async () => {
    await listReportColumns('p1', 't1');
    expect(Object.fromEntries(url().searchParams)).toEqual({ tableId: 't1', projectId: 'p1' });
  });
  it('lotes por POST con los ids en el cuerpo', async () => {
    await queryReportColumns('p1', ['t1', 't2'], 'cs1');
    expect(apiPost).toHaveBeenCalledWith('/api/reporting/columns/query', { projectId: 'p1', tableIds: ['t1', 't2'], changesetId: 'cs1' });
    await queryReportViews('p1', ['t1']);
    expect(apiPost).toHaveBeenLastCalledWith('/api/reporting/views/query', { projectId: 'p1', tableIds: ['t1'] });
  });
  it('relaciones del lote por POST (hoja Relationships), con la versión sólo si hay', async () => {
    await queryRelationshipsReport('p1', ['t1'], 'cs1');
    expect(apiPost).toHaveBeenCalledWith('/api/reporting/insights/relationships/query',
      { projectId: 'p1', tableIds: ['t1'], changesetId: 'cs1' });
    await queryRelationshipsReport('p1', ['t2'], null);
    expect(apiPost).toHaveBeenLastCalledWith('/api/reporting/insights/relationships/query',
      { projectId: 'p1', tableIds: ['t2'] });
  });
  it('lote vacío = cero pedidos', async () => {
    expect(await queryReportColumns('p1', [])).toEqual([]);
    expect(await queryReportViews('p1', [], 'cs1')).toEqual([]);
    expect(apiPost).not.toHaveBeenCalled();
  });
});
