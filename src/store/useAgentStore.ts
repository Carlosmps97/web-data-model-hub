// ─────────────────────────────────────────────────────────────────────────
//  Estado del agente de modelado AI, scoped por `modelId`.
//
//  Responsabilidades:
//
//   1. Garantizar un `conversation_id` (UUID v4) único por modelo abierto.
//      El backend valida estrictamente que sea v4 y lo usa de clave del
//      ConversationStore in-memory para mantener historial y último modelo.
//
//   2. Mantener el listado VOLÁTIL de mensajes del chat (sin localStorage:
//      requisito explícito del usuario). Se borra al recargar la página.
//
//   3. Mantener el último `ModelingResponse` recibido del backend para
//      mostrarlo en el bloque de resultado del chat (con DDL, QA report,
//      guidelines aplicadas, etc.).
//
//   4. Estado de UI del chat: enviando / cargando / error.
//
//  Persistencia: NINGUNA. La store es exclusivamente runtime. El modelo
//  generado se "aplica" al canvas vía `useModelStore.setTables`/setRelationships,
//  que sí persiste a disco; el bloque de resultado en el chat se pierde
//  al cerrar la pestaña, lo que es lo deseado.
// ─────────────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentEngine,
  GuidelinesUploadResponse,
  ModelingResponse,
} from '@/lib/agent/types';

/** Mensaje individual del chat. Volátil: sólo vive en memoria. */
export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  /** Texto principal del mensaje. Para 'assistant' es el `summary` del backend. */
  content: string;
  timestamp: string;
  /** Adjunto Excel/guidelines mostrado en el burbuja del usuario. */
  attachment?: { name: string; sizeBytes: number; kind: 'excel' | 'guidelines' };
  /**
   * Si el mensaje es del assistant y el backend generó un modelo,
   * lo guardamos junto al mensaje para renderizar el bloque de resultado
   * (tablas, relaciones textuales, DDL, QA, guidelines aplicadas).
   * `null` si el assistant respondió sin modelo (raro, pero posible).
   */
  result?: ModelingResponse | null;
  /**
   * Snapshot del último upload de guidelines exitoso. Solo presente en
   * mensajes de tipo 'system' que confirman la carga.
   */
  guidelines?: GuidelinesUploadResponse;
  /** Mensaje de error legible (si la operación falló). */
  error?: string;
}

interface ModelSession {
  conversationId: string;
  /** Engine con el que se creó la sesión en el backend. */
  engine: AgentEngine;
  messages: AgentChatMessage[];
  /** Último resultado recibido (= último mensaje del assistant con result). */
  lastResult: ModelingResponse | null;
  /** Última carga de guidelines exitosa para esta sesión. */
  guidelines: GuidelinesUploadResponse | null;
  /** Conversación creada en el backend (idempotente, pero la cacheamos). */
  ensured: boolean;
}

interface AgentStore {
  /** Por `modelId` (entidad del editor) → sesión del agente. */
  sessions: Record<string, ModelSession>;

  /** Estado UI por modelId: si hay un POST /model en vuelo. */
  sending: Record<string, boolean>;
  /** Estado UI por modelId: si hay un POST /guidelines en vuelo. */
  uploadingGuidelines: Record<string, boolean>;

  // ── Selectores (puros, no mutan estado) ───────────────────────────────

  /**
   * Devuelve la sesión existente o `null`. NO la crea: usar
   * `ensureSession` para eso.
   */
  getSession: (modelId: string) => ModelSession | null;

  // ── Acciones ──────────────────────────────────────────────────────────

  /**
   * Crea (si no existe) la sesión del agente para `modelId` con un
   * `conversation_id` recién generado. Idempotente: si ya hay una
   * sesión, la devuelve sin tocarla. NO hace I/O contra el backend.
   *
   * El caller debe luego invocar `agentClient.createConversation(...)`
   * para registrar el id en el ConversationStore del backend (también
   * idempotente). Lo separamos para que la generación de UUIDs sea
   * síncrona y testable, y la sincronización con el backend sea opcional
   * (ej. el ChatPanel la hace en el primer envío).
   */
  ensureSession: (modelId: string, engine: AgentEngine) => ModelSession;

  /**
   * Marca la sesión como confirmada en el backend (tras un
   * `createConversation` exitoso). Si la sesión no existe, no-op.
   */
  markSessionEnsured: (modelId: string) => void;

  /**
   * Cambia el engine de la sesión en memoria. NO llama al backend; el
   * próximo turno enviará el nuevo `engine` en el form-data y el backend
   * lo respetará para esa ejecución y los siguientes turnos.
   */
  setSessionEngine: (modelId: string, engine: AgentEngine) => void;

  /**
   * Elimina toda la sesión (incluyendo mensajes y conversation_id).
   * Útil al cerrar o resetear el chat. NO llama al backend; el caller
   * decide si invocar `deleteConversation`.
   */
  clearSession: (modelId: string) => void;

  /** Agrega un mensaje al final de la conversación de `modelId`. */
  appendMessage: (modelId: string, msg: AgentChatMessage) => void;

  /**
   * Reemplaza un mensaje existente por id (para actualizar el placeholder
   * "thinking..." con el resultado real).
   */
  replaceMessage: (modelId: string, msgId: string, msg: AgentChatMessage) => void;

  /** Guarda el último resultado del backend en la sesión. */
  setLastResult: (modelId: string, result: ModelingResponse) => void;

  /** Guarda la última carga de guidelines exitosa en la sesión. */
  setGuidelines: (modelId: string, guidelines: GuidelinesUploadResponse) => void;

  /** Setea el flag `sending` para `modelId`. */
  setSending: (modelId: string, sending: boolean) => void;

  /** Setea el flag `uploadingGuidelines` para `modelId`. */
  setUploadingGuidelines: (modelId: string, uploading: boolean) => void;
}

// Helper para mutar (o crear) una sesión sin perder otras claves del map.
function patchSession(
  state: AgentStore,
  modelId: string,
  patch: Partial<ModelSession> | ((s: ModelSession) => Partial<ModelSession>),
): Pick<AgentStore, 'sessions'> {
  const current = state.sessions[modelId];
  if (!current) return { sessions: state.sessions };
  const partial = typeof patch === 'function' ? patch(current) : patch;
  return {
    sessions: {
      ...state.sessions,
      [modelId]: { ...current, ...partial },
    },
  };
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  sessions: {},
  sending: {},
  uploadingGuidelines: {},

  getSession: (modelId) => get().sessions[modelId] ?? null,

  ensureSession: (modelId, engine) => {
    const existing = get().sessions[modelId];
    if (existing) return existing;
    const fresh: ModelSession = {
      conversationId: uuidv4(),
      engine,
      messages: [],
      lastResult: null,
      guidelines: null,
      ensured: false,
    };
    set((state) => ({
      sessions: { ...state.sessions, [modelId]: fresh },
    }));
    return fresh;
  },

  markSessionEnsured: (modelId) =>
    set((state) => patchSession(state, modelId, { ensured: true })),

  setSessionEngine: (modelId, engine) =>
    set((state) => patchSession(state, modelId, { engine })),

  clearSession: (modelId) =>
    set((state) => {
      if (!state.sessions[modelId]) return state;
      const next = { ...state.sessions };
      delete next[modelId];
      const sending = { ...state.sending };
      delete sending[modelId];
      const uploadingGuidelines = { ...state.uploadingGuidelines };
      delete uploadingGuidelines[modelId];
      return { sessions: next, sending, uploadingGuidelines };
    }),

  appendMessage: (modelId, msg) =>
    set((state) => patchSession(state, modelId, (s) => ({
      messages: [...s.messages, msg],
    }))),

  replaceMessage: (modelId, msgId, msg) =>
    set((state) => patchSession(state, modelId, (s) => ({
      messages: s.messages.map((m) => (m.id === msgId ? msg : m)),
    }))),

  setLastResult: (modelId, result) =>
    set((state) => patchSession(state, modelId, { lastResult: result })),

  setGuidelines: (modelId, guidelines) =>
    set((state) => patchSession(state, modelId, { guidelines })),

  setSending: (modelId, sending) =>
    set((state) => ({
      sending: { ...state.sending, [modelId]: sending },
    })),

  setUploadingGuidelines: (modelId, uploading) =>
    set((state) => ({
      uploadingGuidelines: { ...state.uploadingGuidelines, [modelId]: uploading },
    })),
}));
