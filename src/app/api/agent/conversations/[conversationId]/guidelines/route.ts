// Proxy: POST /api/agent/conversations/{conversationId}/guidelines
//   -> POST {AGENT_BACKEND_URL}/api/conversations/{conversationId}/guidelines
//
// El body es multipart/form-data con un único campo `file`. El proxy
// reenvía el body como stream sin re-empaquetarlo, así el boundary se
// preserva.
import type { NextRequest } from 'next/server';
import { proxyToBackend } from '@/server/agent/proxy';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ conversationId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { conversationId } = await params;
  return proxyToBackend(
    req,
    `/api/conversations/${encodeURIComponent(conversationId)}/guidelines`,
  );
}
