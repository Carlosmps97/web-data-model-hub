// Proxy: POST/GET /api/agent/conversations/{conversationId}/model
//   -> POST/GET {AGENT_BACKEND_URL}/api/conversations/{conversationId}/model
//
// POST: ejecuta un turno del pipeline de modelado. Body multipart/form-data
//       con campos opcionales `context_text`, `excel_file`, `engine`.
//       Es la operación cara; el server.ts aplica un timeout más largo
//       cuando detecta el path termina en `/model`.
// GET:  retorna el último modelo generado (sin reejecutar). 404 si todavía
//       no hubo turnos exitosos.
import type { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/agent/server';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ conversationId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { conversationId } = await params;
  return proxyToBackend(
    req,
    `/api/conversations/${encodeURIComponent(conversationId)}/model`,
  );
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { conversationId } = await params;
  return proxyToBackend(
    req,
    `/api/conversations/${encodeURIComponent(conversationId)}/model`,
  );
}
