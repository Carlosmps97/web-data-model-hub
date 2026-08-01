import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureBackendSession } from './warmup';

// Entorno de test = node (sin jsdom): se stubean los globals del navegador.
function stubBrowser(href = 'https://front.example.com/login') {
  const store = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('window', { location: { href } });
  return store;
}

describe('ensureBackendSession (warm-up SSO de Databricks Apps, doc 36)', () => {
  beforeEach(() => stubBrowser());
  afterEach(() => vi.unstubAllGlobals());

  it('sin API_BASE (mismo origen) no hace nada', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const navigate = vi.fn();
    await ensureBackendSession('', navigate);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('probe OK: no redirige y rearma el guard', async () => {
    const store = stubBrowser();
    store.set('dmh-warmup-redirected', '1');           // quedó de una vez anterior
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const navigate = vi.fn();
    await ensureBackendSession('https://bknd.example.com', navigate);
    expect(navigate).not.toHaveBeenCalled();
    expect(store.has('dmh-warmup-redirected')).toBe(false);   // guard rearmado
  });

  it('probe bloqueado (proxy SSO): redirige UNA vez al warmup con next en el PATH (b64url)', async () => {
    const store = stubBrowser('https://front.example.com/login?a=1');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const navigate = vi.fn();
    await ensureBackendSession('https://bknd.example.com', navigate);
    const token = btoa('https://front.example.com/login?a=1')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(`https://bknd.example.com/api/auth/warmup/${token}`);
    // sin query string: el replay post-SSO del proxy de Databricks la rompia
    expect((navigate.mock.calls[0][0] as string).includes('?')).toBe(false);
    expect(store.get('dmh-warmup-redirected')).toBe('1');
  });

  it('segundo fallo con guard puesto: NO loopea', async () => {
    const store = stubBrowser();
    store.set('dmh-warmup-redirected', '1');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const navigate = vi.fn();
    await ensureBackendSession('https://bknd.example.com', navigate);
    expect(navigate).not.toHaveBeenCalled();
  });
});
