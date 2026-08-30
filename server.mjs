/**
 * Servidor de produccion del front (doc 36) - reemplaza a `vite preview`.
 *
 * Dos responsabilidades, cero dependencias (solo node:*):
 *  1. Servir el build de la SPA (`dist/`) con fallback SPA (client routing).
 *  2. Proxiar `/api/*` al backend (otra Databricks App) SERVIDOR-A-SERVIDOR,
 *     adjuntando un token OAuth M2M del service principal del front.
 *
 * Por que existe: cada Databricks App vive detras de su propio muro SSO por
 *  subdominio. Con `vite preview` (estaticos puros) era el NAVEGADOR quien
 *  cruzaba al dominio del backend y chocaba con ese muro (cookie por app,
 *  proxy que no inicia SSO en navegaciones cross-site -> "{}" / "Failed to
 *  fetch"). Con este server el navegador habla con UN solo origen y el cruce
 *  al backend es servidor-a-servidor con Bearer, el patron estandar de las
 *  parejas front/back en Databricks Apps.
 *
 * Entorno (todo inyectado por Databricks Apps salvo BACKEND_API_URL):
 *  - DATABRICKS_APP_PORT  puerto a escuchar (local: PORT o 3000)
 *  - DATABRICKS_HOST      workspace (para acunar el token OAuth)
 *  - DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET  credenciales del SP
 *  - BACKEND_API_URL      URL publica de la app backend (variable del bundle)
 *  - PROXY_SHARED_SECRET  secreto compartido con el backend (doc 38): viaja en
 *    `x-dmh-proxy-secret` y autentica el relay de identidad SSO (valueFrom en
 *    app.yaml; el backend lee el MISMO secret del scope)
 *
 * Relay de identidad SSO (doc 38): el proxy de Databricks autentica al usuario
 *  en ESTE dominio e inyecta X-Forwarded-Email / -Preferred-Username / -User.
 *  Este server copia esa identidad a headers propios `x-dmh-sso-*` (que el hop
 *  del backend no pisa) y BORRA cualquier `x-dmh-*` que venga del cliente — un
 *  fetch() del navegador jamas puede suplantar la identidad relevada.
 *
 * Sin DATABRICKS_CLIENT_ID/SECRET (corrida local) el proxy NO adjunta Bearer:
 *  `BACKEND_API_URL=http://localhost:8000 node server.mjs` simula produccion
 *  completa contra el uvicorn local.
 *
 * ONE-TIME por workspace: el SP del front necesita CAN_USE sobre la app
 *  backend (doc 36 §5).
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Estaticos ────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  // Plantilla de la carga masiva (doc 55): public/templates/*.xlsx
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

export function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** Une root+urlPath SIN permitir path traversal; null si se sale de root. */
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

// Headers que NO se reenvian: hop-by-hop + host + authorization entrante
// (la autorizacion hacia el backend la pone ESTE server, nunca el cliente).
const DROP_HEADERS = new Set([
  'host', 'connection', 'keep-alive', 'upgrade', 'te', 'trailer',
  'proxy-authorization', 'proxy-authenticate', 'authorization',
]);

export function buildUpstreamHeaders(incoming, token, clientIp, proxySecret = '') {
  const out = {};
  for (const [key, value] of Object.entries(incoming)) {
    const k = key.toLowerCase();
    if (DROP_HEADERS.has(k)) continue;
    // Anti-suplantacion (doc 38): los `x-dmh-*` SOLO los pone este server; un
    // fetch() del navegador con esos headers forjados se descarta siempre.
    if (k.startsWith('x-dmh-')) continue;
    out[k] = value;
  }
  if (token) out.authorization = `Bearer ${token}`;
  // Relay de identidad SSO (doc 38): la identidad que el proxy de Databricks
  // atesto EN ESTE dominio se copia a headers propios (el proxy del hop
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
  // limiter del backend toma la PRIMERA IP de esta cadena.
  if (!out['x-forwarded-for'] && clientIp) out['x-forwarded-for'] = clientIp;
  return out;
}

const RESPONSE_DROP = new Set(['connection', 'keep-alive', 'transfer-encoding']);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function proxyApi(req, res, cfg, attempt = 0) {
  let token = null;
  if (cfg.clientId && cfg.clientSecret) {
    try {
      token = await cfg.tokens.get(cfg.host, cfg.clientId, cfg.clientSecret);
    } catch (err) {
      console.error('[proxy] no se pudo acunar el token del SP:', err.message);
      sendJson(res, 502, { detail: 'Backend authorization unavailable.' });
      return;
    }
  }
  const target = new URL(req.url, cfg.backend);
  const client = target.protocol === 'http:' ? http : https;
  const upstream = client.request(target, {
    method: req.method,
    headers: buildUpstreamHeaders(req.headers, token, req.socket?.remoteAddress,
                                  cfg.proxySecret),
    timeout: cfg.timeoutMs,
  }, (upRes) => {
    // Token vencido/revocado a mitad de vida: el proxy de Databricks del
    // backend responde 401/403 propios. Reintento UNA vez con token fresco,
    // solo para metodos sin body (el body ya se consumio del stream).
    if ((upRes.statusCode === 401 || upRes.statusCode === 403)
        && attempt === 0 && token
        && (req.method === 'GET' || req.method === 'HEAD')) {
      upRes.resume(); // descartar el body del intento fallido
      cfg.tokens.invalidate();
      proxyApi(req, res, cfg, 1);
      return;
    }
    const headers = {};
    for (const [key, value] of Object.entries(upRes.headers)) {
      if (RESPONSE_DROP.has(key.toLowerCase())) continue;
      headers[key] = value;
    }
    res.writeHead(upRes.statusCode ?? 502, headers);
    upRes.pipe(res); // streaming: reporting/diagram emiten payloads grandes
  });
  upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
  upstream.on('error', (err) => {
    console.error(`[proxy] ${req.method} ${req.url}:`, err.message);
    if (!res.headersSent) {
      sendJson(res, 502, { detail: 'Backend unreachable.' });
    } else {
      res.destroy();
    }
  });
  req.pipe(upstream);
}

// ── Estaticos + fallback SPA ─────────────────────────────────────────────

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
  // Assets con hash en el nombre: cache fuerte. index.html: siempre revalidar.
  const immutable = urlPath.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': contentTypeFor(filePath),
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

// ── Server ───────────────────────────────────────────────────────────────

export function createServer(cfg) {
  return http.createServer((req, res) => {
    if (req.url === '/api' || req.url.startsWith('/api/')) {
      if (!cfg.backend) {
        sendJson(res, 502, { detail: 'BACKEND_API_URL is not configured.' });
        return;
      }
      proxyApi(req, res, cfg);
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
  };
  const port = Number(process.env.DATABRICKS_APP_PORT ?? process.env.PORT ?? 3000);
  createServer(cfg).listen(port, '0.0.0.0', () => {
    console.log(`[server] escuchando en :${port} | backend: ${cfg.backend || '(no configurado)'}`
      + ` | auth SP: ${cfg.clientId ? 'si' : 'no (passthrough local)'}`
      + ` | relay SSO: ${cfg.proxySecret ? 'con secreto' : 'sin secreto'}`);
  });
}
