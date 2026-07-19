/**
 * admin.service — módulo Admin (usuarios + roles + matriz). Backend
 * `/api/admin/*`, todo gated por `admin.manage` (el módulo solo lo ve el admin).
 */
import { apiGet, apiPost, apiPut, apiDelete } from '@/services/http';
import type { Permission } from '@/features/auth/auth.service';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const ADMIN = `${API_BASE}/api/admin`;

export interface AdminUser {
  id: string;               // username
  email: string;
  name: string;
  role: string;             // role key
  projectIds: string[];
  status: 'active' | 'invited' | 'disabled' | string;
  initials?: string | null;
}

export interface Role {
  id: string;               // role key
  name: string;
  description?: string | null;
  permissions: Record<string, boolean>;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  target?: string;
  targetType?: string;
  meta?: Record<string, unknown>;
}

export interface CreateUserInput {
  username: string; email: string; name: string; role: string; password: string;
  projectIds?: string[]; status?: string;
}
export interface UpdateUserInput {
  email?: string; name?: string; role?: string; projectIds?: string[]; status?: string; password?: string;
}

// ── Users ──
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
export const getAudit = (limit = 200) => apiGet<AuditEntry[]>(`${ADMIN}/audit?limit=${limit}`);

/** Etiquetas legibles de cada permiso (filas de la matriz, pantalla 14 + R10). */
export const PERMISSION_LABELS: Record<string, string> = {
  'model.view': 'Ver modelo / Canvas',
  'model.edit': 'Create / edit tables',
  'review.decide': 'Aprobar / rechazar solicitudes',
  'publish': 'Publish to production',
  'rollback': 'Roll back to a published version',
  'export': 'Exportar DDL / metadata',
  'standards.edit': 'Edit Data Standards',
  'admin.manage': 'Manage users and permissions',
};
