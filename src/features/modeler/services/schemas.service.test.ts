// El alta de un esquema desde un combo solo entra a una versión en edición:
// sin ella rechaza y no escribe directo a producción.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/http', () => ({
  apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(),
  setDevUser: vi.fn(), setAuthToken: vi.fn(), setOnUnauthorized: vi.fn(),
  ApiError: class extends Error { status = 0; }, apiErrorMessage: vi.fn(), isConflictError: vi.fn(),
  LONG_TIMEOUT_MS: 120_000,
}));
vi.mock('@/services/changeset.service', () => ({ recordChange: vi.fn(async () => ({})), effective: vi.fn(), announceDraftWrite: vi.fn() }));

import { apiDelete, apiPost } from '@/services/http';
import * as csvc from '@/services/changeset.service';
import { useSessionStore } from '@/store/useSessionStore';
import { createSchema, createSchemaInVersion, deleteSchema, setSchemaKind } from './schemas.service';

beforeEach(() => { vi.clearAllMocks(); });

describe('setSchemaKind', () => {
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

// Borrar un esquema va por su endpoint (revisa el uso en el servidor); la
// escritura se avisa como las de `changeset.service`, con el número que devuelve.
describe('deleteSchema', () => {
  it('avisa su escritura con el número que devuelve el endpoint; sin número si falla', async () => {
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1' });
    vi.mocked(apiPost).mockResolvedValueOnce({ deleted: true, writeSeq: 8 });
    await deleteSchema('s1');
    expect(apiPost).toHaveBeenCalledWith(expect.stringMatching(/\/api\/changesets\/cs1\/schemas\/s1\/delete$/));
    expect(csvc.announceDraftWrite).toHaveBeenCalledWith('cs1', [{ collection: 'schemas', entityId: 's1', op: 'delete' }], 8);
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('in use'));
    await expect(deleteSchema('s2')).rejects.toThrow('in use');
    expect(csvc.announceDraftWrite).toHaveBeenLastCalledWith('cs1', [{ collection: 'schemas', entityId: 's2', op: 'delete' }], undefined);
  });
});

describe('createSchemaInVersion', () => {
  it('sin una versión en edición rechaza y no escribe nada', async () => {
    useSessionStore.setState({ openMode: 'readonly', activeChangesetId: 'cs1' });
    await expect(createSchemaInVersion('stg_x', 'tables')).rejects.toThrow('version in edit mode');
    expect(csvc.recordChange).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
  });
  it('en edición registra el cambio en el changeset activo, con su kind', async () => {
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1' });
    const s = await createSchemaInVersion('stg_x', 'views');
    expect(s).toMatchObject({ name: 'stg_x', kind: 'views' });
    expect(csvc.recordChange).toHaveBeenCalledWith('cs1', 'schemas', s.id, 'upsert', expect.objectContaining({ name: 'stg_x', kind: 'views' }));
    expect(apiPost).not.toHaveBeenCalled();
  });
});

describe('gestor de esquemas sin sesión de edición', () => {
  it('crear y eliminar rechazan y no escriben directo a producción', async () => {
    useSessionStore.setState({ openMode: 'readonly', activeChangesetId: null });
    await expect(createSchema('stg_x', undefined, 'tables')).rejects.toThrow('version in edit mode');
    await expect(deleteSchema('s1')).rejects.toThrow('version in edit mode');
    expect(apiPost).not.toHaveBeenCalled();
    expect(apiDelete).not.toHaveBeenCalled();
    expect(csvc.recordChange).not.toHaveBeenCalled();
  });
});
