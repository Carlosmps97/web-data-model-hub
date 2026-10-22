/**
 * auth.service: sesión por token; dos formas de iniciarla y su renovación.
 *
 * Backend (envelope `{success,data}`):
 *   POST /api/auth/sso/login                     → { user, expiresIn }  (identidad
 *        heredada del SSO de Databricks Apps; 403 si el correo no está
 *        asignado a un rol en Admin)
 *   POST /api/auth/login  {username, password} → { user, expiresIn }  (cuenta
 *        local con contraseña — carril del administrador)
 *   POST /api/auth/refresh                       → { user, expiresIn }  (token
 *        nuevo con la vida completa; 401 si la sesión ya no vale)
 *   POST /api/auth/logout                        → { ok }
 *   GET  /api/auth/me                            → SessionUser | Principal básico
 * El backend también devuelve `token`; el servidor del front lo saca del cuerpo
 * y lo guarda en una cookie HttpOnly (ver `services/http.ts`).
 */
import { apiGet, apiPost } from '@/services/http';

import { API_BASE } from '@/services/apiBase';

/** Permisos de la matriz (1:1 con el backend `PERMISSIONS`). */
export type Permission =
  | 'model.view' | 'model.edit' | 'review.decide'
  | 'rollback' | 'versions.view_all' | 'export' | 'standards.edit' | 'admin.manage';

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
  user: SessionUser;
  /** Segundos de vida del token. */
  expiresIn: number;
  /** Solo cuando el token no viaja en la cookie (ver `services/http.ts`). */
  token?: string;
}

export const login = (username: string, password: string) =>
  apiPost<LoginResult>(`${API_BASE}/api/auth/login`, { username, password });

/** Login con la identidad heredada de Databricks. Sin body: la identidad
 *  viaja en headers que el servidor del front releva al backend. */
export const ssoLogin = () => apiPost<LoginResult>(`${API_BASE}/api/auth/sso/login`);

/** Renueva la sesión: token nuevo con la vida completa y el usuario al día. */
export const refreshSession = (signal?: AbortSignal) =>
  apiPost<LoginResult>(`${API_BASE}/api/auth/refresh`, undefined, { signal });

export const logout = () => apiPost<{ ok: boolean }>(`${API_BASE}/api/auth/logout`);

export const fetchMe = () => apiGet<SessionUser>(`${API_BASE}/api/auth/me`);
