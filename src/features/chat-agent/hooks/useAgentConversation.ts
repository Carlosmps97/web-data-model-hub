// ─────────────────────────────────────────────────────────────────────────
//  Hook que orquesta una conversación con el agente para un `modelId`.
//
//  Encapsula:
//
//   - Asegurar que existe sesión local + conversación en el backend.
//   - Subir guidelines (PDF/DOCX/MD/JSON/XLSX/TXT).
//   - Enviar un turno (texto + Excel opcional + engine).
//   - Reflejar el estado en `useAgentStore` (mensajes, último resultado).
//   - Manejar errores con mensajes legibles para el usuario.
//
//  NO toca `useModelStore`: la decisión de aplicar el modelo al canvas
//  pertenece al componente que renderiza el bloque de resultado, no al
//  hook (que se mantiene puramente "comunicacional").
// ─────────────────────────────────────────────────────────────────────────

'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  AgentClientError,
  createConversation,
  deleteConversation,
  generateModel,
  uploadGuidelines,
  type GenerateModelInput,
} from '@/lib/agent/client';
import { toAgentEngine } from '@/lib/agent/mapping';
import type {
  AgentChatMessage,
  useAgentStore as useAgentStoreType,
} from '@/store/useAgentStore';
import { useAgentStore } from '@/store/useAgentStore';
import type { DatabaseEngine } from '@/types/model';

type StoreState = ReturnType<typeof useAgentStoreType.getState>;

/**
 * Referencia estable para `messages` cuando todavía no hay sesión. Evita
 * que cada render construya `[]` nuevo y rompa la igualdad de `useShallow`.
 */
const EMPTY_MESSAGES: AgentChatMessage[] = [];

/** Estado expuesto por el hook al componente. */
export interface AgentConversationState {
  conversationId: string | null;
  messages: AgentChatMessage[];
  /** Último `ModelingResponse` recibido (atajo a session.lastResult). */
  lastResult: StoreState['sessions'][string]['lastResult'];
  /** Última carga de guidelines exitosa. */
  guidelines: StoreState['sessions'][string]['guidelines'];
  sending: boolean;
  uploadingGuidelines: boolean;
}

export interface UseAgentConversationParams {
  /** Id del modelo abierto en el editor (scope de la conversación). */
  modelId: string | null;
  /** Engine actual del modelo (puede ser legacy `oracle` o `databricks`). */
  engine: DatabaseEngine | null | undefined;
}

export interface UseAgentConversationApi extends AgentConversationState {
  /**
   * Envía un turno. Devuelve la respuesta del backend o `null` si falló
   * (el error ya quedó reflejado en el último mensaje del store).
   */
  sendTurn: (input: { text?: string; excelFile?: File | null }) => Promise<
    StoreState['sessions'][string]['lastResult'] | null
  >;

  /**
   * Sube un archivo de guidelines a la sesión. El backend lo procesa
   * y lo cachea para los próximos turnos. Devuelve la respuesta o
   * `null` si falló.
   */
  uploadGuidelinesFile: (file: File) => Promise<
    StoreState['sessions'][string]['guidelines'] | null
  >;

  /**
   * Borra la conversación: localmente la quita del store y también
   * pide al backend liberar la memoria. Errores en el backend se
   * loguean a consola pero no fallan al caller (estado local prima).
   */
  reset: () => Promise<void>;
}

/**
 * Hook principal del chat con el agente. Mantiene el `conversation_id`
 * estable mientras dure el `modelId`; al cambiar de modelo, el hook
 * usado por otro panel verá otra sesión.
 */
export function useAgentConversation(
  params: UseAgentConversationParams,
): UseAgentConversationApi {
  const { modelId, engine } = params;

  // Engine que vamos a enviar al backend (mapea oracle→postgresql, etc.).
  const agentEngine = toAgentEngine(engine);

  const ensureSession = useAgentStore((s) => s.ensureSession);
  const markSessionEnsured = useAgentStore((s) => s.markSessionEnsured);
  const setSessionEngine = useAgentStore((s) => s.setSessionEngine);
  const clearSession = useAgentStore((s) => s.clearSession);
  const appendMessage = useAgentStore((s) => s.appendMessage);
  const replaceMessage = useAgentStore((s) => s.replaceMessage);
  const setLastResult = useAgentStore((s) => s.setLastResult);
  const setGuidelines = useAgentStore((s) => s.setGuidelines);
  const setSending = useAgentStore((s) => s.setSending);
  const setUploadingGuidelines = useAgentStore((s) => s.setUploadingGuidelines);

  // Hidratamos la sesión apenas tengamos modelId/engine. El UUID se
  // genera la primera vez y es estable mientras viva la pestaña.
  useEffect(() => {
    if (!modelId) return;
    ensureSession(modelId, agentEngine);
  }, [modelId, agentEngine, ensureSession]);

  // Si el engine cambia mientras la conversación está viva, lo reflejamos.
  // El backend lo ajustará en el próximo turno (el form-data mandará
  // `engine` y el endpoint `create_conversation` también es idempotente).
  const lastEngineRef = useRef<string | null>(null);
  useEffect(() => {
    if (!modelId) return;
    if (lastEngineRef.current === agentEngine) return;
    lastEngineRef.current = agentEngine;
    setSessionEngine(modelId, agentEngine);
  }, [modelId, agentEngine, setSessionEngine]);

  // Suscripción granular al estado de la sesión + flags UI.
  //
  // ATENCIÓN: el selector NUNCA debe construir referencias frescas para
  // valores "vacíos" (ej. `?? []`), porque `useShallow` compara campo a
  // campo y un nuevo `[]` por render rompe la igualdad y dispara el
  // warning de React "getSnapshot should be cached" (loop infinito).
  // Por eso usamos `EMPTY_MESSAGES` como referencia estable.
  const view = useAgentStore(
    useShallow((s): AgentConversationState => {
      const session = modelId ? s.sessions[modelId] : undefined;
      return {
        conversationId: session?.conversationId ?? null,
        messages: session?.messages ?? EMPTY_MESSAGES,
        lastResult: session?.lastResult ?? null,
        guidelines: session?.guidelines ?? null,
        sending: modelId ? !!s.sending[modelId] : false,
        uploadingGuidelines: modelId ? !!s.uploadingGuidelines[modelId] : false,
      };
    }),
  );

  // ── Helpers ────────────────────────────────────────────────────────────

  /**
   * Asegura que la conversación esté creada en el backend. Idempotente:
   * si ya está marcada como `ensured`, no llama de nuevo.
   *
   * Si falla, el error se propaga al caller que decide cómo reportarlo.
   */
  const ensureBackendConversation = useCallback(
    async (mid: string): Promise<string> => {
      const session = ensureSession(mid, agentEngine);
      if (session.ensured) return session.conversationId;
      await createConversation(session.conversationId, agentEngine);
      markSessionEnsured(mid);
      return session.conversationId;
    },
    [agentEngine, ensureSession, markSessionEnsured],
  );

  // ── API pública ────────────────────────────────────────────────────────

  const sendTurn = useCallback<UseAgentConversationApi['sendTurn']>(
    async ({ text, excelFile }) => {
      if (!modelId) return null;
      const trimmed = (text ?? '').trim();
      if (!trimmed && !excelFile) return null;

      // Burbuja del usuario.
      const userMsg: AgentChatMessage = {
        id: cryptoId('u'),
        role: 'user',
        content: trimmed || '(archivo Excel)',
        timestamp: new Date().toISOString(),
        attachment: excelFile
          ? { name: excelFile.name, sizeBytes: excelFile.size, kind: 'excel' }
          : undefined,
      };
      appendMessage(modelId, userMsg);

      // Placeholder del assistant.
      const placeholderId = cryptoId('a');
      appendMessage(modelId, {
        id: placeholderId,
        role: 'assistant',
        content: 'Pensando…',
        timestamp: new Date().toISOString(),
      });

      setSending(modelId, true);
      try {
        const conversationId = await ensureBackendConversation(modelId);
        const payload: GenerateModelInput = {
          contextText: trimmed || undefined,
          excelFile: excelFile ?? undefined,
          engine: agentEngine,
        };
        const response = await generateModel(conversationId, payload);
        setLastResult(modelId, response);
        replaceMessage(modelId, placeholderId, {
          id: placeholderId,
          role: 'assistant',
          content: response.summary || 'Modelo generado.',
          timestamp: new Date().toISOString(),
          result: response,
        });
        return response;
      } catch (err) {
        const message = describeError(err, 'No se pudo generar el modelo.');
        replaceMessage(modelId, placeholderId, {
          id: placeholderId,
          role: 'assistant',
          content: message,
          timestamp: new Date().toISOString(),
          error: message,
          result: null,
        });
        return null;
      } finally {
        setSending(modelId, false);
      }
    },
    [
      modelId,
      agentEngine,
      ensureBackendConversation,
      appendMessage,
      replaceMessage,
      setSending,
      setLastResult,
    ],
  );

  const uploadGuidelinesFile = useCallback<UseAgentConversationApi['uploadGuidelinesFile']>(
    async (file) => {
      if (!modelId) return null;
      setUploadingGuidelines(modelId, true);
      try {
        const conversationId = await ensureBackendConversation(modelId);
        const response = await uploadGuidelines(conversationId, file);
        setGuidelines(modelId, response);
        appendMessage(modelId, {
          id: cryptoId('s'),
          role: 'system',
          content: `Guidelines cargadas: ${response.file_name} (${formatBytes(response.file_size_bytes)}).`,
          timestamp: new Date().toISOString(),
          guidelines: response,
          attachment: {
            name: response.file_name,
            sizeBytes: response.file_size_bytes,
            kind: 'guidelines',
          },
        });
        return response;
      } catch (err) {
        const message = describeError(err, 'No se pudieron cargar las guidelines.');
        appendMessage(modelId, {
          id: cryptoId('s'),
          role: 'system',
          content: message,
          timestamp: new Date().toISOString(),
          error: message,
        });
        return null;
      } finally {
        setUploadingGuidelines(modelId, false);
      }
    },
    [
      modelId,
      ensureBackendConversation,
      appendMessage,
      setGuidelines,
      setUploadingGuidelines,
    ],
  );

  const reset = useCallback<UseAgentConversationApi['reset']>(async () => {
    if (!modelId) return;
    const session = useAgentStore.getState().sessions[modelId];
    clearSession(modelId);
    if (session?.conversationId && session.ensured) {
      try {
        await deleteConversation(session.conversationId);
      } catch (err) {
        // No bloqueamos al usuario por un fallo de cleanup remoto.
        console.warn('[useAgentConversation] failed to delete remote conversation', err);
      }
    }
  }, [modelId, clearSession]);

  return {
    ...view,
    sendTurn,
    uploadGuidelinesFile,
    reset,
  };
}

// ─── Helpers internos ────────────────────────────────────────────────────

function cryptoId(prefix: string): string {
  // No requerimos UUID v4 estricto aquí; sólo un id único en memoria.
  // `crypto.randomUUID` está disponible en navegadores modernos.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function describeError(err: unknown, fallback: string): string {
  if (err instanceof AgentClientError) {
    // Mensajes específicos del backend (vienen en español).
    return err.detail || fallback;
  }
  if (err instanceof Error) return `${fallback} ${err.message}`.trim();
  return fallback;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
