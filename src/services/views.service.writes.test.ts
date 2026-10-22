// Crear, editar o borrar una vista va siempre por la versión en edición. Un popup
// que sigue abierto cuando la sesión se degrada (versión transferida, eliminada o
// enviada) no debe escribir directo a producción.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/http', () => ({
  apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(),
  setDevUser: vi.fn(), setAuthToken: vi.fn(), setOnUnauthorized: vi.fn(),
  ApiError: class extends Error { status = 0; }, apiErrorMessage: vi.fn(), isConflictError: vi.fn(),
  LONG_TIMEOUT_MS: 120_000,
}));
vi.mock('./http', () => ({
  apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(),
}));
vi.mock('@/services/changeset.service', () => ({ recordChange: vi.fn(async () => ({})), effective: vi.fn() }));

import * as http from './http';
import * as csvc from '@/services/changeset.service';
import { useSessionStore } from '@/store/useSessionStore';
import { createView, deleteView, updateView } from './views.service';

const body = { name: 'V_X', schema: 'STG_VU', sourceTableIds: ['t1'], sources: [] } as never;

beforeEach(() => { vi.clearAllMocks(); });

describe('escrituras de vistas', () => {
  it('sin sesión de edición rechazan y no tocan producción', async () => {
    for (const s of [{ openMode: 'readonly', activeChangesetId: null }, { openMode: 'readonly', activeChangesetId: 'cs1' }] as const) {
      useSessionStore.setState(s);
      await expect(createView(body)).rejects.toThrow('version in edit mode');
      await expect(updateView('v1', body)).rejects.toThrow('version in edit mode');
      await expect(deleteView('v1')).rejects.toThrow('version in edit mode');
    }
    expect(http.apiPost).not.toHaveBeenCalled();
    expect(http.apiPut).not.toHaveBeenCalled();
    expect(http.apiDelete).not.toHaveBeenCalled();
    expect(csvc.recordChange).not.toHaveBeenCalled();
  });

  it('en edición van a la working copy', async () => {
    useSessionStore.setState({ openMode: 'editing', activeChangesetId: 'cs1' });
    await createView(body);
    await updateView('v1', body);
    await deleteView('v1');
    expect(vi.mocked(csvc.recordChange).mock.calls.map((c) => [c[0], c[1], c[3]]))
      .toEqual([['cs1', 'views', 'upsert'], ['cs1', 'views', 'upsert'], ['cs1', 'views', 'delete']]);
  });
});
