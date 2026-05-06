/**
 * Cliente HTTP genérico del frontend.
 *
 * Encapsula el envelope `{ success, data?, error? }` que devuelven
 * todas las rutas de `@/app/api/*` (ver `@/server/http/response.ts`).
 * Los helpers de feature — `projects.service`, `models.service`,
 * `agent.service` — deberían construirse sobre esta capa para evitar
 * duplicar manejo de errores y parsing de JSON.
 *
 * Diseño:
 *   - `apiFetch<T>()` devuelve el `data` desempaquetado cuando
 *     `success === true`. En cualquier otro caso (red caída, 4xx/5xx,
 *     envelope inválido) arroja `ApiError`.
 *   - Los consumidores hacen `try/catch (ApiError)` y deciden si
 *     muestran toast / redireccionan / reintentan. No inspeccionan
 *     `json.success` a mano.
 */

import type { ApiResponse } from '@/types/api';

/** Error tipado que propagan todos los helpers cuando el backend
 *  devuelve un `success: false` o cuando el fetch falla. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  /** Additional headers. Content-Type is set automatically when body is set. */
  headers?: Record<string, string>;
  /** AbortSignal from caller (e.g. useEffect cleanup). */
  signal?: AbortSignal;
}

/**
 * Hace fetch a una ruta interna (`/api/...`) y desempaqueta el envelope.
 * Uso:
 *   const projects = await apiFetch<Project[]>('/api/projects');
 *   const project  = await apiFetch<Project>('/api/projects', { method: 'POST', body: { name } });
 */
export async function apiFetch<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, signal } = opts;

  // The Next.js frontend (`:3000`) and the FastAPI backend (`:8000`) live on
  // different origins. Without `credentials: 'include'` the browser neither
  // sends nor accepts the `modeler-auth` session cookie on cross-origin
  // requests, which would silently break every authenticated call.
  const init: RequestInit = {
    method,
    signal,
    credentials: 'include',
    headers: { ...headers },
  };

  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json', ...init.headers };
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    // Red caída, aborto, DNS fail, etc.
    throw new ApiError(err instanceof Error ? err.message : 'Network error', 0);
  }

  let json: ApiResponse<T> | null = null;
  try {
    json = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(`Invalid JSON response (HTTP ${response.status})`, response.status);
  }

  if (!json || typeof json.success !== 'boolean') {
    throw new ApiError(`Unexpected response shape (HTTP ${response.status})`, response.status);
  }

  if (!json.success) {
    throw new ApiError(json.error ?? `Request failed (HTTP ${response.status})`, response.status);
  }

  return json.data as T;
}

// ─── Convenience shortcuts ────────────────────────────────────────

export function apiGet<T>(url: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
  return apiFetch<T>(url, { ...opts, method: 'GET' });
}

export function apiPost<T>(url: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
  return apiFetch<T>(url, { ...opts, method: 'POST', body });
}

export function apiPut<T>(url: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
  return apiFetch<T>(url, { ...opts, method: 'PUT', body });
}

export function apiDelete<T>(url: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
  return apiFetch<T>(url, { ...opts, method: 'DELETE' });
}
