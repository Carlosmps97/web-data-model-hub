// Proxy: GET /api/agent/health -> GET {AGENT_BACKEND_URL}/api/health
//
// Pass-through directo. No transformamos la respuesta; el cliente del
// browser recibe el body verbatim del FastAPI.
import type { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/agent/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return proxyToBackend(req, '/api/health');
}
