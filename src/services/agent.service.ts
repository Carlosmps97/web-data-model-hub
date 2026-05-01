// ─────────────────────────────────────────────────────────────────────────
//  Cliente HTTP del browser para el agent-modeler.
//
//  Llama directamente al backend FastAPI usando NEXT_PUBLIC_API_URL.
//  Las funciones devuelven el body parseado o lanzan `AgentClientError`
//  con `status`, `code` y `detail` para que el caller pueda discriminar
//  errores semánticos (ej. 404 en GET /model = "todavía sin modelo").
// ─────────────────────────────────────────────────────────────────────────

import type {
  AgentEngine,
  AgentErrorResponse,
  CreateConversationResponse,
  DeleteConversationResponse,
  EnginesResponse,
  GuidelinesUploadResponse,
  HealthResponse,
  ModelingResponse,
} from '@/lib/agent/types';

const AGENT_API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api`;

/** Error tipado que arrojan los helpers cuando el backend devuelve no-2xx. */
export class AgentClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;

  constructor(status: number, detail: string, code: string) {
    super(detail);
    this.name = 'AgentClientError';
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function parseError(res: Response): Promise<AgentClientError> {
  // Intentamos parsear el body como `{ detail, code }` (formato del
  // backend / del proxy). Si no es JSON válido, caemos a un mensaje
  // genérico con el status.
  let detail = `Backend respondió ${res.status}.`;
  let code = `HTTP_${res.status}`;
  try {
    const body = (await res.json()) as Partial<AgentErrorResponse>;
    if (typeof body?.detail === 'string') detail = body.detail;
    if (typeof body?.code === 'string') code = body.code;
  } catch {
    // Cuerpo no JSON: usamos statusText si está.
    if (res.statusText) detail = `${detail} (${res.statusText})`;
  }
  return new AgentClientError(res.status, detail, code);
}

async function jsonRequest<T>(
  path: string,
  init: RequestInit & { signal?: AbortSignal } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const res = await fetch(`${AGENT_API_BASE}${path}`, {
    ...init,
    headers,
    // Las llamadas son siempre dinámicas; nunca queremos cache.
    cache: 'no-store',
  });

  if (!res.ok) throw await parseError(res);

  // 204 / sin body: devolvemos undefined casteado al tipo del caller (raro).
  if (res.status === 204) return undefined as T;

  return (await res.json()) as T;
}

// ─── Conversaciones ──────────────────────────────────────────────────────

/**
 * Crea (o devuelve la existente, idempotente) una conversación con el
 * `conversation_id` y `engine` indicados. El backend valida que el id
 * sea un UUID v4 estricto y que el engine esté soportado.
 */
export async function createConversation(
  conversationId: string,
  engine: AgentEngine,
  signal?: AbortSignal,
): Promise<CreateConversationResponse> {
  return jsonRequest<CreateConversationResponse>('/conversations', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId, engine }),
    signal,
  });
}

/** Elimina la conversación (y su historial) del store en memoria del backend. */
export async function deleteConversation(
  conversationId: string,
  signal?: AbortSignal,
): Promise<DeleteConversationResponse> {
  return jsonRequest<DeleteConversationResponse>(
    `/conversations/${encodeURIComponent(conversationId)}`,
    { method: 'DELETE', signal },
  );
}

// ─── Guidelines ──────────────────────────────────────────────────────────

/**
 * Sube el archivo de guidelines (pdf/docx/md/json/xlsx/txt) y lo asocia
 * a la conversación. El backend lo procesa y lo cachea en memoria de la
 * sesión; el siguiente turno de modelado lo usará automáticamente.
 */
export async function uploadGuidelines(
  conversationId: string,
  file: File,
  signal?: AbortSignal,
): Promise<GuidelinesUploadResponse> {
  const formData = new FormData();
  formData.append('file', file, file.name);
  return jsonRequest<GuidelinesUploadResponse>(
    `/conversations/${encodeURIComponent(conversationId)}/guidelines`,
    { method: 'POST', body: formData, signal },
  );
}

// ─── Modelado ────────────────────────────────────────────────────────────

export interface GenerateModelInput {
  /** Texto libre del usuario para el turno (puede ser vacío si va Excel). */
  contextText?: string;
  /** Excel opcional con tablas/columnas (solo .xlsx). */
  excelFile?: File | null;
  /** Engine del turno. Si se omite, usa el de la conversación. */
  engine?: AgentEngine;
}

/**
 * Ejecuta el pipeline de modelamiento en el backend para el siguiente
 * turno de la conversación. Es la operación cara (puede tardar segundos).
 *
 * El caller debe enviar `contextText` y/o `excelFile`; al menos uno es
 * obligatorio (lo valida el backend con 400).
 */
export async function generateModel(
  conversationId: string,
  input: GenerateModelInput,
  signal?: AbortSignal,
): Promise<ModelingResponse> {
  const formData = new FormData();
  if (input.contextText && input.contextText.trim()) {
    formData.append('context_text', input.contextText);
  }
  if (input.excelFile) {
    formData.append('excel_file', input.excelFile, input.excelFile.name);
  }
  if (input.engine) {
    formData.append('engine', input.engine);
  }
  return jsonRequest<ModelingResponse>(
    `/conversations/${encodeURIComponent(conversationId)}/model`,
    { method: 'POST', body: formData, signal },
  );
}

/**
 * Recupera el último modelo generado en la conversación sin reejecutar
 * el agente. Lanza `AgentClientError` con `status: 404` si todavía no
 * hubo turnos exitosos.
 */
export async function getLastModel(
  conversationId: string,
  signal?: AbortSignal,
): Promise<ModelingResponse> {
  return jsonRequest<ModelingResponse>(
    `/conversations/${encodeURIComponent(conversationId)}/model`,
    { method: 'GET', signal },
  );
}

// ─── Health / engines ────────────────────────────────────────────────────

/** Estado de la API y conexión con Foundry. */
export async function getAgentHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return jsonRequest<HealthResponse>('/health', { method: 'GET', signal });
}

/** Engines de BD soportados por el backend. */
export async function listAgentEngines(signal?: AbortSignal): Promise<EnginesResponse> {
  return jsonRequest<EnginesResponse>('/engines', { method: 'GET', signal });
}
