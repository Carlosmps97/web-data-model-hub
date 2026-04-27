// ─────────────────────────────────────────────────────────────────────────
//  Tipos del contrato HTTP del backend FastAPI (agent-modeler).
//
//  Estos tipos reflejan 1:1 los schemas Pydantic definidos en
//  `agent-modeler/src/schemas.py` (sufijo `API`). NO se usan para persistir
//  nada: solo viajan entre el browser, los route handlers proxy del frontend
//  y el FastAPI.
//
//  Fuente de verdad:
//  - `agent-modeler/src/schemas.py` (sección "schemas API")
//  - `agent-modeler/doc/schemas.md` (tablas de campos)
//
//  Si el backend cambia algún campo, aquí es donde hay que reflejarlo.
// ─────────────────────────────────────────────────────────────────────────

/** UUID v4 en formato string. */
export type AgentUUID = string;

/**
 * Motores soportados por el backend. Coinciden con `SUPPORTED_ENGINES`
 * en `agent-modeler/src/config.py`. El frontend mantiene una lista
 * local en `@/types/model` (`DatabaseEngine`) que debe estar alineada
 * con este conjunto.
 */
export type AgentEngine =
  | 'databricks_sql'
  | 'cosmosdb'
  | 'sqlserver'
  | 'postgresql'
  | 'mysql';

// ─── Conversaciones ──────────────────────────────────────────────────────

export interface CreateConversationRequest {
  conversation_id: AgentUUID;
  engine: AgentEngine;
}

export interface CreateConversationResponse {
  conversation_id: AgentUUID;
  engine: AgentEngine;
  /** `true` si se creó; `false` si la conversación ya existía (idempotente). */
  created: boolean;
}

export interface DeleteConversationResponse {
  conversation_id: AgentUUID;
  deleted: boolean;
}

// ─── Guidelines ──────────────────────────────────────────────────────────

export interface GuidelinesUploadResponse {
  status: 'ok';
  conversation_id: AgentUUID;
  file_name: string;
  /** Formato detectado: `json`, `xlsx`, `docx`, `pdf`, `md`, `txt`. */
  file_format: string;
  file_size_bytes: number;
  /** Primeros 500 caracteres del contenido procesado. */
  preview: string;
}

// ─── Modelo generado ─────────────────────────────────────────────────────

export interface AgentColumn {
  column_name: string;
  data_type: string;
  nullable: boolean;
  is_pk: boolean;
  is_fk: boolean;
  /** `"tabla.columna"` si `is_fk === true`, `null` en caso contrario. */
  fk_references: string | null;
  functional_definition: string;
  observations: string;
}

export interface AgentTable {
  table_name: string;
  table_description: string;
  columns: AgentColumn[];
  ddl: string;
}

export interface AgentStandardizedColumn {
  table_name: string;
  original_name: string;
  standardized_name: string;
  reason: string;
}

export interface AgentGuidelineViolation {
  table_name: string;
  column_name: string;
  violation: string;
  correction_applied: string;
}

export interface AgentNewCatalogEntry {
  column_name: string;
  functional_definition: string;
  data_type: string;
  table_name: string;
}

export interface AgentQAReport {
  /** 0–100. */
  quality_score: number;
  standardized_columns: AgentStandardizedColumn[];
  guideline_violations: AgentGuidelineViolation[];
  new_catalog_entries: AgentNewCatalogEntry[];
  summary: string;
}

export interface ModelingResponse {
  conversation_id: AgentUUID;
  engine: AgentEngine;
  /** Número de turno tras este request (≥ 1). */
  turn_number: number;
  tables: AgentTable[];
  /** Relaciones como texto libre (una por entrada). */
  relationships: string[];
  /** DDL completo concatenado de todas las tablas. */
  export_sql: string;
  /** Representación Markdown del modelo completo. */
  export_markdown: string;
  qa_report: AgentQAReport;
  /** Resumen breve de los lineamientos efectivamente aplicados. */
  guidelines_applied: string;
  /** Resumen en lenguaje natural del modelo generado. */
  summary: string;
}

// ─── Health / engines ────────────────────────────────────────────────────

export interface HealthResponse {
  status: 'ok' | string;
  version: string;
  foundry_connected: boolean;
  default_engine: AgentEngine;
  active_conversations: number;
}

export interface EnginesResponse {
  engines: AgentEngine[];
  default: AgentEngine;
}

// ─── Errores ─────────────────────────────────────────────────────────────

export interface AgentErrorResponse {
  detail: string;
  code: string;
}
