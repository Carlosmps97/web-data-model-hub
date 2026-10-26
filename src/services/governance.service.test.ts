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
