// Proxy: POST/GET /api/agent/conversations/{conversationId}/model
//   -> POST/GET {AGENT_BACKEND_URL}/api/conversations/{conversationId}/model
//
// POST: ejecuta un turno del pipeline de modelado. Body multipart/form-data
//       con campos opcionales `context_text`, `excel_file`, `engine`.
//       Puede tardar mucho cuando el Excel tiene muchas tablas (chunked
//       pipeline: 12 tablas → 3 lotes × ~60s = ~180s). maxDuration garantiza
//       que Next.js no cierre el request antes de que el backend termine.
// GET:  retorna el último modelo generado (sin reejecutar). 404 si todavía
//       no hubo turnos exitosos.
import type { NextRequest } from 'next/server';
import { proxyToBackend } from '@/server/agent/proxy';

export const dynamic = 'force-dynamic';
// 10 minutos — suficiente para un Excel con 30+ tablas procesadas en lotes.
export const maxDuration = 600;

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
