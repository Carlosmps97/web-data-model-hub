/**
 * Tests del servidor de produccion del front (server.mjs, doc 36):
 * unit (path traversal, headers del proxy, cache de token) + integracion
 * (server real contra un backend fake: estaticos, fallback SPA, proxy con
 * Bearer, streaming de body y retry ante 401 del proxy de Databricks).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TokenCache, buildUpstreamHeaders, contentTypeFor, createServer, safeJoin } from './server.mjs';

// ── unit: safeJoin ───────────────────────────────────────────────────────

describe('safeJoin (anti path traversal)', () => {
  const root = path.join(path.sep, 'srv', 'dist');
  it('resuelve rutas normales dentro del root', () => {
    expect(safeJoin(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
    expect(safeJoin(root, '/')).toBe(root);
  });
  it('bloquea salidas del root y encoding invalido', () => {
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

// ── unit: headers hacia el backend ───────────────────────────────────────

describe('buildUpstreamHeaders', () => {
  it('quita host/authorization del cliente, pone el Bearer del SP y conserva X-Session-Token', () => {
    const out = buildUpstreamHeaders(
      { host: 'front.example.com', authorization: 'Bearer robado',
        'x-session-token': 'jwt-plataforma', 'content-type': 'application/json',
        'x-forwarded-for': '10.1.2.3' },
      'tok-sp', '192.168.0.9');
    expect(out.host).toBeUndefined();
    expect(out.authorization).toBe('Bearer tok-sp');
    expect(out['x-session-token']).toBe('jwt-plataforma');
    expect(out['x-forwarded-for']).toBe('10.1.2.3');   // el del proxy de Databricks manda
  });
  it('sin XFF entrante usa la IP del socket; sin token no agrega authorization', () => {
    const out = buildUpstreamHeaders({ accept: 'application/json' }, null, '127.0.0.1');
    expect(out.authorization).toBeUndefined();
    expect(out['x-forwarded-for']).toBe('127.0.0.1');
  });
  it('borra x-dmh-* forjados, releva la identidad atestada y adjunta el secreto (doc 38)', () => {
    const out = buildUpstreamHeaders(
      { 'x-dmh-sso-email': 'atacante@evil.com', 'x-dmh-proxy-secret': 'forjado',
        'x-forwarded-email': 'carlos.perez@corp.com',
        'x-forwarded-preferred-username': 'carlos.perez@corp.com',
        'x-forwarded-user': '12345' },
      'tok-sp', '10.0.0.1', 's3cr3t');
    expect(out['x-dmh-sso-email']).toBe('carlos.perez@corp.com');   // el del proxy, no el forjado
    expect(out['x-dmh-sso-username']).toBe('carlos.perez@corp.com');
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

// ── unit: TokenCache ─────────────────────────────────────────────────────

describe('TokenCache', () => {
  it('acuna una vez, cachea, y un mint concurrente se comparte', async () => {
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

// ── integracion: server real + backend fake ──────────────────────────────

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

describe('server integrado (estaticos + proxy)', () => {
  let dist;
  let backend;
  let backendPort;
  let front;
  let base;
  const seen = [];          // requests que recibio el backend fake
  let fail401 = 0;          // cuantos proximos requests responden 401

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

  it('proxya /api con Bearer del SP, conserva X-Session-Token y query string', async () => {
    const r = await fetch(`${base}/api/projects?limit=5`, {
      headers: { 'x-session-token': 'jwt-user-1', authorization: 'Bearer no-va' },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-req-id')).toBe('abc');
    expect((await r.json()).url).toBe('/api/projects?limit=5');
    const req = seen.at(-1);
    expect(req.headers.authorization).toBe('Bearer tok-1');       // el del SP, no el del cliente
    expect(req.headers['x-session-token']).toBe('jwt-user-1');
  });

  it('releva la identidad SSO en x-dmh-* con secreto y pisa lo forjado por el cliente', async () => {
    const r = await fetch(`${base}/api/auth/sso/login`, {
      method: 'POST',
      headers: {
        // lo que pondria el proxy de Databricks en el hop del front:
        'x-forwarded-email': 'carlos.perez@corp.com',
        'x-forwarded-preferred-username': 'carlos.perez@corp.com',
        // intento de suplantacion desde fetch() del navegador:
        'x-dmh-sso-email': 'victima@corp.com',
        'x-dmh-proxy-secret': 'adivinado',
      },
    });
    expect(r.status).toBe(200);
    const req = seen.at(-1);
    expect(req.headers['x-dmh-sso-email']).toBe('carlos.perez@corp.com');
    expect(req.headers['x-dmh-sso-username']).toBe('carlos.perez@corp.com');
    expect(req.headers['x-dmh-proxy-secret']).toBe('shhh');
  });

  it('streamea el body de un POST', async () => {
    const payload = JSON.stringify({ big: 'x'.repeat(50_000) });
    const r = await fetch(`${base}/api/changesets`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: payload,
    });
    expect((await r.json()).echo).toBe(payload);
  });

  it('ante 401 del proxy del backend reintenta UNA vez un GET con token fresco', async () => {
    fail401 = 1;
    const before = seen.length;
    const r = await fetch(`${base}/api/health`);
    expect(r.status).toBe(200);
    expect(seen.length).toBe(before + 2);                         // fallo + reintento
    expect(seen.at(-1).headers.authorization).toBe('Bearer tok-2');
  });

  it('un POST que recibe 401 NO se reintenta (el body ya se consumio)', async () => {
    fail401 = 1;
    const before = seen.length;
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(401);
    expect(seen.length).toBe(before + 1);
  });
});
