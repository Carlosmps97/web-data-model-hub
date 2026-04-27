// Proxy: GET /api/agent/engines -> GET {AGENT_BACKEND_URL}/api/engines
import type { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/agent/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return proxyToBackend(req, '/api/engines');
}
