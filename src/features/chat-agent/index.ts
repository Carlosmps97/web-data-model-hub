// ─────────────────────────────────────────────────────────────────────────
//  Barrel público de la feature `chat-agent`.
//
//  Cualquier código fuera de `src/features/chat-agent/` debe importar desde
//  `@/features/chat-agent` y nunca tocar los subdirectorios directamente.
//  Esto mantiene la feature autocontenida: si reorganizamos archivos
//  internos, los callers no se rompen.
// ─────────────────────────────────────────────────────────────────────────

// UI
export { default as ChatPanel } from './components/ChatPanel';
export type { ChatPanelProps } from './components/ChatPanel';
export { default as ApplyToCanvasDialog } from './components/ApplyToCanvasDialog';
export type { ApplyToCanvasDialogProps } from './components/ApplyToCanvasDialog';

// Hook
export { useAgentConversation } from './hooks/useAgentConversation';
export type {
  AgentConversationState,
  UseAgentConversationApi,
  UseAgentConversationParams,
} from './hooks/useAgentConversation';

// Tipos del contrato HTTP
export type {
  AgentColumn,
  AgentEngine,
  AgentErrorResponse,
  AgentGuidelineViolation,
  AgentNewCatalogEntry,
  AgentQAReport,
  AgentStandardizedColumn,
  AgentTable,
  AgentUUID,
  CreateConversationRequest,
  CreateConversationResponse,
  DeleteConversationResponse,
  EnginesResponse,
  GuidelinesUploadResponse,
  HealthResponse,
  ModelingResponse,
} from './lib/types';

// Mapeo agente ↔ editor (project-centric)
export {
  agentColumnToTableColumn,
  agentTableToTable,
  deriveRelationships,
  fromAgentEngine,
  modelingResponseToCanvas,
  parseDataType,
  toAgentEngine,
} from './lib/mapping';
export type { TablePlacement } from './lib/mapping';

// Cliente HTTP (uso fuera del hook es raro pero válido)
export {
  AgentClientError,
  createConversation,
  deleteConversation,
  generateModel,
  getAgentHealth,
  getLastModel,
  listAgentEngines,
  uploadGuidelines,
} from './services/agent.service';
export type { GenerateModelInput } from './services/agent.service';

// Store (acceso lectura desde fuera de la feature; mutaciones siempre
// pasan por el hook).
export { useAgentStore } from './store/useAgentStore';
export type { AgentChatMessage } from './store/useAgentStore';

// Configuración (URL base del agente)
export { AGENT_API_BASE, AGENT_API_URL } from './config';
