/**
 * dashboard.service — contadores del Home (p0).
 *
 * Backend: `GET /api/summary?projectId=` (app/features/summary). Sin `projectId`
 * devuelve los totales globales; con `projectId` acota el alcance al proyecto.
 * Construido sobre `apiGet`, que ya desempaqueta el envelope `{success,data}`.
 */

import type { DashboardSummary } from '@/types/versioning';
import { apiGet } from './http';

import { API_BASE } from '@/services/apiBase';

/**
 * Trae los 5 contadores del Home. Pasá uno o varios `projectIds` para acotar a
 * la UNIÓN de esos proyectos; omitilo (o vacío) para los totales globales.
 */
export function getSummary(projectIds?: string[]): Promise<DashboardSummary> {
  const ids = (projectIds ?? []).filter(Boolean);
  const qs = ids.length
    ? `?${ids.map((id) => `projectId=${encodeURIComponent(id)}`).join('&')}`
    : '';
  return apiGet<DashboardSummary>(`${API_BASE}/api/summary${qs}`);
}
