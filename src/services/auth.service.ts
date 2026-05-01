import type { AuthUser } from '@/types/auth';
import { apiGet, apiPost, type ApiError } from './http';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export interface LoginPayload {
  username: string;
  password: string;
}

export const authService = {
  async login(payload: LoginPayload): Promise<AuthUser> {
    return apiPost<AuthUser>(`${API_BASE}/api/auth/login`, payload);
  },

  async logout(): Promise<void> {
    await apiPost<void>(`${API_BASE}/api/auth/logout`, {});
  },

  async getCurrentUser(): Promise<AuthUser | null> {
    try {
      return await apiGet<AuthUser>(`${API_BASE}/api/auth/me`);
    } catch (err) {
      if ((err as ApiError).status === 401) return null;
      throw err;
    }
  },
};
