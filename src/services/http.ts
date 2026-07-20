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

// Usuario dev activo (fallback del seam local; el backend prefiere el token).
let _devUser = '';
export function setDevUser(u: string): void { _devUser = u; }

// Token de sesión (auth propia). Se envía como `Authorization: Bearer` en TODA
// llamada. Lo setea el store de auth al login/restore y lo limpia al logout.
let _token = '';
export function setAuthToken(t: string): void { _token = t; }

// Callback global de 401 (sesión inválida/expirada): el store de auth registra
// aquí su "cerrar sesión + ir a /login", sin acoplar http.ts al router.
let _onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: (() => void) | null): void { _onUnauthorized = cb; }

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
/** Timeout por defecto de toda llamada API: sin él, un backend colgado deja
 *  la UI en spinners eternos (fetch no tiene timeout propio). */
const DEFAULT_TIMEOUT_MS = 30_000;

export async function apiFetch<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, signal } = opts;

  // Combina el signal del caller (cleanup de useEffect) con el timeout global.
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  // The Next.js frontend (`:3000`) and the FastAPI backend (`:8000`) live on
  // different origins. Without `credentials: 'include'` the browser neither
  // sends nor accepts the `modeler-auth` session cookie on cross-origin
  // requests, which would silently break every authenticated call.
  const init: RequestInit = {
    method,
    signal: combined,
    credentials: 'include',
    headers: {
      ...(_token ? { Authorization: `Bearer ${_token}` } : {}),
      ...(_devUser ? { 'X-Dev-User': _devUser } : {}),
      ...headers,
    },
  };

  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json', ...init.headers };
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    // Red caída, timeout, aborto, DNS fail, etc.
    if (timeout.aborted && !(signal?.aborted)) {
      throw new ApiError(`The server didn't respond within ${DEFAULT_TIMEOUT_MS / 1000}s — try again in a moment.`, 0);
    }
    throw new ApiError(err instanceof Error ? err.message : 'Network error', 0);
  }

  // Sesión inválida/expirada: dispara el handler global (logout + /login). Se
  // sigue lanzando ApiError para que el caller no continúe con datos vacíos.
  if (response.status === 401 && _onUnauthorized) _onUnauthorized();

  let json: ApiResponse<T> | null = null;
  try {
    json = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(`Invalid JSON response (HTTP ${response.status})`, response.status);
  }

  if (!json || typeof json.success !== 'boolean') {
    // FastAPI HTTPException responde `{detail}` (sin envelope): propaga el
    // mensaje real (p.ej. 409 "versión ya no está en borrador") en vez de un
    // genérico ilegible.
    const detail = (json as { detail?: unknown } | null)?.detail;
    if (!response.ok && typeof detail === 'string' && detail) {
      throw new ApiError(detail, response.status);
    }
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

// ─── Error helpers ────────────────────────────────────────────────

/** Mensaje legible de un error de API: el `detail` del backend si vino
 *  (ApiError lo conserva como `message`), o `fallback`. */
export function apiErrorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** ¿Es un 409 de negocio del backend (p.ej. nombre duplicado — spec 10 §9)? */
export function isConflictError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409;
}
