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

import { apiDelete, apiPost } from '@/services/http';
import * as csvc from '@/services/changeset.service';
import { useSessionStore } from '@/store/useSessionStore';
import { createSchema, createSchemaInVersion, deleteSchema, setSchemaKind } from './schemas.service';

beforeEach(() => { vi.clearAllMocks(); });

describe('setSchemaKind (doc 119)', () => {
  it('lo registra server-side con el kind declarado nuevo (la versión arma el doc efectivo; el cliente no manda el doc)', async () => {
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1' });
    await setSchemaKind('s1', 'views');
    expect(apiPost).toHaveBeenCalledWith(expect.stringMatching(/\/api\/changesets\/cs1\/schemas\/s1\/kind$/), { kind: 'views' });
    expect(csvc.recordChange).not.toHaveBeenCalled();
  });

  it('sin una versión en edición rechaza y no escribe nada', async () => {
    useSessionStore.setState({ openMode: 'readonly', activeChangesetId: 'cs1' });
    await expect(setSchemaKind('s1', 'views')).rejects.toThrow('version in edit mode');
    expect(apiPost).not.toHaveBeenCalled();
    expect(csvc.recordChange).not.toHaveBeenCalled();
  });
});

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

describe('gestor de esquemas sin sesión de edición (doc 104, ronda 2)', () => {
  it('crear y eliminar rechazan y no escriben directo a producción', async () => {
    useSessionStore.setState({ openMode: 'readonly', activeChangesetId: null });
    await expect(createSchema('bcp_x', undefined, 'tables')).rejects.toThrow('version in edit mode');
    await expect(deleteSchema('s1')).rejects.toThrow('version in edit mode');
    expect(apiPost).not.toHaveBeenCalled();
    expect(apiDelete).not.toHaveBeenCalled();
    expect(csvc.recordChange).not.toHaveBeenCalled();
  });
});
