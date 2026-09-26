// Final review (doc 96): el alta de un esquema desde un combo SOLO entra a una
// versión en edición — sin ella rechaza y no escribe directo a producción.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/http', () => ({
  apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(),
  setDevUser: vi.fn(), setAuthToken: vi.fn(), setOnUnauthorized: vi.fn(),
  ApiError: class extends Error { status = 0; }, apiErrorMessage: vi.fn(), isConflictError: vi.fn(),
  LONG_TIMEOUT_MS: 120_000,
}));
vi.mock('@/services/changeset.service', () => ({ recordChange: vi.fn(async () => ({})), effective: vi.fn() }));

import { apiPost } from '@/services/http';
import * as csvc from '@/services/changeset.service';
import { useSessionStore } from '@/store/useSessionStore';
import { createSchemaInVersion } from './schemas.service';

beforeEach(() => { vi.clearAllMocks(); });

describe('createSchemaInVersion', () => {
  it('sin una versión en edición rechaza y no escribe nada', async () => {
    useSessionStore.setState({ openMode: 'readonly', activeChangesetId: 'cs1' });
    await expect(createSchemaInVersion('bcp_x', 'tables')).rejects.toThrow('version in edit mode');
    expect(csvc.recordChange).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
  });
  it('en edición registra el cambio en el changeset activo, con su kind', async () => {
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1' });
    const s = await createSchemaInVersion('bcp_x', 'views');
    expect(s).toMatchObject({ name: 'bcp_x', kind: 'views' });
    expect(csvc.recordChange).toHaveBeenCalledWith('cs1', 'schemas', s.id, 'upsert', expect.objectContaining({ name: 'bcp_x', kind: 'views' }));
    expect(apiPost).not.toHaveBeenCalled();
  });
});
