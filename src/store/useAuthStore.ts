/**
 * Zustand store that holds the current auth session.
 *
 * `hydrate()` is meant to be called once at app start (AppLayout).
 * It calls `/api/auth/me` and populates the store; a `null` result
 * means no valid session.
 *
 * The permission helpers (`canEditProject`, etc.) are exposed on the
 * store for convenience — they're just thin wrappers over the pure
 * functions in `@/lib/auth/permissions`, bound to the current `user`.
 */

import { create } from 'zustand';
import type { AuthUser } from '@/types/auth';
import { authService } from '@/services';
import {
  canEditProject as canEditProjectFn,
  canViewProject as canViewProjectFn,
  isAdmin as isAdminFn,
} from '@/lib/auth/permissions';

interface AuthState {
  user: AuthUser | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;

  hydrate: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;

  // Convenience selectors
  isAdmin: () => boolean;
  canViewProject: (projectId: string) => boolean;
  canEditProject: (projectId: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: 'idle',
  error: null,

  async hydrate() {
    if (get().status === 'loading') return;
    set({ status: 'loading', error: null });
    try {
      const user = await authService.getCurrentUser();
      set({ user, status: 'ready', error: null });
    } catch (err) {
      set({
        user: null,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async login(username, password) {
    set({ status: 'loading', error: null });
    try {
      const user = await authService.login({ username, password });
      set({ user, status: 'ready', error: null });
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err; // surface to caller for UI feedback
    }
  },

  async logout() {
    try {
      await authService.logout();
    } finally {
      set({ user: null, status: 'ready', error: null });
    }
  },

  setUser(user) {
    set({ user, status: 'ready', error: null });
  },

  isAdmin() {
    return isAdminFn(get().user);
  },
  canViewProject(projectId) {
    return canViewProjectFn(get().user, projectId);
  },
  canEditProject(projectId) {
    return canEditProjectFn(get().user, projectId);
  },
}));
