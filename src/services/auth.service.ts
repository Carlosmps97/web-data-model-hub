/**
 * Client-side auth service. Thin wrappers over the `/api/auth/*`
 * endpoints. All methods return plain data; the HTTP error shape is
 * preserved via `ApiError` from `./http`.
 */

import type { AuthUser } from '@/types/auth';
import { apiGet, apiPost, type ApiError } from './http';

export interface LoginPayload {
  username: string;
  password: string;
}

export const authService = {
  async login(payload: LoginPayload): Promise<AuthUser> {
    return apiPost<AuthUser>('/api/auth/login', payload);
  },

  async logout(): Promise<void> {
    await apiPost<void>('/api/auth/logout', {});
  },

  /**
   * Hydrates the current session. Returns `null` when not logged in
   * (the 401 gets translated so callers don't need try/catch).
   */
  async getCurrentUser(): Promise<AuthUser | null> {
    try {
      return await apiGet<AuthUser>('/api/auth/me');
    } catch (err) {
      if ((err as ApiError).status === 401) return null;
      throw err;
    }
  },
};
