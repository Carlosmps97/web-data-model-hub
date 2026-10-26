/**
 * Pruebas del servidor de producción del front (server.mjs): unitarias (path
 * traversal, headers del proxy, cache de token, cookie de sesión) +
 * integración (servidor real contra un backend falso: estáticos, fallback SPA,
 * proxy con Bearer, streaming del body, reintento ante 401 del proxy de
 * Databricks y sesión en cookie HttpOnly).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SECURITY_HEADERS, SESSION_COOKIE, TokenCache, apiRoute, buildUpstreamHeaders, contentTypeFor, createServer,
  readCookie, safeJoin, sessionCookie, sessionCookieName,
} from './server.mjs';

// ── unitarias: safeJoin ──────────────────────────────────────────────────

describe('safeJoin (anti path traversal)', () => {
  const root = path.join(path.sep, 'srv', 'dist');
  it('resuelve rutas normales dentro del root', () => {
    expect(safeJoin(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
    expect(safeJoin(root, '/')).toBe(root);
  });
  it('bloquea salidas del root y encoding inválido', () => {
    expect(safeJoin(root, '/../../etc/passwd')).toBeNull();
    expect(safeJoin(root, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
    expect(safeJoin(root, '/%zz')).toBeNull();
  });
});

describe('contentTypeFor', () => {
  it('mapea los tipos del build y cae a octet-stream', () => {
    expect(contentTypeFor('a/index.html')).toContain('text/html');
    expect(contentTypeFor('a/x.woff2')).toBe('font/woff2');
    expect(contentTypeFor('a/help.pdf')).toBe('application/pdf');
    expect(contentTypeFor('a/raro.xyz')).toBe('application/octet-stream');
  });
});

// ── unitarias: headers hacia el backend ──────────────────────────────────

describe('buildUpstreamHeaders', () => {
  it('quita host/authorization/cookie del cliente, pone el Bearer del SP y conserva X-Session-Token', () => {
    const out = buildUpstreamHeaders(
      { host: 'front.example.com', authorization: 'Bearer robado', cookie: 'dmh_session=x; otra=y',
        'x-session-token': 'jwt-plataforma', 'content-type': 'application/json',
        'x-forwarded-for': '10.1.2.3' },
      'tok-sp', '192.168.0.9');
    expect(out.host).toBeUndefined();
    expect(out.cookie).toBeUndefined();
    expect(out.authorization).toBe('Bearer tok-sp');
    expect(out['x-session-token']).toBe('jwt-plataforma');
    expect(out['x-forwarded-for']).toBe('10.1.2.3');   // el del proxy de Databricks manda
  });
  it('sin XFF entrante usa la IP del socket; sin token no agrega authorization', () => {
    const out = buildUpstreamHeaders({ accept: 'application/json' }, null, '127.0.0.1');
    expect(out.authorization).toBeUndefined();
    expect(out['x-forwarded-for']).toBe('127.0.0.1');
  });
  it('borra x-dmh-* forjados, releva la identidad atestada y adjunta el secreto', () => {
    const out = buildUpstreamHeaders(
      { 'x-dmh-sso-email': 'atacante@evil.com', 'x-dmh-proxy-secret': 'forjado',
        'x-forwarded-email': 'ana@empresa.com',
        'x-forwarded-preferred-username': 'ana@empresa.com',
        'x-forwarded-user': '12345' },
      'tok-sp', '10.0.0.1', 's3cr3t');
    expect(out['x-dmh-sso-email']).toBe('ana@empresa.com');   // el del proxy, no el forjado
    expect(out['x-dmh-sso-username']).toBe('ana@empresa.com');
    expect(out['x-dmh-sso-user-id']).toBe('12345');
    expect(out['x-dmh-proxy-secret']).toBe('s3cr3t');               // el configurado, no el forjado
  });
  it('sin identidad del proxy no inventa relay; sin secreto configurado no lo manda', () => {
    const out = buildUpstreamHeaders(
      { 'x-dmh-sso-email': 'forjado@evil.com', accept: '*/*' }, null, '127.0.0.1');
    expect(out['x-dmh-sso-email']).toBeUndefined();
    expect(out['x-dmh-sso-username']).toBeUndefined();
    expect(out['x-dmh-proxy-secret']).toBeUndefined();
  });
});

// ── unitarias: cookie de sesión ──────────────────────────────────────────

describe('cookie de sesión', () => {
  const req = (headers = {}) => ({ headers, socket: {} });
  it('readCookie toma la cookie pedida entre varias; vacía o ausente = null', () => {
    expect(readCookie('a=1; dmh_session=tok.en.x; b=2', 'dmh_session')).toBe('tok.en.x');
    expect(readCookie('xdmh_session=1; dmh_session=', 'dmh_session')).toBeNull();
    expect(readCookie(undefined, 'dmh_session')).toBeNull();
  });
  it('por http: dmh_session sin Secure; por https: __Host- con Secure; siempre HttpOnly, SameSite=Strict y Path=/', () => {
    expect(sessionCookie(req(), 'abc', 3600)).toBe('dmh_session=abc; Path=/; Max-Age=3600; HttpOnly; SameSite=Strict');
    const https = req({ 'x-forwarded-proto': 'https' });
    expect(sessionCookieName(https)).toBe(`__Host-${SESSION_COOKIE}`);
    expect(sessionCookie(https, 'abc', 60)).toBe('__Host-dmh_session=abc; Path=/; Max-Age=60; HttpOnly; SameSite=Strict; Secure');
    expect(sessionCookie(https, '', 0)).toBe('__Host-dmh_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure');
    // Un proxy que encadena varios valores: manda el primero.
    expect(sessionCookieName(req({ 'x-forwarded-proto': 'https, http' }))).toBe('__Host-dmh_session');
    expect(sessionCookieName(req({ 'x-forwarded-proto': 'http, https' }))).toBe('dmh_session');
  });
  it('apiRoute resuelve la ruta como el backend: %XX decodificados y normalizada; codificación inválida = null', () => {
    expect(apiRoute('/api/auth/%72efresh?x=1')).toBe('/api/auth/refresh');
    expect(apiRoute('/api/auth/sso/%6Cogin')).toBe('/api/auth/sso/login');
    expect(apiRoute('/api/x%2F..%2Fauth%2Frefresh')).toBe('/api/auth/refresh');
    expect(apiRoute('/api//auth/./refresh')).toBe('/api/auth/refresh');
    expect(apiRoute('/api/projects/p-1')).toBe('/api/projects/p-1');
    expect(apiRoute('/api/%zz')).toBeNull();
  });
});

// ── unitarias: TokenCache ────────────────────────────────────────────────

describe('TokenCache', () => {
  it('acuña una vez, cachea, y un mint concurrente se comparte', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ access_token: 't1', expires_in: 3600 }),
    });
    const cache = new TokenCache(fetchMock);
    const [a, b] = await Promise.all([
      cache.get('https://ws', 'id', 'secret'),
      cache.get('https://ws', 'id', 'secret'),
    ]);
    expect(a).toBe('t1');
    expect(b).toBe('t1');
    expect(fetchMock).toHaveBeenCalledTimes(1);            // un solo mint
    expect(await cache.get('https://ws', 'id', 'secret')).toBe('t1');  // cache
    cache.invalidate();
    await cache.get('https://ws', 'id', 'secret');
    expect(fetchMock).toHaveBeenCalledTimes(2);            // re-mint tras invalidar
  });
  it('propaga el fallo del mint', async () => {
    const cache = new TokenCache(vi.fn().mockResolvedValue({
      ok: false, status: 403, text: async () => 'nope',
    }));
    await expect(cache.get('https://ws', 'id', 'secret')).rejects.toThrow('403');
  });
});

// ── integración: servidor real + backend falso ───────────────────────────

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

describe('servidor integrado (estáticos + proxy)', () => {
  let dist;
  let backend;
  let backendPort;
  let front;
  let base;
  const seen = [];          // requests que recibió el backend falso
  let fail401 = 0;          // cuántos de los próximos requests responden 401

  beforeAll(async () => {
    dist = mkdtempSync(path.join(tmpdir(), 'dist-'));
    writeFileSync(path.join(dist, 'index.html'), '<html>SPA</html>');
    mkdirSync(path.join(dist, 'assets'));
    writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');

    backend = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        if (fail401 > 0) {
          fail401 -= 1;
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end('{}');                                   // el {} del proxy de Databricks
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json', 'x-req-id': 'abc' });
        res.end(JSON.stringify({ echo: body || null, url: req.url }));
      });
    });
    backendPort = await listen(backend);

    const tokens = new TokenCache(vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok-1', expires_in: 3600 }) })
      .mockResolvedValue({ ok: true, json: async () => ({ access_token: 'tok-2', expires_in: 3600 }) }));
    front = createServer({
      dist,
      backend: `http://127.0.0.1:${backendPort}`,
      host: 'https://ws.example.com',
      clientId: 'sp-id',
      clientSecret: 'sp-secret',
      proxySecret: 'shhh',
      tokens,
      timeoutMs: 5000,
    });
    base = `http://127.0.0.1:${await listen(front)}`;
  });

  afterAll(() => {
    front?.close();
    backend?.close();
    rmSync(dist, { recursive: true, force: true });
  });

  it('sirve el asset con cache inmutable y hace fallback SPA en rutas del router', async () => {
    const asset = await fetch(`${base}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    const spa = await fetch(`${base}/login`);
    expect(await spa.text()).toContain('SPA');
    expect(spa.headers.get('cache-control')).toBe('no-cache');
  });

  it('los estáticos y el fallback SPA llevan CSP y cabeceras de seguridad; HSTS solo por HTTPS', async () => {
    for (const url of [`${base}/assets/app.js`, `${base}/login`, `${base}/`]) {
      const r = await fetch(url);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(r.headers.get(k)).toBe(v);
      expect(r.headers.get('strict-transport-security')).toBeNull();
    }
    const csp = SECURITY_HEADERS['content-security-policy'];
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    const https = await fetch(`${base}/login`, { headers: { 'x-forwarded-proto': 'https' } });
    expect(https.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('las respuestas de /api conservan las cabeceras del backend (sin CSP propia)', async () => {
    const r = await fetch(`${base}/api/projects`);
    expect(r.headers.get('x-req-id')).toBe('abc');
    expect(r.headers.get('content-security-policy')).toBeNull();
  });

  it('reenvía /api con Bearer del SP, conserva X-Session-Token y query string', async () => {
    const r = await fetch(`${base}/api/projects?limit=5`, {
      headers: { 'x-session-token': 'jwt-user-1', authorization: 'Bearer no-va' },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-req-id')).toBe('abc');
    expect((await r.json()).url).toBe('/api/projects?limit=5');
    const req = seen.at(-1);
    // El del SP, no el del cliente (sin fijar cuál: otro test de este bloque lo
    // renueva y el orden de los tests no debe importar).
    expect(req.headers.authorization).toMatch(/^Bearer tok-\d+$/);
    expect(req.headers['x-session-token']).toBe('jwt-user-1');
  });

  it('releva la identidad SSO en x-dmh-* con secreto y pisa lo forjado por el cliente', async () => {
    const r = await fetch(`${base}/api/auth/sso/login`, {
      method: 'POST',
      headers: {
        // lo que pondría el proxy de Databricks en el hop del front:
        'x-forwarded-email': 'ana@empresa.com',
        'x-forwarded-preferred-username': 'ana@empresa.com',
        // intento de suplantación desde fetch() del navegador:
        'x-dmh-sso-email': 'victima@empresa.com',
        'x-dmh-proxy-secret': 'adivinado',
      },
    });
    expect(r.status).toBe(200);
    const req = seen.at(-1);
    expect(req.headers['x-dmh-sso-email']).toBe('ana@empresa.com');
    expect(req.headers['x-dmh-sso-username']).toBe('ana@empresa.com');
    expect(req.headers['x-dmh-proxy-secret']).toBe('shhh');
  });

  it('reenvía en streaming el body de un POST', async () => {
    const payload = JSON.stringify({ big: 'x'.repeat(50_000) });
    const r = await fetch(`${base}/api/changesets`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: payload,
    });
    expect((await r.json()).echo).toBe(payload);
  });

  it('ante 401 del proxy del backend reintenta una vez un GET con un token nuevo', async () => {
    fail401 = 1;
    const before = seen.length;
    const r = await fetch(`${base}/api/health`);
    expect(r.status).toBe(200);
    expect(seen.length).toBe(before + 2);                         // fallo + reintento
    expect(seen.at(-1).headers.authorization).toBe('Bearer tok-2');
  });

  it('un POST que recibe 401 no se reintenta (el body ya se consumió)', async () => {
    fail401 = 1;
    const before = seen.length;
    const r = await fetch(`${base}/api/auth/sso/login`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(401);
    expect(seen.length).toBe(before + 1);
  });
});

// ── integración: sesión en cookie HttpOnly ───────────────────────────────

describe('sesión en cookie HttpOnly', () => {
  let dist;
  let backend;
  let front;
  let legacy;
  let base;
  let legacyBase;
  const seen = [];
  let logoutStatus = 200;
  let gzipNext = false;     // el backend responde comprimido aunque se pida identity
  let plainNext = false;    // el backend responde 2xx sin JSON

  const session = (token, expiresIn) => JSON.stringify({ success: true, data: { token, user: { username: 'ana' }, expiresIn } });

  beforeAll(async () => {
    dist = mkdtempSync(path.join(tmpdir(), 'dist-'));
    writeFileSync(path.join(dist, 'index.html'), '<html>SPA</html>');
    backend = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        const cors = { 'access-control-allow-origin': 'https://otro.example', 'access-control-allow-credentials': 'true' };
        const send = (status, payload) => {
          if (gzipNext) {
            gzipNext = false;
            res.writeHead(status, { ...cors, 'content-type': 'application/json', 'content-encoding': 'gzip' });
            res.end(gzipSync(payload));
            return;
          }
          res.writeHead(status, { ...cors, 'content-type': 'application/json' });
          res.end(payload);
        };
        if (plainNext) {
          plainNext = false;
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('ok');
          return;
        }
        // Como un backend (o un proxy intermedio) que decodifica %XX y normaliza la ruta.
        const route = path.posix.normalize(decodeURIComponent(req.url.split('?')[0]));
        if (route === '/api/auth/sso/login') {
          if (req.headers['x-test-denied']) send(403, JSON.stringify({ detail: 'This account has no access.' }));
          else send(200, session('jwt-sso', 60));
        } else if (route === '/api/auth/refresh') {
          send(200, session('jwt-renewed', 3600));
        } else if (route === '/api/auth/logout') {
          send(logoutStatus, JSON.stringify({ success: logoutStatus < 300, data: { ok: true } }));
        } else {
          send(200, JSON.stringify({ echo: body || null, url: req.url }));
        }
      });
    });
    const backendUrl = `http://127.0.0.1:${await listen(backend)}`;
    const cfg = { dist, backend: backendUrl, tokens: new TokenCache(vi.fn()), timeoutMs: 5000 };
    front = createServer(cfg);
    base = `http://127.0.0.1:${await listen(front)}`;
    legacy = createServer({ ...cfg, sessionCookie: false });
    legacyBase = `http://127.0.0.1:${await listen(legacy)}`;
  });

  afterAll(() => {
    front?.close();
    legacy?.close();
    backend?.close();
    rmSync(dist, { recursive: true, force: true });
  });

  beforeEach(() => { logoutStatus = 200; gzipNext = false; plainNext = false; });

  it('login: el token sale del cuerpo y queda en una cookie HttpOnly (sin Secure por http)', async () => {
    const r = await fetch(`${base}/api/auth/sso/login`, { method: 'POST' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ success: true, data: { user: { username: 'ana' }, expiresIn: 60 } });
    expect(r.headers.getSetCookie()).toEqual(['dmh_session=jwt-sso; Path=/; Max-Age=60; HttpOnly; SameSite=Strict']);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(seen.at(-1).headers['accept-encoding']).toBe('identity');   // el cuerpo se lee: sin compresión
  });

  it('por https la cookie es __Host-dmh_session, con Secure y Max-Age = expiresIn', async () => {
    const r = await fetch(`${base}/api/auth/sso/login`, { method: 'POST', headers: { 'x-forwarded-proto': 'https' } });
    expect(r.headers.getSetCookie()).toEqual(['__Host-dmh_session=jwt-sso; Path=/; Max-Age=60; HttpOnly; SameSite=Strict; Secure']);
    expect((await r.json()).data).toEqual({ user: { username: 'ana' }, expiresIn: 60 });
  });

  it('la renovación usa la cookie vigente y deja la nueva, también con la respuesta comprimida', async () => {
    gzipNext = true;
    const r = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST', headers: { cookie: 'dmh_session=jwt-old', 'x-requested-with': 'XMLHttpRequest' },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-encoding')).toBeNull();
    expect((await r.json()).data).toEqual({ user: { username: 'ana' }, expiresIn: 3600 });
    expect(r.headers.getSetCookie()).toEqual(['dmh_session=jwt-renewed; Path=/; Max-Age=3600; HttpOnly; SameSite=Strict']);
    expect(seen.at(-1).headers['x-session-token']).toBe('jwt-old');
  });

  it('una ruta codificada no saca el token por otro camino', async () => {
    const headers = { cookie: 'dmh_session=jwt-ana', 'x-requested-with': 'XMLHttpRequest' };
    for (const url of ['/api/auth/%72efresh', '/api/x%2F..%2Fauth%2Frefresh', '/api/auth/sso/%6Cogin']) {
      const r = await fetch(`${base}${url}`, { method: 'POST', headers });
      expect(r.status).toBe(200);
      expect((await r.json()).data.token).toBeUndefined();
      expect(r.headers.getSetCookie()[0]).toMatch(/^dmh_session=jwt-(renewed|sso); Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict$/);
    }
  });

  it('una ruta con codificación inválida responde 400 sin llegar al backend', async () => {
    const before = seen.length;
    const r = await fetch(`${base}/api/%zz`);
    expect(r.status).toBe(400);
    expect(seen.length).toBe(before);
  });

  it('las demás respuestas de /api/auth/ salen tal cual', async () => {
    const r = await fetch(`${base}/api/auth/me`, { headers: { cookie: 'dmh_session=jwt-ana' } });
    expect(await r.json()).toEqual({ echo: null, url: '/api/auth/me' });
    expect(r.headers.getSetCookie()).toEqual([]);
  });

  it('un login rechazado o una respuesta sin token pasan tal cual, sin cookie', async () => {
    const bad = await fetch(`${base}/api/auth/sso/login`, { method: 'POST', headers: { 'x-test-denied': '1' } });
    expect(bad.status).toBe(403);
    expect(bad.headers.getSetCookie()).toEqual([]);
    expect(await bad.json()).toEqual({ detail: 'This account has no access.' });
    plainNext = true;
    const plain = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { 'x-requested-with': 'XMLHttpRequest' } });
    expect(await plain.text()).toBe('ok');
    expect(plain.headers.getSetCookie()).toEqual([]);
  });

  it('la cookie viaja al backend como X-Session-Token (manda sobre la del cliente) y las cookies del navegador no se reenvían', async () => {
    const r = await fetch(`${base}/api/projects`, { headers: { cookie: 'otra=1; dmh_session=jwt-ana', 'x-session-token': 'otro' } });
    expect(r.status).toBe(200);
    expect(seen.at(-1).headers['x-session-token']).toBe('jwt-ana');
    expect(seen.at(-1).headers.cookie).toBeUndefined();
  });

  it('CSRF: una escritura con la cookie y sin X-Requested-With no llega al backend', async () => {
    const before = seen.length;
    const blocked = await fetch(`${base}/api/changesets`, {
      method: 'POST', headers: { cookie: 'dmh_session=jwt-ana', 'content-type': 'text/plain' }, body: 'x',
    });
    expect(blocked.status).toBe(403);
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect((await fetch(`${base}/api/x`, { method, headers: { cookie: 'dmh_session=jwt-ana' } })).status).toBe(403);
    }
    expect(seen.length).toBe(before);
    const ok = await fetch(`${base}/api/changesets`, {
      method: 'POST', headers: { cookie: 'dmh_session=jwt-ana', 'x-requested-with': 'XMLHttpRequest' }, body: 'x',
    });
    expect(ok.status).toBe(200);
    // Una lectura con la cookie no lo necesita; una escritura sin la cookie (un
    // cliente con su propio X-Session-Token) tampoco.
    expect((await fetch(`${base}/api/projects`, { headers: { cookie: 'dmh_session=jwt-ana' } })).status).toBe(200);
    const api = await fetch(`${base}/api/changesets`, { method: 'POST', headers: { 'x-session-token': 'jwt-api' }, body: 'x' });
    expect(api.status).toBe(200);
    expect(seen.at(-1).headers['x-session-token']).toBe('jwt-api');
  });

  it('las respuestas de /api salen sin cabeceras CORS: este origen no atiende a otros', async () => {
    const r = await fetch(`${base}/api/projects`);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
    expect(r.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('logout: borra la cookie con la respuesta del backend, también si falla', async () => {
    const headers = { cookie: 'dmh_session=jwt-ana', 'x-requested-with': 'XMLHttpRequest' };
    const r = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers });
    expect(r.status).toBe(200);
    expect(r.headers.getSetCookie()).toEqual(['dmh_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict']);
    expect(seen.at(-1).headers['x-session-token']).toBe('jwt-ana');   // el backend audita quién salió
    logoutStatus = 500;
    const failed = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers });
    expect(failed.status).toBe(500);
    expect(failed.headers.getSetCookie()).toEqual(['dmh_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict']);
  });

  it('logout sin backend configurado: 502 y la cookie se borra igual', async () => {
    const none = createServer({ dist, backend: '', tokens: new TokenCache(vi.fn()), timeoutMs: 2000 });
    const noneBase = `http://127.0.0.1:${await listen(none)}`;
    try {
      const r = await fetch(`${noneBase}/api/auth/logout`, {
        method: 'POST', headers: { cookie: 'dmh_session=jwt-ana', 'x-requested-with': 'XMLHttpRequest' },
      });
      expect(r.status).toBe(502);
      expect(r.headers.getSetCookie()).toEqual(['dmh_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict']);
    } finally {
      none.close();
    }
  });

  it('logout ante un error interno del proxy: 502 y la cookie se borra igual', async () => {
    const broken = createServer({ dist, backend: 'no-es-una-url', tokens: new TokenCache(vi.fn()), timeoutMs: 2000 });
    const brokenBase = `http://127.0.0.1:${await listen(broken)}`;
    try {
      const r = await fetch(`${brokenBase}/api/auth/logout`, {
        method: 'POST', headers: { cookie: 'dmh_session=jwt-ana', 'x-requested-with': 'XMLHttpRequest' },
      });
      expect(r.status).toBe(502);
      expect(r.headers.getSetCookie()).toEqual(['dmh_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict']);
    } finally {
      broken.close();
    }
  });

  it('logout con el backend caído: 502 y la cookie se borra igual', async () => {
    const down = createServer({ dist, backend: 'http://127.0.0.1:1', tokens: new TokenCache(vi.fn()), timeoutMs: 2000 });
    const downBase = `http://127.0.0.1:${await listen(down)}`;
    try {
      const r = await fetch(`${downBase}/api/auth/logout`, {
        method: 'POST', headers: { cookie: 'dmh_session=jwt-ana', 'x-requested-with': 'XMLHttpRequest', 'x-forwarded-proto': 'https' },
      });
      expect(r.status).toBe(502);
      expect(r.headers.getSetCookie()).toEqual(['__Host-dmh_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure']);
    } finally {
      down.close();
    }
  });

  it('con sessionCookie: false el token queda en el cuerpo y la cookie no se usa', async () => {
    const r = await fetch(`${legacyBase}/api/auth/sso/login`, { method: 'POST', body: '{}' });
    expect((await r.json()).data.token).toBe('jwt-sso');
    expect(r.headers.getSetCookie()).toEqual([]);
    const w = await fetch(`${legacyBase}/api/changesets`, { method: 'POST', headers: { cookie: 'dmh_session=jwt-ana' }, body: 'x' });
    expect(w.status).toBe(200);
    expect(seen.at(-1).headers['x-session-token']).toBeUndefined();
    const out = await fetch(`${legacyBase}/api/auth/logout`, { method: 'POST' });
    expect(out.headers.getSetCookie()).toEqual([]);
  });
});
