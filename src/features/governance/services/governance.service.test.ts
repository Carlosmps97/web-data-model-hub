import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/http', () => ({
  apiGet: vi.fn(),
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
import { useChangesetStore } from '@/store/useChangesetStore';
import { columnImpact, searchTables } from './governance.service';

describe('searchTables · filtro por esquema (New table · Import existing)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChangesetStore.setState({ activeId: null });
  });

  it('sin changeset activo manda schema como query param al catálogo', async () => {
    vi.mocked(apiGet).mockResolvedValue([]);
    await searchTables('clie', 50, 'CORE');
    expect(apiGet).toHaveBeenCalledWith('/api/catalog/tables?q=clie&limit=50&schema=CORE');
  });

  it('con changeset activo manda schema al estado efectivo (draft-aware)', async () => {
    useChangesetStore.setState({ activeId: 'cs1' });
    vi.mocked(apiGet).mockResolvedValue([]);
    await searchTables('clie', 50, 'CORE');
    expect(apiGet).toHaveBeenCalledWith(
      '/api/changesets/cs1/effective/canonical_tables?q=clie&limit=50&schema=CORE');
  });

  it('sin schema no agrega el param (contrato original)', async () => {
    vi.mocked(apiGet).mockResolvedValue([]);
    await searchTables('clie', 50);
    expect(apiGet).toHaveBeenCalledWith('/api/catalog/tables?q=clie&limit=50');
  });
});

describe('columnImpact (spec 10 §8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChangesetStore.setState({ activeId: null });
  });

  it('sin changeset activo consulta sólo por columnId', async () => {
    vi.mocked(apiGet).mockResolvedValue({ relationships: [], total: 0 });
    await columnImpact('c1');
    expect(apiGet).toHaveBeenCalledWith('/api/relationships/impact?columnId=c1');
  });

  it('con changeset activo agrega changesetId (overlay del working copy)', async () => {
    useChangesetStore.setState({ activeId: 'cs1' });
    vi.mocked(apiGet).mockResolvedValue({ relationships: [], total: 0 });
    await columnImpact('c1');
    expect(apiGet).toHaveBeenCalledWith('/api/relationships/impact?columnId=c1&changesetId=cs1');
  });
});
