import { afterEach, describe, it, expect, vi } from 'vitest';
import { ApiError, apiErrorMessage, apiGet, apiPut, errorReason, isConflictError, isTransientError, NETWORK_ERROR_TEXT, setOnApiError, setOnForbidden } from './http';

describe('apiErrorMessage', () => {
  it('propaga el detail del backend (ApiError conserva el detail como message)', () => {
    expect(apiErrorMessage(new ApiError('Ya existe la tabla core.CLIENTE', 409), 'fallback'))
      .toBe('Ya existe la tabla core.CLIENTE');
  });

  it('cae al fallback con errores sin mensaje o valores no-Error', () => {
    expect(apiErrorMessage('boom', 'fallback')).toBe('fallback');
    expect(apiErrorMessage(new Error(''), 'fallback')).toBe('fallback');
    expect(apiErrorMessage(undefined, 'fallback')).toBe('fallback');
  });
});

// Doc 105 (ronda 3, cosmético): el motivo va DENTRO de un aviso que ya dice
// cómo reintentar; el consejo del texto de transporte sobraba («…within 30s —
// try again in a moment. Use Refresh to try again.»).
describe('errorReason', () => {
  const TIMEOUT = new ApiError("The server didn't respond within 30s — try again in a moment.", 0, null, '/api/x');

  it('sin el consejo «— try again…» ni el punto final', () => {
    expect(errorReason(TIMEOUT, 'unknown error')).toBe("The server didn't respond within 30s");
    expect(errorReason(new Error('Busy - Try again later.'), 'x')).toBe('Busy');
  });

  it('el resto del motivo, igual (sólo sin punto final); vacío → fallback', () => {
    expect(errorReason(new ApiError('Ya existe la tabla core.CLIENTE.', 409), 'x')).toBe('Ya existe la tabla core.CLIENTE');
    expect(errorReason(new Error(NETWORK_ERROR_TEXT), 'x')).toBe(NETWORK_ERROR_TEXT.replace(/\.$/, ''));
    expect(errorReason(new Error(''), 'unknown error')).toBe('unknown error');
    expect(errorReason(new Error('— try again.'), 'unknown error')).toBe('unknown error');
  });
});

// Doc 105 (ronda 5, R15-H2): transitorio = reintentar puede andar y no dice que
// lo pedido no ocurrió (red, timeout, 5xx); un 4xx es la respuesta.
describe('isTransientError', () => {
  it('red o timeout (status 0) y 5xx sí; 4xx y lo que no es de la API, no', () => {
    expect(isTransientError(new ApiError('timeout', 0))).toBe(true);
    expect(isTransientError(new ApiError('Bad gateway', 502))).toBe(true);
    expect(isTransientError(new ApiError('Internal', 500))).toBe(true);
    expect(isTransientError(new ApiError('Not found', 404))).toBe(false);
    expect(isTransientError(new ApiError('Busy', 409))).toBe(false);
    expect(isTransientError(new Error('boom'))).toBe(false);
  });
});

describe('isConflictError', () => {
  it('true sólo para ApiError con status 409', () => {
    expect(isConflictError(new ApiError('dup', 409))).toBe(true);
    expect(isConflictError(new ApiError('forbidden', 403))).toBe(false);
    expect(isConflictError(new Error('x'))).toBe(false);
  });
});

describe('setOnApiError (doc 104)', () => {
  const respond = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  afterEach(() => {
    setOnApiError(null);
    vi.unstubAllGlobals();
  });

  it('avisa status + url de una respuesta de error y el error llega intacto al llamador', async () => {
    const seen: [number, string][] = [];
    setOnApiError((status, url) => seen.push([status, url]));
    vi.stubGlobal('fetch', respond(404, { detail: 'This version no longer exists' }));
    await expect(apiGet('/api/changesets/cs1')).rejects.toMatchObject({ status: 404, message: 'This version no longer exists' });
    expect(seen).toEqual([[404, '/api/changesets/cs1']]);
  });

  it('no avisa en éxito ni en 401 (ese va al handler de sesión)', async () => {
    const seen: number[] = [];
    setOnApiError((status) => seen.push(status));
    vi.stubGlobal('fetch', respond(200, { success: true, data: [] }));
    await apiGet('/api/versions');
    vi.stubGlobal('fetch', respond(401, { detail: 'Not authenticated' }));
    await expect(apiGet('/api/versions')).rejects.toBeInstanceOf(ApiError);
    expect(seen).toEqual([]);
  });

  it('el error de una respuesta lleva la URL pedida (para saber de qué versión es)', async () => {
    vi.stubGlobal('fetch', respond(404, { detail: 'gone' }));
    await expect(apiGet('/api/changesets/cs9/effective/x')).rejects.toMatchObject({ status: 404, url: '/api/changesets/cs9/effective/x' });
  });

  it('un observador que falla no cambia el error original', async () => {
    setOnApiError(() => { throw new Error('observer broke'); });
    vi.stubGlobal('fetch', respond(409, { detail: 'The version is no longer in draft' }));
    await expect(apiPut('/api/changesets/cs1/changes', {})).rejects.toMatchObject({ status: 409 });
  });
});

// Doc 105 (F5): un 403 puede ser un permiso que ya no se tiene (rol cambiado en
// Admin): el store de auth re-lee /me. La lectura de /me (y todo /api/auth/)
// no lo dispara: su propio 403 no puede redisparar su lectura.
describe('setOnForbidden (doc 105, F5)', () => {
  const respond = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  afterEach(() => {
    setOnForbidden(null);
    vi.unstubAllGlobals();
  });

  it('un 403 fuera de /api/auth/ avisa; el error llega intacto al llamador', async () => {
    let calls = 0;
    setOnForbidden(() => { calls += 1; });
    vi.stubGlobal('fetch', respond(403, { detail: "You don't have permission for this action (model.edit)." }));
    await expect(apiPut('/api/changesets/cs1/changes', {})).rejects.toMatchObject({ status: 403, message: "You don't have permission for this action (model.edit)." });
    expect(calls).toBe(1);
  });

  it('un 403 de /api/auth/ (p. ej. la propia lectura de /me) NO avisa', async () => {
    let calls = 0;
    setOnForbidden(() => { calls += 1; });
    vi.stubGlobal('fetch', respond(403, { detail: 'nope' }));
    await expect(apiGet('/api/auth/me')).rejects.toMatchObject({ status: 403 });
    expect(calls).toBe(0);
  });

  it('otros códigos no avisan; un observador que falla no cambia el error', async () => {
    let calls = 0;
    setOnForbidden(() => { calls += 1; throw new Error('observer broke'); });
    vi.stubGlobal('fetch', respond(404, { detail: 'gone' }));
    await expect(apiGet('/api/versions')).rejects.toMatchObject({ status: 404 });
    expect(calls).toBe(0);
    vi.stubGlobal('fetch', respond(403, { detail: 'nope' }));
    await expect(apiGet('/api/versions')).rejects.toMatchObject({ status: 403, message: 'nope' });
    expect(calls).toBe(1);
  });
});

describe('red caída (doc 105)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sin respuesta del servidor, el aviso es legible (no el «Failed to fetch» del navegador)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(apiGet('/api/versions')).rejects.toMatchObject({
      status: 0,
      message: "Couldn't reach the server — check your connection or reload the page.",
    });
  });

  it('una llamada cancelada por su llamador conserva su error (nadie la muestra)', async () => {
    const ac = new AbortController();
    ac.abort();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError')));
    await expect(apiGet('/api/versions', { signal: ac.signal })).rejects.toMatchObject({
      status: 0,
      message: 'The operation was aborted.',
    });
  });
});

describe('la respuesta se corta a medio leer (doc 105, ronda 3)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const cut = (err: unknown, ms = 0) => ({
    ok: true, status: 200,
    json: () => new Promise((_, reject) => setTimeout(() => reject(err), ms)),
  });

  it('el tiempo se agota mientras llega el cuerpo: el aviso es el del timeout, no «Invalid JSON»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => cut(new DOMException('The operation was aborted.', 'AbortError'), 60)));
    await expect(apiGet('/api/versions', { timeoutMs: 10 })).rejects.toMatchObject({
      status: 0, message: expect.stringContaining("The server didn't respond within"),
    });
  });

  it('la red se cae a mitad del cuerpo: el aviso de red', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => cut(new TypeError('network error'))));
    await expect(apiGet('/api/versions')).rejects.toMatchObject({ status: 0, message: NETWORK_ERROR_TEXT });
  });

  it('un cuerpo que no es JSON sigue diciendo «Invalid JSON response»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => cut(new SyntaxError('Unexpected token <'))));
    await expect(apiGet('/api/versions')).rejects.toMatchObject({ status: 200, message: 'Invalid JSON response (HTTP 200)' });
  });
});
