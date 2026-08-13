/**
 * auth.service — sesión por token; dos formas de iniciarla (doc 38).
 *
 * Backend (envelope `{success,data}`):
 *   POST /api/auth/sso/login                     → { token, user }  (identidad
 *        heredada del SSO de Databricks Apps; 403 si el correo no está
 *        asignado a un rol en Admin)
 *   POST /api/auth/login  {username, password} → { token, user }  (cuenta
 *        local con contraseña — carril del administrador)
 *   POST /api/auth/logout                        → { ok }
 *   GET  /api/auth/me                            → SessionUser | Principal básico
 */
import { apiGet, apiPost } from '@/services/http';

import { API_BASE } from '@/services/apiBase';

/** Permisos de la matriz (1:1 con el backend `PERMISSIONS`). */
export type Permission =
  | 'model.view' | 'model.edit' | 'review.decide' | 'publish'
  | 'rollback' | 'export' | 'standards.edit' | 'admin.manage';

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

/** Login con la identidad heredada de Databricks (doc 38). Sin body: la
 *  identidad viaja en headers que el server del front releva al backend. */
export const ssoLogin = () => apiPost<LoginResult>(`${API_BASE}/api/auth/sso/login`);

export const logout = () => apiPost<{ ok: boolean }>(`${API_BASE}/api/auth/logout`);

export const fetchMe = () => apiGet<SessionUser>(`${API_BASE}/api/auth/me`);
