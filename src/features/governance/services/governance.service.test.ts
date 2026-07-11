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
import { columnImpact } from './governance.service';

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
