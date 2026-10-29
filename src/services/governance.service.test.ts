import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/http', () => ({
  apiGet: vi.fn(),
  LONG_TIMEOUT_MS: 120_000,
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  setDevUser: vi.fn(),
  setAuthToken: vi.fn(),
  setOnUnauthorized: vi.fn(),
  ApiError: class extends Error { status = 0; },
  apiErrorMessage: vi.fn(),
  isConflictError: vi.fn(),
}));
import { apiGet } from '@/services/http';
import { useSessionStore } from '@/store/useSessionStore';
import { columnImpact, searchTables } from './governance.service';

describe('searchTables · filtro por esquema (New table · Import existing)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ activeChangesetId: null });
    useSessionStore.setState({ activeProjectId: 'p1' });   // catálogo del proyecto
  });

  it('sin changeset activo manda schema como query param al catálogo del proyecto', async () => {
    vi.mocked(apiGet).mockResolvedValue([]);
    await searchTables('clie', 50, 'CORE');
    expect(apiGet).toHaveBeenCalledWith('/api/projects/p1/catalog/tables?q=clie&limit=50&schema=CORE');
  });

  it('sin proyecto activo, searchTables falla con mensaje claro (nunca busca global)', async () => {
    useSessionStore.setState({ activeProjectId: null });
    await expect(searchTables('x', 50)).rejects.toThrow('Open a project first.');
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('con changeset activo manda schema al estado efectivo (draft-aware)', async () => {
    useSessionStore.setState({ activeChangesetId: 'cs1' });
    vi.mocked(apiGet).mockResolvedValue([]);
    await searchTables('clie', 50, 'CORE');
    expect(apiGet).toHaveBeenCalledWith(
      '/api/changesets/cs1/effective/canonical_tables?q=clie&limit=50&schema=CORE');
  });

  it('sin schema no agrega el param', async () => {
    vi.mocked(apiGet).mockResolvedValue([]);
    await searchTables('clie', 50);
    expect(apiGet).toHaveBeenCalledWith('/api/projects/p1/catalog/tables?q=clie&limit=50');
  });
});

describe('columnImpact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ activeChangesetId: null });
  });

  it('sin changeset activo consulta solo por columnId', async () => {
    vi.mocked(apiGet).mockResolvedValue({ relationships: [], total: 0 });
    await columnImpact('c1');
    expect(apiGet).toHaveBeenCalledWith('/api/relationships/impact?columnId=c1');
  });

  it('con changeset activo agrega changesetId (overlay del working copy)', async () => {
    useSessionStore.setState({ activeChangesetId: 'cs1' });
    vi.mocked(apiGet).mockResolvedValue({ relationships: [], total: 0 });
    await columnImpact('c1');
    expect(apiGet).toHaveBeenCalledWith('/api/relationships/impact?columnId=c1&changesetId=cs1');
  });
});

describe('recordChangesBulk', () => {
  it('pasa el tamaño de tanda al servicio de versiones (el lote que va entero, en un request)', async () => {
    const csvc = await import('./changeset.service');
    const spy = vi.spyOn(csvc, 'recordChangesBulk').mockResolvedValue(undefined);
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1' });
    const { recordChangesBulk, bulk } = await import('./governance.service');
    await recordChangesBulk([bulk.deleteColumn('c1')], 1);
    expect(spy).toHaveBeenCalledWith('cs1', [bulk.deleteColumn('c1')], 1);
    spy.mockRestore();
  });
});

describe('currentColumns', () => {
  beforeEach(() => vi.mocked(apiGet).mockReset());

  it('lee por id en tandas de 100 (la URL no pasa el tope del servidor) y junta lo que existe', async () => {
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1' });
    vi.mocked(apiGet).mockImplementation(async (url: string) => {
      const ids = decodeURIComponent(new URL(url, 'http://x').searchParams.get('ids') ?? '').split(',');
      return ids.filter((id) => id !== 'h5').map((id) => ({ id })) as never;
    });
    const { currentColumns } = await import('./governance.service');
    const ids = Array.from({ length: 250 }, (_, i) => `h${i}`);
    const cols = await currentColumns(ids);
    expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(3);
    for (const [url] of vi.mocked(apiGet).mock.calls) {
      expect(decodeURIComponent(new URL(url as string, 'http://x').searchParams.get('ids') ?? '').split(',').length).toBeLessThanOrEqual(100);
    }
    expect(cols.map((c) => c.id)).toEqual(ids.filter((id) => id !== 'h5'));
  });

  it('sin ids o sin versión abierta no lee nada', async () => {
    const { currentColumns } = await import('./governance.service');
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: null });
    expect(await currentColumns(['h1'])).toEqual([]);
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1' });
    expect(await currentColumns([])).toEqual([]);
    expect(apiGet).not.toHaveBeenCalled();
  });
});
