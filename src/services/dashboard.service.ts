/**
 * dashboard.service — contadores del Home (p0).
 *
 * Backend: `GET /api/summary?projectId=` (app/features/summary). Sin `projectId`
 * devuelve los totales globales; con `projectId` acota el alcance al proyecto.
 * Construido sobre `apiGet`, que ya desempaqueta el envelope `{success,data}`.
 */

import type { DashboardSummary } from '@/types/versioning';
import { apiGet } from './http';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

/**
 * Trae los 5 contadores del Home. Pasá `projectId` para acotar al proyecto;
 * omitilo (o `undefined`) para los totales globales.
 */
export function getSummary(projectId?: string): Promise<DashboardSummary> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return apiGet<DashboardSummary>(`${API_BASE}/api/summary${qs}`);
}
