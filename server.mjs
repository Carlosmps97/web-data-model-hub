/**
 * Servidor de producción del front.
 *
 * Tres responsabilidades, cero dependencias (solo node:*):
 *  1. Servir el build de la SPA (`dist/`) con fallback SPA (client routing) y
 *     las cabeceras de seguridad del navegador (CSP y afines).
 *  2. Reenviar `/api/*` al backend (otra Databricks App) servidor-a-servidor,
 *     adjuntando un token OAuth M2M del service principal del front.
 *  3. Guardar el token de sesión del usuario en una cookie HttpOnly: el
 *     JavaScript de la página nunca lo recibe (ver «Sesión en cookie HttpOnly»).
 *
 * Por qué existe: cada Databricks App vive detrás de su propio muro SSO por
 *  subdominio. Si el navegador llamara directamente al dominio del backend,
 *  chocaría con ese muro (cookie por app; el proxy no inicia SSO en
 *  navegaciones cross-site → "{}" / "Failed to fetch"). Con este servidor el
 *  navegador habla con un solo origen y el cruce al backend es
 *  servidor-a-servidor con Bearer, el patrón estándar de las parejas
 *  front/back en Databricks Apps.
 *
 * Entorno (todo inyectado por Databricks Apps salvo BACKEND_API_URL y
 * SESSION_COOKIE):
 *  - DATABRICKS_APP_PORT  puerto a escuchar (local: PORT o 3000)
 *  - DATABRICKS_HOST      workspace (para acuñar el token OAuth)
 *  - DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET  credenciales del SP
 *  - BACKEND_API_URL      URL pública de la app backend (variable del bundle)
 *  - PROXY_SHARED_SECRET  secreto compartido con el backend: viaja en
 *    `x-dmh-proxy-secret` y autentica el relay de identidad SSO (valueFrom en
 *    app.yaml; el backend lee el mismo secreto del scope)
 *  - SESSION_COOKIE       opcional, fuera de app.yaml: `false` apaga la cookie
 *    de sesión (el token vuelve a viajar en el cuerpo y la SPA lo guarda en
 *    memoria, sin sobrevivir a una recarga). Sin definir: cookie.
 *
 * Relay de identidad SSO: el proxy de Databricks autentica al usuario en este
 *  dominio e inyecta X-Forwarded-Email / -Preferred-Username / -User. Este
 *  servidor copia esa identidad a headers propios `x-dmh-sso-*` (que el hop
 *  del backend no pisa) y borra cualquier `x-dmh-*` que venga del cliente: un
 *  fetch() del navegador nunca puede suplantar la identidad relevada.
 *
 * Sin DATABRICKS_CLIENT_ID/SECRET (corrida local) el proxy no adjunta Bearer:
 *  `BACKEND_API_URL=http://localhost:8000 node server.mjs` simula producción
 *  completa contra el uvicorn local.
 *
 * Configuración única por workspace: el SP del front necesita CAN_USE sobre
 *  la app backend.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

// ── Estáticos ────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  // Plantilla de la carga masiva: public/templates/*.xlsx
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
};

// ── Cabeceras de seguridad (estáticos y respuestas propias) ─────────────
//
// Content-Security-Policy: todo sale del propio origen. `style-src
// 'unsafe-inline'` porque los componentes aplican estilos en línea y algunas
// librerías insertan <style> al cargar; los scripts no admiten nada en línea
// ni `eval`. `img-src data: blob:` cubre los íconos embebidos y las imágenes
// que el navegador arma al exportar; `connect-src 'self'`: la API va por este
// mismo origen (/api). `frame-ancestors 'self'`: la app no se embebe en sitios
// ajenos. Las respuestas de /api conservan las cabeceras del backend, salvo las
// de CORS (ver «Sesión en cookie HttpOnly»).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

export const SECURITY_HEADERS = Object.freeze({
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
});

/** ¿El request llegó por HTTPS? En Databricks Apps el proxy termina TLS y lo
 *  indica en X-Forwarded-Proto (se toma el primer valor si un proxy encadena
 *  varios). */
const viaHttps = (req) => String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https'
  || Boolean(req.socket?.encrypted);

/** Cabeceras de seguridad de una respuesta propia. HSTS solo si el request
 *  llegó por HTTPS: en una corrida local por http no aplica. */
export function securityHeaders(req) {
  if (viaHttps(req)) {
    return { ...SECURITY_HEADERS, 'strict-transport-security': 'max-age=31536000; includeSubDomains' };
  }
  return SECURITY_HEADERS;
}

export function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** Une root+urlPath sin permitir path traversal; null si se sale de root. */
export function safeJoin(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  let joined = path.normalize(path.join(root, decoded));
  if (joined.length > 1 && joined.endsWith(path.sep)) joined = joined.slice(0, -1);
  if (joined !== root && !joined.startsWith(root + path.sep)) return null;
  return joined;
}

// ── Token OAuth M2M del service principal (cache ~expiry-5min) ───────────

export class TokenCache {
  constructor(fetchImpl = globalThis.fetch) {
    this._fetch = fetchImpl;
    this._token = null;
    this._expiresAt = 0;
    this._inflight = null; // un solo mint concurrente (N usuarios en paralelo)
  }

  invalidate() {
    this._token = null;
    this._expiresAt = 0;
  }

  async get(host, clientId, clientSecret) {
    if (this._token && Date.now() < this._expiresAt - 5 * 60 * 1000) {
      return this._token;
    }
    if (!this._inflight) {
      this._inflight = this._mint(host, clientId, clientSecret)
        .finally(() => { this._inflight = null; });
    }
    return this._inflight;
  }

  async _mint(host, clientId, clientSecret) {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await this._fetch(`${host}/oidc/v1/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${basic}`,
      },
      body: 'grant_type=client_credentials&scope=all-apis',
    });
    if (!res.ok) {
      throw new Error(`token mint failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    this._token = data.access_token;
    this._expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
    return this._token;
  }
}

// ── Proxy /api -> backend ────────────────────────────────────────────────

// Headers que no se reenvían: hop-by-hop + host + authorization entrante
// (la autorización hacia el backend la pone este servidor, nunca el cliente)
// + cookie (las cookies del navegador son de este dominio; la sesión del
// usuario viaja al backend en X-Session-Token).
const DROP_HEADERS = new Set([
  'host', 'connection', 'keep-alive', 'upgrade', 'te', 'trailer',
  'proxy-authorization', 'proxy-authenticate', 'authorization', 'cookie',
]);

export function buildUpstreamHeaders(incoming, token, clientIp, proxySecret = '') {
  const out = {};
  for (const [key, value] of Object.entries(incoming)) {
    const k = key.toLowerCase();
    if (DROP_HEADERS.has(k)) continue;
    // Anti-suplantación: los `x-dmh-*` solo los pone este servidor; si un
    // fetch() del navegador trae esos headers forjados, se descartan siempre.
    if (k.startsWith('x-dmh-')) continue;
    out[k] = value;
  }
  if (token) out.authorization = `Bearer ${token}`;
  // Relay de identidad SSO: la identidad que el proxy de Databricks atestó
  // en este dominio se copia a headers propios (el proxy del hop
  // backend puede pisar los X-Forwarded-*; los x-dmh-* llegan intactos) y el
  // secreto compartido los autentica en el backend.
  if (out['x-forwarded-email']) out['x-dmh-sso-email'] = out['x-forwarded-email'];
  if (out['x-forwarded-preferred-username']) {
    out['x-dmh-sso-username'] = out['x-forwarded-preferred-username'];
  }
  if (out['x-forwarded-user']) out['x-dmh-sso-user-id'] = out['x-forwarded-user'];
  if (proxySecret) out['x-dmh-proxy-secret'] = proxySecret;
  // El X-Forwarded-For del proxy de Databricks (cliente real) se conserva;
  // si no vino (corrida local directa), se usa el peer del socket. El rate
  // limiter del backend toma la primera IP de esta cadena.
  if (!out['x-forwarded-for'] && clientIp) out['x-forwarded-for'] = clientIp;
  return out;
}

// ── Sesión en cookie HttpOnly ────────────────────────────────────────────
//
// El token de sesión que emite el backend no llega al JavaScript de la página.
// Las respuestas 2xx de /api/auth/* se leen enteras: si traen el token (login
// SSO y renovación), este servidor lo saca del cuerpo y lo entrega en una
// cookie; en cada request a /api la cookie vuelve al backend como
// `X-Session-Token`. La ruta se evalúa como la resuelve el backend (`apiRoute`):
// una ruta con %XX no saca el token por otro camino.
//  - HttpOnly: el script de la página no la lee; un XSS no se lleva el token.
//  - SameSite=Strict: el navegador no la envía en requests iniciados desde
//    otro sitio.
//  - Por HTTPS se llama `__Host-dmh_session` (Secure, Path=/, sin Domain):
//    ningún otro subdominio puede fijarla ni pisarla. En una corrida local por
//    http se llama `dmh_session`, sin Secure.
//  - Max-Age = `expiresIn` del backend: la cookie vence junto con el token.
// CSRF: un POST/PUT/PATCH/DELETE que se autentica con la cookie debe traer
// `X-Requested-With` (lo agrega el cliente HTTP de la SPA). Otro origen no
// puede agregar ese header sin un preflight CORS aprobado, y las respuestas de
// /api salen sin cabeceras CORS: este origen no atiende pedidos de otros
// orígenes (la SPA es del mismo origen). El logout borra la cookie aunque el
// backend falle.
// Con `sessionCookie: false` (SESSION_COOKIE=false) la cookie no existe: el
// token viaja en el cuerpo y la SPA lo guarda en memoria.

export const SESSION_COOKIE = 'dmh_session';
const AUTH_PREFIX = '/api/auth/';
const LOGOUT_ROUTE = '/api/auth/logout';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Vida de la cookie cuando la respuesta no trae `expiresIn`.
const DEFAULT_SESSION_SECONDS = 3600;

/** Ruta de un request tal como la resuelve el backend: con los %XX
 *  decodificados y normalizada (`/api/auth/%72efresh` es `/api/auth/refresh`);
 *  null si la codificación es inválida. */
export function apiRoute(url) {
  try {
    return path.posix.normalize(decodeURIComponent(new URL(url, 'http://localhost').pathname));
  } catch {
    return null;
  }
}

/** Nombre de la cookie de sesión según el transporte del request. */
export function sessionCookieName(req) {
  return viaHttps(req) ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
}

/** Valor de la cookie `name` en una cabecera Cookie; null si falta o está vacía. */
export function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/** Set-Cookie de la sesión; `maxAge` 0 la borra. */
export function sessionCookie(req, value, maxAge) {
  const attrs = [`${sessionCookieName(req)}=${value}`, 'Path=/', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Strict'];
  if (viaHttps(req)) attrs.push('Secure');
  return attrs.join('; ');
}

/** Agrega un Set-Cookie a las cabeceras de una respuesta (conserva los que traiga). */
function addCookie(headers, cookie) {
  const prev = headers['set-cookie'];
  headers['set-cookie'] = [...(prev === undefined ? [] : [prev].flat()), cookie];
  return headers;
}

/** JSON de un cuerpo, comprimido o no; null si no lo es. */
function decodeJson(buf, encoding) {
  try {
    let raw = null;
    if (!encoding || encoding === 'identity') raw = buf;
    else if (encoding === 'gzip') raw = zlib.gunzipSync(buf);
    else if (encoding === 'br') raw = zlib.brotliDecompressSync(buf);
    else if (encoding === 'deflate') raw = zlib.inflateSync(buf);
    return raw === null ? null : JSON.parse(raw.toString('utf8'));
  } catch {
    return null;
  }
}

/** Respuesta 2xx de /api/auth/*: si trae el token (login SSO, renovación),
 *  pasa del cuerpo a la cookie. Un cuerpo sin token (otra forma,
 *  no JSON) sale tal cual. */
function deliverSession(req, res, upRes, headers) {
  const chunks = [];
  upRes.on('data', (chunk) => chunks.push(chunk));
  upRes.on('error', () => res.destroy());
  upRes.on('end', () => {
    const original = Buffer.concat(chunks);
    const body = decodeJson(original, String(upRes.headers['content-encoding'] ?? '').trim().toLowerCase());
    const data = body?.data;
    if (body?.success === true && typeof data?.token === 'string' && data.token) {
      const { token, ...rest } = data;
      const ttl = Number(data.expiresIn);
      const payload = Buffer.from(JSON.stringify({ ...body, data: rest }));
      delete headers['content-encoding'];
      headers['content-length'] = payload.length;
      headers['cache-control'] = 'no-store';
      addCookie(headers, sessionCookie(req, token, Number.isSafeInteger(ttl) && ttl > 0 ? ttl : DEFAULT_SESSION_SECONDS));
      res.writeHead(upRes.statusCode, headers);
      res.end(payload);
      return;
    }
    res.writeHead(upRes.statusCode, headers);
    res.end(original);
  });
}

/** Set-Cookie que borra la sesión cuando el request es el logout: sale con
 *  cualquier resultado del backend. */
function logoutClearing(req, cfg, route = apiRoute(req.url)) {
  return cfg.sessionCookie !== false && route === LOGOUT_ROUTE ? { 'set-cookie': sessionCookie(req, '', 0) } : {};
}

const RESPONSE_DROP = new Set(['connection', 'keep-alive', 'transfer-encoding']);

function sendJson(res, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...extra,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

async function proxyApi(req, res, cfg, attempt = 0) {
  const route = apiRoute(req.url);
  if (route === null) {
    req.resume(); // descarta el body
    sendJson(res, 400, { detail: 'Bad path.' });
    return;
  }
  const clearing = logoutClearing(req, cfg, route);
  if (!cfg.backend) {
    sendJson(res, 502, { detail: 'BACKEND_API_URL is not configured.' }, clearing);
    return;
  }
  const cookieMode = cfg.sessionCookie !== false;
  const session = cookieMode ? readCookie(req.headers.cookie, sessionCookieName(req)) : null;
  if (session && !SAFE_METHODS.has(req.method) && !req.headers['x-requested-with']) {
    req.resume(); // descarta el body
    sendJson(res, 403, { detail: 'Request blocked: missing X-Requested-With header.' });
    return;
  }
  const readsSession = cookieMode && route.startsWith(AUTH_PREFIX);
  const target = new URL(req.url, cfg.backend);
  let token = null;
  if (cfg.clientId && cfg.clientSecret) {
    try {
      token = await cfg.tokens.get(cfg.host, cfg.clientId, cfg.clientSecret);
    } catch (err) {
      console.error('[proxy] no se pudo acunar el token del SP:', err.message);
      sendJson(res, 502, { detail: 'Backend authorization unavailable.' }, clearing);
      return;
    }
  }
  const client = target.protocol === 'http:' ? http : https;
  const headers = buildUpstreamHeaders(req.headers, token, req.socket?.remoteAddress, cfg.proxySecret);
  if (session) headers['x-session-token'] = session;
  // El cuerpo de estas respuestas se lee para sacar el token: sin compresión.
  if (readsSession) headers['accept-encoding'] = 'identity';
  const upstream = client.request(target, {
    method: req.method,
    headers,
    timeout: cfg.timeoutMs,
  }, (upRes) => {
    // Token vencido o revocado a mitad de vida: el proxy de Databricks del
    // backend responde con 401/403 propios. Se reintenta una vez con un token
    // nuevo, solo para métodos sin body (el body ya se consumió del stream).
    if ((upRes.statusCode === 401 || upRes.statusCode === 403)
        && attempt === 0 && token
        && (req.method === 'GET' || req.method === 'HEAD')) {
      upRes.resume(); // descarta el body del intento fallido
      cfg.tokens.invalidate();
      proxyApi(req, res, cfg, 1);
      return;
    }
    const out = {};
    for (const [key, value] of Object.entries(upRes.headers)) {
      const k = key.toLowerCase();
      if (RESPONSE_DROP.has(k) || k.startsWith('access-control-')) continue;
      out[key] = value;
    }
    if (clearing['set-cookie']) addCookie(out, clearing['set-cookie']);
    if (readsSession && upRes.statusCode >= 200 && upRes.statusCode < 300) {
      deliverSession(req, res, upRes, out);
      return;
    }
    res.writeHead(upRes.statusCode ?? 502, out);
    upRes.pipe(res); // streaming: reporting/diagram emiten payloads grandes
  });
  upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
  upstream.on('error', (err) => {
    console.error(`[proxy] ${req.method} ${req.url}:`, err.message);
    if (!res.headersSent) {
      sendJson(res, 502, { detail: 'Backend unreachable.' }, clearing);
    } else {
      res.destroy();
    }
  });
  req.pipe(upstream);
}

// ── Estáticos + fallback SPA ─────────────────────────────────────────────

function serveStatic(req, res, cfg) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { detail: 'Method not allowed.' });
    return;
  }
  const urlPath = req.url.split('?')[0];
  const indexPath = path.join(cfg.dist, 'index.html');
  let filePath = safeJoin(cfg.dist, urlPath);
  if (!filePath) {
    sendJson(res, 400, { detail: 'Bad path.' });
    return;
  }
  let stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  if (stat?.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  }
  if (!stat) {
    filePath = indexPath; // fallback SPA: /login, /model, ... -> index.html
    if (!fs.existsSync(filePath)) {
      sendJson(res, 404, { detail: 'dist/ not built.' });
      return;
    }
  }
  // Assets con hash en el nombre: cache fuerte. index.html: se revalida siempre.
  const immutable = urlPath.startsWith('/assets/');
  res.writeHead(200, {
    ...securityHeaders(req),
    'content-type': contentTypeFor(filePath),
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

// ── Servidor ─────────────────────────────────────────────────────────────

/** Manejador de `/api/*`: el proxy al backend con la sesión en cookie. Lo usan
 *  este servidor y el servidor de desarrollo de Vite (vite.config.ts). */
export function createApiHandler(cfg) {
  return (req, res) => {
    proxyApi(req, res, cfg).catch((err) => {
      console.error(`[proxy] ${req.method} ${req.url}:`, err.message);
      if (!res.headersSent) sendJson(res, 502, { detail: 'Backend unreachable.' }, logoutClearing(req, cfg));
      else res.destroy();
    });
  };
}

export function createServer(cfg) {
  const api = createApiHandler(cfg);
  return http.createServer((req, res) => {
    if (req.url === '/api' || req.url.startsWith('/api/')) {
      api(req, res);
      return;
    }
    serveStatic(req, res, cfg);
  });
}

function normalizeHost(raw) {
  if (!raw) return '';
  return /^https?:\/\//.test(raw) ? raw.replace(/\/+$/, '') : `https://${raw}`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const cfg = {
    dist: path.join(dirname, 'dist'),
    backend: (process.env.BACKEND_API_URL ?? '').replace(/\/+$/, ''),
    host: normalizeHost(process.env.DATABRICKS_HOST),
    clientId: process.env.DATABRICKS_CLIENT_ID ?? '',
    clientSecret: process.env.DATABRICKS_CLIENT_SECRET ?? '',
    proxySecret: process.env.PROXY_SHARED_SECRET ?? '',
    tokens: new TokenCache(),
    timeoutMs: 120_000,
    sessionCookie: process.env.SESSION_COOKIE !== 'false',
  };
  const port = Number(process.env.DATABRICKS_APP_PORT ?? process.env.PORT ?? 3000);
  createServer(cfg).listen(port, '0.0.0.0', () => {
    console.log(`[server] escuchando en :${port} | backend: ${cfg.backend || '(no configurado)'}`
      + ` | auth SP: ${cfg.clientId ? 'si' : 'no (passthrough local)'}`
      + ` | relay SSO: ${cfg.proxySecret ? 'con secreto' : 'sin secreto'}`
      + ` | sesión: ${cfg.sessionCookie ? 'cookie HttpOnly' : 'token en el cuerpo'}`);
  });
}
