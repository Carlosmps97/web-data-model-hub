/**
 * admin.service — módulo Admin (usuarios + roles + matriz). Backend
 * `/api/admin/*`, todo protegido por `admin.manage` (el módulo solo lo ve el admin).
 */
import { apiGet, apiPost, apiPut, apiDelete } from '@/services/http';
import type { Permission } from '@/features/auth/auth.service';

import { API_BASE } from '@/services/apiBase';
const ADMIN = `${API_BASE}/api/admin`;

export interface AdminUser {
  id: string;               // username: el correo, en minúsculas
  email: string;
  name: string;
  role: string;             // clave del rol
  projectIds: string[];
  status: 'active' | 'invited' | 'disabled' | string;
  initials?: string | null;
}

export interface Role {
  id: string;               // clave del rol
  name: string;
  description?: string | null;
  permissions: Record<string, boolean>;
}

/** Alta en la whitelist: correo + rol. */
export interface CreateUserInput {
  username: string; role: string; email?: string; name?: string;
  projectIds?: string[]; status?: string;
}
export interface UpdateUserInput {
  email?: string; name?: string; role?: string; projectIds?: string[]; status?: string;
}

// ── Usuarios ──
export const listUsers = () => apiGet<AdminUser[]>(`${ADMIN}/users`);
export const createUser = (body: CreateUserInput) => apiPost<AdminUser>(`${ADMIN}/users`, body);
export const updateUser = (username: string, body: UpdateUserInput) =>
  apiPut<AdminUser>(`${ADMIN}/users/${encodeURIComponent(username)}`, body);
export const deleteUser = (username: string) => apiDelete<{ id: string }>(`${ADMIN}/users/${encodeURIComponent(username)}`);

// ── Roles + matriz ──
export const listRoles = () => apiGet<Role[]>(`${ADMIN}/roles`);
export const upsertRole = (key: string, body: { name: string; description?: string; permissions: Record<string, boolean> }) =>
  apiPut<Role>(`${ADMIN}/roles/${encodeURIComponent(key)}`, body);
export const deleteRole = (key: string) => apiDelete<{ id: string }>(`${ADMIN}/roles/${encodeURIComponent(key)}`);

// ── Catálogo de permisos (columnas/filas de la matriz) + auditoría ──
export const getPermissions = () => apiGet<Permission[]>(`${ADMIN}/permissions`);

/** Etiquetas legibles de cada permiso (filas de la matriz). */
export const PERMISSION_LABELS: Record<string, string> = {
  'model.view': 'View model / canvas',
  'model.edit': 'Create / edit tables',
  'review.decide': 'Approve / reject requests (approving publishes to production)',
  'rollback': 'Roll back to a published version',
  'versions.view_all': "Open other users' drafts and requests in the canvas",
  'export': 'Export DDL / metadata',
  'standards.edit': 'Edit Data Standards',
  'admin.manage': 'Manage users and permissions',
};
