// Proxy: POST /api/agent/conversations -> POST {AGENT_BACKEND_URL}/api/conversations
//
// Body JSON: `{ conversation_id: string (UUID v4), engine: string }`.
// El backend devuelve 201 si creó la conversación, o 200 si ya existía
// (es idempotente). El status se reenvía verbatim.
import type { NextRequest } from 'next/server';
import { proxyToBackend } from '@/server/agent/proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return proxyToBackend(req, '/api/conversations');
}
