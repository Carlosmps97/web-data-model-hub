/**
 * Admin-only service for user management. All methods go through
 * `/api/admin/users`; the backend enforces the admin role, so a
 * non-admin hitting these will get a 403.
 */

import type { AuthUser, Permission, UserRole } from '@/types/auth';
import { apiDelete, apiGet, apiPost, apiPut } from './http';

export interface CreateUserPayload {
  username: string;
  password: string;
  role: UserRole;
  isActive?: boolean;
  permissions?: Permission[];
}

export interface UpdateUserPayload {
  username?: string;
  password?: string;
  role?: UserRole;
  isActive?: boolean;
  permissions?: Permission[];
}

export const adminService = {
  async listUsers(): Promise<AuthUser[]> {
    return apiGet<AuthUser[]>('/api/admin/users');
  },

  async createUser(payload: CreateUserPayload): Promise<AuthUser> {
    return apiPost<AuthUser>('/api/admin/users', payload);
  },

  async updateUser(id: string, payload: UpdateUserPayload): Promise<AuthUser> {
    return apiPut<AuthUser>(`/api/admin/users/${encodeURIComponent(id)}`, payload);
  },

  async deleteUser(id: string): Promise<void> {
    await apiDelete<void>(`/api/admin/users/${encodeURIComponent(id)}`);
  },
};
