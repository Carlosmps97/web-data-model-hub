/**
 * Themes de color del proyecto (lectura). Los edita Data Standards (apply
 * versionado: `themesUpsert`/`themesDelete`); el canvas solo los lee para
 * pintar las cajas que los usan.
 */
import { apiGet } from '@/services/http';
import { API_BASE } from '@/services/apiBase';
import type { Theme } from '@/lib/colors';

export const listThemes = (projectId: string) =>
  apiGet<Theme[]>(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/themes`);
