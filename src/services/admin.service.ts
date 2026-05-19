import type { AuthUser, Permission, UserRole } from '@/types/auth';
import { apiDelete, apiGet, apiPost, apiPut } from './http';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

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
    return apiGet<AuthUser[]>(`${API_BASE}/api/admin/users`);
  },

  async createUser(payload: CreateUserPayload): Promise<AuthUser> {
    return apiPost<AuthUser>(`${API_BASE}/api/admin/users`, payload);
  },

  async updateUser(id: string, payload: UpdateUserPayload): Promise<AuthUser> {
    return apiPut<AuthUser>(`${API_BASE}/api/admin/users/${encodeURIComponent(id)}`, payload);
  },

  async deleteUser(id: string): Promise<void> {
    await apiDelete<void>(`${API_BASE}/api/admin/users/${encodeURIComponent(id)}`);
  },
};
