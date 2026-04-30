// Proxy: DELETE /api/agent/conversations/{conversationId}
//   -> DELETE {AGENT_BACKEND_URL}/api/conversations/{conversationId}
//
// El backend valida que el id sea UUID v4 estricto y devuelve 404 si la
// conversación no existe.
//
// NOTA: en Next.js 16, `params` es una Promise que hay que `await`-ear.
// Usamos la firma explícita en vez de `RouteContext<>` para evitar el
// dependency en los tipos auto-generados (que solo existen tras un
// `next dev` o `next typegen`).
import type { NextRequest } from 'next/server';
import { proxyToBackend } from '@/server/agent/proxy';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ conversationId: string }>;
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { conversationId } = await params;
  return proxyToBackend(req, `/api/conversations/${encodeURIComponent(conversationId)}`);
}
