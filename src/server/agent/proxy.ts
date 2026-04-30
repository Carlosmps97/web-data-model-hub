// ─────────────────────────────────────────────────────────────────────────
//  Cliente HTTP server-only para el backend del agent-modeler.
//
//  Este módulo SOLO se importa desde route handlers (`src/app/api/agent/*`)
//  y NO debe llegar al bundle del navegador. La URL del backend se lee de
//  `process.env.AGENT_BACKEND_URL` para que pueda apuntar a `localhost:8000`
//  en dev y a la URL interna del cluster en producción sin exponer nada
//  al cliente.
//
//  Dos formas de uso:
//
//   1. `proxyToBackend(req, ctx)`: pass-through directo del request
//      del browser al backend, preservando body, status, headers
//      relevantes y query string. Lo usan los route handlers.
//
//   2. `agentBackendFetch(path, init)`: helper tipado para llamadas
//      programáticas server-side (ej. server actions). No se usa hoy
//      pero queda disponible para futuras extensiones.
//
//  Errores de transporte (timeout, DNS, ECONNREFUSED) se traducen a
//  502 con un body JSON `{ detail, code: 'AGENT_BACKEND_UNREACHABLE' }`,
//  lo que mantiene el contrato uniforme con los errores que vienen del
//  propio FastAPI (que también usa `{ detail, code }`).
// ─────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/** Resuelve la base URL del backend, sin trailing slash. */
function getBackendBaseUrl(): string {
  const raw = process.env.AGENT_BACKEND_URL?.trim();
  if (!raw) {
    throw new Error(
      "AGENT_BACKEND_URL no está definida. Configurá la URL del backend del agent-modeler en .env (por defecto http://localhost:8000).",
    );
  }
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/** Timeout por defecto en ms para todas las rutas excepto `model`. */
function getDefaultTimeoutMs(): number {
  const raw = process.env.AGENT_BACKEND_DEFAULT_TIMEOUT_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

/** Timeout en ms para el endpoint de modelado (puede ser largo). */
function getModelTimeoutMs(): number {
  const raw = process.env.AGENT_BACKEND_MODEL_TIMEOUT_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

// ─── Helpers internos ────────────────────────────────────────────────────

/**
 * Construye el `AbortSignal` con timeout adecuado según el path. Usamos
 * `AbortSignal.timeout` (Node 20+, soportado por Next 16).
 */
function buildAbortSignal(path: string): AbortSignal {
  const ms = path.endsWith('/model') ? getModelTimeoutMs() : getDefaultTimeoutMs();
  return AbortSignal.timeout(ms);
}

/**
 * Convierte un Error de `fetch` (timeout / DNS / ECONNREFUSED) a una
 * `NextResponse` 502. Usado por `proxyToBackend`.
 */
function transportErrorResponse(err: unknown): NextResponse {
  const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
  return NextResponse.json(
    {
      detail: isTimeout
        ? 'El backend del agente no respondió a tiempo.'
        : `No se pudo contactar al backend del agente: ${err instanceof Error ? err.message : String(err)}`,
      code: isTimeout ? 'AGENT_BACKEND_TIMEOUT' : 'AGENT_BACKEND_UNREACHABLE',
    },
    { status: 502 },
  );
}

/**
 * Headers que reenviamos del request del browser al backend. Filtramos
 * `host`, `connection`, hop-by-hop y similares para no romper el upstream.
 *
 * Mantenemos `content-type` para que multipart/form-data conserve el
 * boundary correcto cuando hacemos pass-through del body crudo.
 */
function forwardableRequestHeaders(req: NextRequest): Headers {
  const headers = new Headers();
  const blocked = new Set([
    'host',
    'connection',
    'content-length',
    'transfer-encoding',
    'accept-encoding',
    // Headers de Next/Vercel que no aportan al backend:
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-proto',
    'x-real-ip',
  ]);
  req.headers.forEach((value, key) => {
    if (!blocked.has(key.toLowerCase())) headers.set(key, value);
  });
  return headers;
}

/**
 * Headers que reenviamos del backend al browser. Filtramos `transfer-encoding`
 * para que Next no se confunda con el body que ya leímos.
 */
function forwardableResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  const blocked = new Set(['transfer-encoding', 'content-encoding', 'connection']);
  upstream.headers.forEach((value, key) => {
    if (!blocked.has(key.toLowerCase())) headers.set(key, value);
  });
  return headers;
}

// ─── API pública ─────────────────────────────────────────────────────────

/**
 * Hace pass-through del request del browser al backend del agent-modeler.
 *
 * - `path`: ruta absoluta del backend (ej. `/api/conversations`). Se
 *   concatena tal cual a la base URL.
 * - El query string del request original se preserva.
 * - El body se reenvía como stream (NO lo deserializamos, así funciona
 *   para JSON y para multipart sin tocar el boundary).
 * - El status, body y headers de la respuesta del backend se devuelven
 *   verbatim al browser.
 *
 * Si el backend no responde, devuelve 502 con un body JSON estándar.
 */
export async function proxyToBackend(req: NextRequest, path: string): Promise<NextResponse> {
  let baseUrl: string;
  try {
    baseUrl = getBackendBaseUrl();
  } catch (err) {
    return NextResponse.json(
      {
        detail: err instanceof Error ? err.message : String(err),
        code: 'AGENT_BACKEND_NOT_CONFIGURED',
      },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const target = `${baseUrl}${path}${url.search}`;

  // Para GET/DELETE/HEAD no enviamos body. Para el resto, reenviamos el
  // body del request como stream. `duplex: 'half'` es requerido por Node
  // cuando se envía un ReadableStream como body.
  const method = req.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'DELETE';

  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers: forwardableRequestHeaders(req),
    signal: buildAbortSignal(path),
  };
  if (hasBody) {
    init.body = req.body;
    init.duplex = 'half';
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    return transportErrorResponse(err);
  }

  // Pasamos el body verbatim. `arrayBuffer()` evita problemas con
  // streams ya consumidos por algún middleware intermedio.
  const buf = await upstream.arrayBuffer();
  return new NextResponse(buf, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: forwardableResponseHeaders(upstream),
  });
}

/**
 * Helper tipado para llamar al backend desde código server (sin pass-through
 * de un request del cliente). Útil para server actions o llamadas internas.
 *
 * Devuelve `{ ok: true, status, data }` si el backend respondió 2xx, o
 * `{ ok: false, status, detail, code }` en caso contrario / error de
 * transporte. Nunca lanza por status no-2xx; el caller decide.
 */
export async function agentBackendFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; detail: string; code: string }
> {
  let baseUrl: string;
  try {
    baseUrl = getBackendBaseUrl();
  } catch (err) {
    return {
      ok: false,
      status: 500,
      detail: err instanceof Error ? err.message : String(err),
      code: 'AGENT_BACKEND_NOT_CONFIGURED',
    };
  }

  const target = `${baseUrl}${path}`;
  const headers = new Headers(init.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      ...init,
      headers,
      signal: init.signal ?? buildAbortSignal(path),
    });
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
    return {
      ok: false,
      status: 502,
      detail: isTimeout
        ? 'El backend del agente no respondió a tiempo.'
        : `No se pudo contactar al backend del agente: ${err instanceof Error ? err.message : String(err)}`,
      code: isTimeout ? 'AGENT_BACKEND_TIMEOUT' : 'AGENT_BACKEND_UNREACHABLE',
    };
  }

  const text = await upstream.text();
  // Algunos endpoints (DELETE 204) podrían no devolver body.
  const json = text ? safeJsonParse<unknown>(text) : null;

  if (!upstream.ok) {
    const detail =
      (json && typeof json === 'object' && 'detail' in json && typeof (json as { detail: unknown }).detail === 'string'
        ? (json as { detail: string }).detail
        : null) ?? `Backend respondió ${upstream.status}.`;
    const code =
      (json && typeof json === 'object' && 'code' in json && typeof (json as { code: unknown }).code === 'string'
        ? (json as { code: string }).code
        : null) ?? `HTTP_${upstream.status}`;
    return { ok: false, status: upstream.status, detail, code };
  }

  return { ok: true, status: upstream.status, data: json as T };
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
