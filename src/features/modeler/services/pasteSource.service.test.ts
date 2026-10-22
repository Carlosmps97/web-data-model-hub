import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/http';

vi.mock('@/features/standards/standards.service', () => ({ getSnapshot: vi.fn() }));
import { getSnapshot } from '@/features/standards/standards.service';
import { loadSourceStandards } from './pasteSource.service';

describe('loadSourceStandards', () => {
  it('UDP, dominios y themes del proyecto de origen, de su snapshot', async () => {
    vi.mocked(getSnapshot).mockResolvedValueOnce({
      udp: [{ id: 'u' }], domains: [{ id: 'd' }], themes: [{ id: 't' }], dict: [], namingConfig: {},
    } as never);
    await expect(loadSourceStandards('pA')).resolves.toEqual({ udpDefs: [{ id: 'u' }], domains: [{ id: 'd' }], themes: [{ id: 't' }] });
    expect(getSnapshot).toHaveBeenCalledWith('pA');
  });

  it('un snapshot sin themes devuelve themes vacío', async () => {
    vi.mocked(getSnapshot).mockResolvedValueOnce({ udp: [], domains: [], dict: [], namingConfig: {} } as never);
    await expect(loadSourceStandards('pA')).resolves.toEqual({ udpDefs: [], domains: [], themes: [] });
  });

  it('el proyecto ya no existe (404) o no se puede ver (403): null — se pega lo que no los necesita', async () => {
    vi.mocked(getSnapshot).mockRejectedValueOnce(new ApiError('Project not found.', 404));
    await expect(loadSourceStandards('gone')).resolves.toBeNull();
    vi.mocked(getSnapshot).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    await expect(loadSourceStandards('hidden')).resolves.toBeNull();
  });

  it('otra falla (red, timeout, 500) sube: el popup la muestra con Retry', async () => {
    vi.mocked(getSnapshot).mockRejectedValueOnce(new ApiError('Server error', 500));
    await expect(loadSourceStandards('pA')).rejects.toThrow('Server error');
    vi.mocked(getSnapshot).mockRejectedValueOnce(new Error('Network error'));
    await expect(loadSourceStandards('pA')).rejects.toThrow('Network error');
  });
});
