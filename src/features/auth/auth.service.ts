/**
 * auth.service — login usuario/contraseña + sesión por token (auth propia).
 *
 * Backend (envelope `{success,data}`):
 *   POST /api/auth/login  {username, password} → { token, user }
 *   POST /api/auth/logout                        → { ok }
 *   GET  /api/auth/me                            → SessionUser | Principal básico
 */
import { apiGet, apiPost } from '@/services/http';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

/** Permisos de la matriz (1:1 con el backend `PERMISSIONS`). */
export type Permission =
  | 'model.view' | 'model.edit' | 'review.decide' | 'publish'
  | 'export' | 'standards.edit' | 'admin.manage';

/** Usuario en sesión enriquecido (rol + permisos efectivos) que devuelve /me. */
export interface SessionUser {
  username: string;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  roleName?: string | null;
  projectIds: string[];
  status?: string | null;
  initials?: string | null;
  permissions: Record<string, boolean>;
  accessLevel?: 'full' | 'edit' | 'read' | null;
}

export interface LoginResult {
  token: string;
  user: SessionUser;
}

export const login = (username: string, password: string) =>
  apiPost<LoginResult>(`${API_BASE}/api/auth/login`, { username, password });

export const logout = () => apiPost<{ ok: boolean }>(`${API_BASE}/api/auth/logout`);

export const fetchMe = () => apiGet<SessionUser>(`${API_BASE}/api/auth/me`);
