import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import { createApiHandler, TokenCache } from './server.mjs';

// En desarrollo, /api pasa por el mismo proxy de producción (server.mjs): la
// sesión viaja en la cookie HttpOnly, con las mismas reglas. Backend:
// BACKEND_API_URL o el FastAPI local en :8000.
function apiMiddleware() {
  const api = createApiHandler({
    backend: (process.env.BACKEND_API_URL || 'http://localhost:8000').replace(/\/+$/, ''),
    proxySecret: process.env.PROXY_SHARED_SECRET ?? '',
    tokens: new TokenCache(),
    timeoutMs: 120_000,
    sessionCookie: process.env.SESSION_COOKIE !== 'false',
  });
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if (req.url === '/api' || req.url?.startsWith('/api/')) api(req, res);
    else next();
  };
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'dmh-api-proxy',
      configureServer(server) { server.middlewares.use(apiMiddleware()); },
      configurePreviewServer(server) { server.middlewares.use(apiMiddleware()); },
    },
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 3000,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'server.test.mjs'],
  },
});
