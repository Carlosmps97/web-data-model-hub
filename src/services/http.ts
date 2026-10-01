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
// El header `X-Dev-User` viaja SOLO en desarrollo (`vite dev`): en producción
// la identidad es el token y el backend (REQUIRE_AUTH) ignora este header —
// mandarlo solo servía para que el preflight CORS lo rechazara (400
// "Disallowed CORS headers" → "Failed to fetch" en el login de Apps).
let _devUser = '';
export function setDevUser(u: string): void { _devUser = u; }

// Token de sesión (auth propia). Se envía como `X-Session-Token` en TODA
// llamada — NO como `Authorization: Bearer`: en Databricks Apps ese header le
// pertenece al proxy SSO de la plataforma (lo consume para su propia auth y
// el backend nunca lo recibe — visto 2026-07-20: 401 con el Bearer en vuelo).
// El backend acepta ambos headers (Authorization sigue para curl/dev).
// Lo setea el store de auth al login/restore y lo limpia al logout.
let _token = '';
export function setAuthToken(t: string): void { _token = t; }

// Callback global de 401 (sesión inválida/expirada): el store de auth registra
// aquí su "cerrar sesión + ir a /login", sin acoplar http.ts al router.
let _onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: (() => void) | null): void { _onUnauthorized = cb; }

// Doc 104: observador de respuestas de error (salvo el 401, que ya tiene su
// handler). El canvas lo usa para revalidar su versión cuando un 403/404/409
// de ESA versión avisa que otra sesión la transfirió o la eliminó. Sólo
// observa: nunca cambia el error que recibe el llamador.
let _onApiError: ((status: number, url: string) => void) | null = null;
export function setOnApiError(cb: ((status: number, url: string) => void) | null): void { _onApiError = cb; }

// Doc 105 (F5): un 403 puede ser un permiso que ya no se tiene (rol cambiado en
// Admin): el store de auth re-lee /me (con su propio tope). Las rutas de
// /api/auth/ no lo disparan: el 403 de la propia lectura de /me no la repite.
// Sólo observa, como `_onApiError`.
let _onForbidden: (() => void) | null = null;
export function setOnForbidden(cb: (() => void) | null): void { _onForbidden = cb; }

/** Error tipado que propagan todos los helpers cuando el backend
 *  devuelve un `success: false` o cuando el fetch falla. */
export class ApiError extends Error {
  readonly status: number;
  /** `detail` crudo de un HTTPException de FastAPI (string u objeto — p.ej. el
   *  422 de perfiles de carga trae `{message, problems}`); null si no aplica. */
  readonly detail: unknown;
  /** URL pedida (doc 104): el canvas distingue si el error es de SU versión
   *  (transferida/eliminada) o de otra cosa. null si no aplica. */
  readonly url: string | null;
  constructor(message: string, status: number, detail: unknown = null, url: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.url = url;
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
  /** Timeout de ESTA llamada (default `DEFAULT_TIMEOUT_MS`); las acciones
   *  largas (publicar, copiar estándares, rollback) usan `LONG_TIMEOUT_MS`. */
  timeoutMs?: number;
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
/** Timeout de las acciones largas del servidor (doc 75 D18): publicar una
 *  working copy, crear un proyecto copiando estándares, rollback, apply de
 *  estándares — con el overlay bloqueante encendido en la sesión. */
export const LONG_TIMEOUT_MS = 120_000;
/** Sin respuesta del servidor (red caída, DNS, o en Apps la sesión con el
 *  backend vencida — recargar hace el warm-up SSO, ver `warmup.ts`). */
export const NETWORK_ERROR_TEXT = "Couldn't reach the server — check your connection or reload the page.";

export async function apiFetch<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, signal } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Combina el signal del caller (cleanup de useEffect) con el timeout de la llamada.
  const timeout = AbortSignal.timeout(timeoutMs);
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
      ...(_token ? { 'X-Session-Token': _token } : {}),
      ...(import.meta.env.DEV && _devUser ? { 'X-Dev-User': _devUser } : {}),
      ...headers,
    },
  };

  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json', ...init.headers };
  }

  // Falla de transporte (antes de la respuesta o mientras llega el cuerpo):
  // timeout, cancelación del llamador o red caída — cada una con su texto.
  const transportError = (err: unknown): ApiError => {
    if (timeout.aborted && !(signal?.aborted)) {
      return new ApiError(`The server didn't respond within ${Math.round(timeoutMs / 1000)}s — try again in a moment.`, 0, null, url);
    }
    // Cancelada por su llamador (cleanup de un efecto): nadie la muestra.
    if (signal?.aborted) return new ApiError(err instanceof Error ? err.message : 'Aborted', 0, null, url);
    // Doc 105: el «Failed to fetch» del navegador llegaba tal cual a los avisos.
    return new ApiError(NETWORK_ERROR_TEXT, 0, null, url);
  };

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    // Red caída, timeout, aborto, DNS fail, etc.
    throw transportError(err);
  }

  // Sesión inválida/expirada: dispara el handler global (logout + /login). Se
  // sigue lanzando ApiError para que el caller no continúe con datos vacíos.
  if (response.status === 401 && _onUnauthorized) _onUnauthorized();
  if (!response.ok && response.status !== 401 && _onApiError) {
    try { _onApiError(response.status, url); } catch { /* un observador roto no cambia el error */ }
  }
  if (response.status === 403 && _onForbidden && !url.includes('/api/auth/')) {
    try { _onForbidden(); } catch { /* ídem */ }
  }

  let json: ApiResponse<T> | null = null;
  try {
    json = (await response.json()) as ApiResponse<T>;
  } catch (err) {
    // Doc 105 (ronda 3): un corte MIENTRAS llega el cuerpo (timeout, cancelación,
    // red) no es «JSON inválido»; sólo un SyntaxError lo es.
    if (!(err instanceof SyntaxError)) throw transportError(err);
    throw new ApiError(`Invalid JSON response (HTTP ${response.status})`, response.status, null, url);
  }

  if (!json || typeof json.success !== 'boolean') {
    // FastAPI HTTPException responde `{detail}` (sin envelope): propaga el
    // mensaje real (p.ej. 409 "versión ya no está en borrador") en vez de un
    // genérico ilegible.
    const detail = (json as { detail?: unknown } | null)?.detail;
    if (!response.ok && typeof detail === 'string' && detail) {
      throw new ApiError(detail, response.status, detail, url);
    }
    // `detail` estructurado (`{message, …}`): el mensaje va al usuario y el
    // objeto completo queda en `ApiError.detail` para quien sepa leerlo.
    const message = detail && typeof detail === 'object' ? (detail as { message?: unknown }).message : undefined;
    if (!response.ok && typeof message === 'string' && message) {
      throw new ApiError(message, response.status, detail, url);
    }
    throw new ApiError(`Unexpected response shape (HTTP ${response.status})`, response.status, detail ?? null, url);
  }

  if (!json.success) {
    throw new ApiError(json.error ?? `Request failed (HTTP ${response.status})`, response.status, null, url);
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

/** Doc 105 (ronda 3): el motivo de un error para ir DENTRO de un aviso que ya
 *  dice cómo reintentar — sin punto final ni el consejo «— try again…» del
 *  texto de transporte (salía «…within 30s — try again in a moment. Use
 *  Refresh to try again.»). */
export function errorReason(e: unknown, fallback: string): string {
  return apiErrorMessage(e, fallback).replace(/\s*[—-]\s*try again.*$/i, '').replace(/[.\s]+$/, '') || fallback;
}

/** Doc 105 (ronda 5, R15-H2): un fallo TRANSITORIO — red o timeout (status 0)
 *  o un 5xx —: reintentar puede andar, y no dice que lo pedido no ocurrió. */
export function isTransientError(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 0 || e.status >= 500);
}

/** ¿Es un 409 de negocio del backend (p.ej. nombre duplicado — spec 10 §9)? */
export function isConflictError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409;
}
