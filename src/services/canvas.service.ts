import type { Canvas, NodePosition } from '@/types/model';
import type { CanvasReplaceRequest } from '@/types/api';
import { apiGet, apiFetch } from './http';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

/** Fetch a project's hydrated canvas (tables + relationships). */
export function getCanvas(projectId: string): Promise<Canvas> {
  return apiGet<Canvas>(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/canvas`);
}

/**
 * Replace the project's tables and/or relationships in full.
 * Backend: `PUT /api/projects/{id}/canvas`. Node positions are intentionally
 * NOT sent here — they are owned by {@link updatePositions}.
 */
export function saveCanvas(projectId: string, payload: CanvasReplaceRequest): Promise<Canvas> {
  return apiFetch<Canvas>(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/canvas`,
    { method: 'PUT', body: payload },
  );
}

/**
 * Persist only the canvas positions of the given tables. Tiny payload,
 * separate from {@link saveCanvas} so the drag debounce doesn't round-trip the
 * full (possibly MB-sized) canvas. Backend: `PATCH /api/projects/{id}/positions`.
 */
export function updatePositions(
  projectId: string,
  payload: { tables?: Record<string, NodePosition> },
): Promise<{ tables: number }> {
  return apiFetch<{ tables: number }>(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/positions`,
    { method: 'PATCH', body: payload },
  );
}
