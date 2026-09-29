// Doc 102: columnas por tandas de 300 tablas y vistas por tandas de 2 000, con
// los ids en el cuerpo; una vista con fuentes en dos tandas sale una sola vez.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/reporting.service', () => ({ queryReportColumns: vi.fn(), queryReportViews: vi.fn() }));
import { queryReportColumns, queryReportViews, type ReportViewRow } from '@/services/reporting.service';
import { fetchColumnsFor, fetchViewsFor } from './reportFetch';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
const view = (id: string, name: string, schema = 's'): ReportViewRow =>
  ({ id, name, schema, sourceTableIds: [], sourceTables: [], showOnCanvas: false, columns: [] });

beforeEach(() => vi.clearAllMocks());

describe('reportFetch', () => {
  it('columnas: tandas de 300 con la versión', async () => {
    vi.mocked(queryReportColumns).mockImplementation(async (_p, part) => part.map((t) => ({ tableId: t }) as never));
    const rows = await fetchColumnsFor('p1', ids(650), 'cs1');
    expect(vi.mocked(queryReportColumns).mock.calls.map(([, part, cs]) => [part.length, cs])).toEqual([[300, 'cs1'], [300, 'cs1'], [50, 'cs1']]);
    expect(rows).toHaveLength(650);
    expect(await fetchColumnsFor('p1', [], null)).toEqual([]);
  });
  it('vistas: tandas de 2 000, sin repetidas y en orden (esquema, nombre)', async () => {
    vi.mocked(queryReportViews)
      .mockResolvedValueOnce([view('v2', 'B'), view('v1', 'a')])
      .mockResolvedValueOnce([view('v2', 'B'), view('v3', 'C', 'r')]);
    const rows = await fetchViewsFor('p1', ids(2500), null);
    expect(vi.mocked(queryReportViews).mock.calls.map(([, part]) => part.length)).toEqual([2000, 500]);
    expect(rows.map((v) => v.id)).toEqual(['v3', 'v1', 'v2']);
  });
});
