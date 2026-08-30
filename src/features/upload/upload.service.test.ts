// Servicio de la carga masiva (doc 55 §7-8): rutas bajo el changeset y
// polling del job hasta un estado terminal, cancelable y sin tragarse errores.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/services/http', () => ({
  apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(),
  setDevUser: vi.fn(), setAuthToken: vi.fn(), setOnUnauthorized: vi.fn(),
  ApiError: class extends Error { status = 0; },
  apiErrorMessage: vi.fn(), isConflictError: vi.fn(),
}));

import { apiGet, apiPost, apiDelete } from '@/services/http';
import {
  startUpload, getUploadJob, applyUpload, discardUpload, pollUploadJob, isTerminal, type UploadJob,
} from './upload.service';

const job = (status: UploadJob['status']): UploadJob => ({
  id: 'j1', csId: 'c1', fileName: 'f.xlsx', status,
  progress: { phase: 'x', done: 0, total: 0 }, report: null, result: null, error: null,
  createdAt: '2026-08-28T00:00:00Z', updatedAt: '2026-08-28T00:00:00Z',
});

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('upload.service routes', () => {
  it('hang off the changeset uploads path', async () => {
    vi.mocked(apiPost).mockResolvedValue(job('validating'));
    await startUpload('c 1', { fileName: 'f.xlsx', sheets: {} });
    expect(apiPost).toHaveBeenCalledWith('/api/changesets/c%201/uploads', { fileName: 'f.xlsx', sheets: {} });
    vi.mocked(apiGet).mockResolvedValue(job('validated'));
    await getUploadJob('c1', 'j1');
    expect(apiGet).toHaveBeenCalledWith('/api/changesets/c1/uploads/j1');
    await applyUpload('c1', 'j1');
    expect(apiPost).toHaveBeenLastCalledWith('/api/changesets/c1/uploads/j1/apply');
    vi.mocked(apiDelete).mockResolvedValue({ deleted: true });
    await discardUpload('c1', 'j1');
    expect(apiDelete).toHaveBeenCalledWith('/api/changesets/c1/uploads/j1');
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
