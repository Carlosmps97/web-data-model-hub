// Servicio de la carga masiva (doc 55 §7-8): rutas bajo el changeset y
// polling del job hasta un estado terminal, cancelable y sin tragarse errores.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/services/http', () => {
  class ApiError extends Error { status = 0; detail: unknown = null; constructor(m: string, status = 0, detail: unknown = null) { super(m); this.status = status; this.detail = detail; } }
  return {
    apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(),
    setDevUser: vi.fn(), setAuthToken: vi.fn(), setOnUnauthorized: vi.fn(),
    ApiError, apiErrorMessage: vi.fn(), isConflictError: vi.fn(),
    // el real (doc 105, ronda 5): red, timeout o 5xx
    isTransientError: (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status >= 500),
  };
});

import { apiGet, apiPost, apiPut, apiDelete, ApiError } from '@/services/http';
import {
  startUpload, getUploadJob, applyUpload, discardUpload, getUploadTargets, pollUploadJob, isTerminal, profileProblemsOf,
  listProfiles, createProfile, updateProfile, deleteProfile, setDefaultProfile, validateProfile, suggestMappings,
  createDefaultProfile, getProfileCatalog, type UploadJob, type UploadProfileBody,
} from './upload.service';

const BODY: UploadProfileBody = {
  name: 'P', isDefault: false,
  sheets: { tables: { name: 'T', required: true, headerRow: 5, mappings: [] }, columns: { name: 'C', required: true, headerRow: 5, mappings: [] } },
  policies: { onExistingTable: 'update', onExistingColumn: 'update', unknownHeaders: 'warn' },
};

const job = (status: UploadJob['status']): UploadJob => ({
  id: 'j1', csId: 'c1', fileName: 'f.xlsx', status,
  progress: { phase: 'x', done: 0, total: 0 }, report: null, result: null, error: null,
  createdAt: '2026-08-28T00:00:00Z', updatedAt: '2026-08-28T00:00:00Z',
});

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('upload.service routes', () => {
  it('reads the target projects under the uploads path (doc 87)', async () => {
    vi.mocked(apiGet).mockResolvedValue({ mode: 'choose', candidates: [] });
    await getUploadTargets('c 1');
    expect(apiGet).toHaveBeenCalledWith('/api/changesets/c%201/uploads/targets');
  });

  it('hang off the changeset uploads path', async () => {
    vi.mocked(apiPost).mockResolvedValue(job('validating'));
    const raw = { fileName: 'f.xlsx', profileId: 'pf', sheets: [{ name: 'Cargar_Tablas', rows: [{ row: 5, cells: ['', 'TABLA_LOGICO'] }] }] };
    await startUpload('c 1', raw);
    expect(apiPost).toHaveBeenCalledWith('/api/changesets/c%201/uploads', raw);
    vi.mocked(apiGet).mockResolvedValue(job('validated'));
    await getUploadJob('c1', 'j1');
    expect(apiGet).toHaveBeenCalledWith('/api/changesets/c1/uploads/j1');
    await applyUpload('c1', 'j1');
    expect(apiPost).toHaveBeenLastCalledWith('/api/changesets/c1/uploads/j1/apply');
    vi.mocked(apiDelete).mockResolvedValue({ deleted: true });
    await discardUpload('c1', 'j1');
    expect(apiDelete).toHaveBeenCalledWith('/api/changesets/c1/uploads/j1');
    // Doc 105 (ronda 8): sólo si sigue validado (409 si la carga ya empezó o terminó).
    await discardUpload('c1', 'j1', { onlyIfValidated: true });
    expect(apiDelete).toHaveBeenLastCalledWith('/api/changesets/c1/uploads/j1?status=validated');
  });

  it('profiles: project-scoped URLs and verbs', async () => {
    vi.mocked(apiGet).mockResolvedValue([]); vi.mocked(apiPost).mockResolvedValue({}); vi.mocked(apiPut).mockResolvedValue({}); vi.mocked(apiDelete).mockResolvedValue({});
    await listProfiles('p 1'); await createProfile('p1', BODY); await updateProfile('p1', 'a', BODY); await deleteProfile('p1', 'a');
    await setDefaultProfile('p1', 'a'); await validateProfile('p1', BODY); await suggestMappings('p1', 'tables', ['X']);
    await createDefaultProfile('p1'); await getProfileCatalog('p1');
    expect(apiGet).toHaveBeenCalledWith('/api/projects/p%201/upload-profiles');
    expect(apiPost).toHaveBeenCalledWith('/api/projects/p1/upload-profiles', BODY);
    expect(apiPut).toHaveBeenCalledWith('/api/projects/p1/upload-profiles/a', BODY);
    expect(apiDelete).toHaveBeenCalledWith('/api/projects/p1/upload-profiles/a');
    expect(apiPost).toHaveBeenCalledWith('/api/projects/p1/upload-profiles/a/default');
    expect(apiPost).toHaveBeenCalledWith('/api/projects/p1/upload-profiles/validate', BODY);
    expect(apiPost).toHaveBeenCalledWith('/api/projects/p1/upload-profiles/suggest', { sheet: 'tables', headers: ['X'] });
    expect(apiPost).toHaveBeenCalledWith('/api/projects/p1/upload-profiles/default');
    expect(apiGet).toHaveBeenCalledWith('/api/projects/p1/upload-profiles/catalog');
  });

  it('profileProblemsOf reads the 422 detail and ignores other errors', () => {
    const problems = [{ path: 'name', code: 'name-empty', message: 'm' }];
    expect(profileProblemsOf(new ApiError('bad', 422, { message: 'x', problems }))).toEqual(problems);
    expect(profileProblemsOf(new ApiError('conflict', 409, 'taken'))).toEqual([]);
    expect(profileProblemsOf(new ApiError('bad', 422, 'plain text'))).toEqual([]);
    expect(profileProblemsOf(new Error('boom'))).toEqual([]);
  });

  it('isTerminal covers validated / applied / failed only', () => {
    expect(['validated', 'applied', 'failed'].every((s) => isTerminal(s as UploadJob['status']))).toBe(true);
    expect(isTerminal('validating')).toBe(false);
    expect(isTerminal('applying')).toBe(false);
  });
});

describe('pollUploadJob', () => {
  it('resolves on the first terminal state and reports every tick', async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce(job('validating'))
      .mockResolvedValueOnce(job('validating'))
      .mockResolvedValueOnce(job('validated'));
    const ticks: string[] = [];
    const p = pollUploadJob('c1', 'j1', { onTick: (j) => ticks.push(j.status), intervalMs: 500 });
    await vi.advanceTimersByTimeAsync(2000);
    const out = await p;
    expect(out.status).toBe('validated');
    expect(ticks).toEqual(['validating', 'validating', 'validated']);
    expect(apiGet).toHaveBeenCalledTimes(3);
  });

  it('stops when the signal is aborted', async () => {
    vi.mocked(apiGet).mockResolvedValue(job('applying'));
    const ac = new AbortController();
    const p = pollUploadJob('c1', 'j1', { intervalMs: 500, signal: ac.signal });
    const rejected = p.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(600);
    ac.abort();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await rejected).toMatch(/aborted/i);
    expect(vi.mocked(apiGet).mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('propagates API errors (e.g. the job expired → 404)', async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error('Upload not found'));
    await expect(pollUploadJob('c1', 'j1', { intervalMs: 100 })).rejects.toThrow('Upload not found');
  });
});

// Doc 105 (ronda 5, R15-H2): un GET caído mientras se aplica (red, timeout,
// 5xx) NO es el resultado de la carga — el servidor la sigue aplicando. Antes
// el polling lo propagaba y el popup la daba por fallida: sin arrange, sin
// refresco del Explorer y sin vaciar el Undo (una inversa vieja pisaba lo
// cargado). Ahora reintenta hasta un estado terminal; un 404 (el job ya no
// está) sí es falla real; tras varios transitorios seguidos se rinde.
describe('pollUploadJob reintenta los fallos transitorios (doc 105, ronda 5)', () => {
  beforeEach(() => { vi.mocked(apiGet).mockReset(); });

  it('red o timeout (status 0) y 5xx: sigue hasta el estado terminal', async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce(job('applying'))
      .mockRejectedValueOnce(new ApiError('timeout', 0))
      .mockRejectedValueOnce(new ApiError('Bad gateway', 502))
      .mockResolvedValueOnce(job('applied'));
    const p = pollUploadJob('c1', 'j1', { intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(5000);
    expect((await p).status).toBe('applied');
    expect(apiGet).toHaveBeenCalledTimes(4);
  });

  it('un 404 (el job ya no está) es falla real: no reintenta', async () => {
    vi.mocked(apiGet).mockRejectedValueOnce(new ApiError('Upload not found', 404));
    await expect(pollUploadJob('c1', 'j1', { intervalMs: 100 })).rejects.toThrow('Upload not found');
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('se rinde tras varios transitorios SEGUIDOS (propaga el último)', async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiError('timeout', 0));
    const out = pollUploadJob('c1', 'j1', { intervalMs: 100, maxTransient: 3 }).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await out).toBe('timeout');
    expect(apiGet).toHaveBeenCalledTimes(4);                  // 1 + 3 reintentos
  });

  it('una respuesta buena en el medio reinicia la cuenta', async () => {
    vi.mocked(apiGet)
      .mockRejectedValueOnce(new ApiError('timeout', 0)).mockRejectedValueOnce(new ApiError('timeout', 0))
      .mockResolvedValueOnce(job('applying'))
      .mockRejectedValueOnce(new ApiError('timeout', 0)).mockRejectedValueOnce(new ApiError('timeout', 0))
      .mockResolvedValueOnce(job('applied'));
    const p = pollUploadJob('c1', 'j1', { intervalMs: 100, maxTransient: 2 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await p).status).toBe('applied');
  });
});
