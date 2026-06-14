// API request/response types

import type {
  Project,
  Canvas,
  EngineId,
  ModelLevel,
  Domain,
  Table,
  Relationship,
} from './model';

// Generic API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Project endpoints ───────────────────────────────────────────────────────
export type ProjectListResponse = ApiResponse<Project[]>;
export type ProjectResponse = ApiResponse<Project>;

export interface CreateProjectRequest {
  name: string;
  description?: string;
  engines?: EngineId[];
  layers?: ModelLevel[];
  domains?: Domain[];
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
  engines?: EngineId[];
  layers?: ModelLevel[];
  domains?: Domain[];
}

// ─── Canvas endpoints (a project's tables + relationships) ───────────────────
export type CanvasResponse = ApiResponse<Canvas>;

export interface CanvasReplaceRequest {
  tables?: Table[];
  relationships?: Relationship[];
}

// ─── Chat endpoint (AI agent — decoupled, kept) ──────────────────────────────
export interface ChatRequest {
  message: string;
  attachments?: { name: string; type: string; data: string }[];
}
export interface ChatResponse {
  message: string;
  timestamp: string;
}
