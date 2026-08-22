import { create } from 'zustand';
import { getMe } from '@/services/identity.service';
import type { Principal } from '@/types/identity';

interface IdentityState {
  principal: Principal | null;
  loading: boolean;
  loaded: boolean;
  /** Carga la identidad una sola vez (idempotente). */
  loadIdentity: () => Promise<void>;
}

export const useIdentityStore = create<IdentityState>((set, get) => ({
  principal: null,
  loading: false,
  loaded: false,
  loadIdentity: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    try {
      const principal = await getMe();
      set({ principal, loaded: true });
    } catch {
      // MVP: si /api/me falla, la app sigue (la identidad real llega en Databricks).
      set({ loaded: true });
    } finally {
      set({ loading: false });
    }
  },
}));
