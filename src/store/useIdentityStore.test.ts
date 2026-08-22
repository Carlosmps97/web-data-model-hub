import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/identity.service', () => ({ getMe: vi.fn() }));
import { getMe } from '@/services/identity.service';
import { useIdentityStore } from './useIdentityStore';

const fake = { email: 'dev@local', username: 'dev', display_name: 'dev', source: 'local' };

describe('useIdentityStore', () => {
  beforeEach(() => {
    useIdentityStore.setState({ principal: null, loading: false, loaded: false });
    vi.clearAllMocks();
  });

  it('carga el principal desde /api/me', async () => {
    vi.mocked(getMe).mockResolvedValue(fake);
    await useIdentityStore.getState().loadIdentity();
    expect(useIdentityStore.getState().principal?.email).toBe('dev@local');
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it('no re-fetchea una vez cargado', async () => {
    vi.mocked(getMe).mockResolvedValue(fake);
    await useIdentityStore.getState().loadIdentity();
    await useIdentityStore.getState().loadIdentity();
    expect(getMe).toHaveBeenCalledTimes(1);
  });
});
