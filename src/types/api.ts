// API request/response types

import type { Project, DataModel } from './model';

// Generic API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Project endpoints
export type ProjectListResponse = ApiResponse<Project[]>;
export type ProjectResponse = ApiResponse<Project>;
export interface CreateProjectRequest {
  name: string;
  description?: string;
}
export interface UpdateProjectRequest {
  name?: string;
  description?: string;
}

// Model endpoints
export type ModelListResponse = ApiResponse<DataModel[]>;
export type ModelResponse = ApiResponse<DataModel>;
export interface CreateModelRequest {
  projectId: string;
  name: string;
  description?: string;
  tables?: DataModel['tables'];
  relationships?: DataModel['relationships'];
}
export interface UpdateModelRequest {
  name?: string;
  description?: string;
  tables?: DataModel['tables'];
  relationships?: DataModel['relationships'];
}

// Chat endpoint
export interface ChatRequest {
  message: string;
  attachments?: { name: string; type: string; data: string }[];
}
export interface ChatResponse {
  message: string;
  timestamp: string;
}
