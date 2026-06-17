// Transversal UDP / Semantic Type catalog (cross-project governance metadata).
// Backend: `api/routes/metadata.py`. Reads are open to any authenticated user;
// writes require a non-viewer role (enforced server-side).

import type { SemanticType, Udp } from '@/types/model';
import { apiGet, apiPost, apiPut, apiDelete } from './http';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';
const ST = `${API_BASE}/api/metadata/semantic-types`;
const UDP = `${API_BASE}/api/metadata/udps`;

// ── Semantic Types ───────────────────────────────────────────────────────────

export function listSemanticTypes(): Promise<SemanticType[]> {
  return apiGet<SemanticType[]>(ST);
}
export function createSemanticType(data: Omit<SemanticType, 'id'>): Promise<SemanticType> {
  return apiPost<SemanticType>(ST, data);
}
export function updateSemanticType(id: string, data: Omit<SemanticType, 'id'>): Promise<SemanticType> {
  return apiPut<SemanticType>(`${ST}/${encodeURIComponent(id)}`, data);
}
export function deleteSemanticType(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`${ST}/${encodeURIComponent(id)}`);
}

// ── UDPs ─────────────────────────────────────────────────────────────────────

export function listUdps(): Promise<Udp[]> {
  return apiGet<Udp[]>(UDP);
}
export function createUdp(data: Omit<Udp, 'id'>): Promise<Udp> {
  return apiPost<Udp>(UDP, data);
}
export function updateUdp(id: string, data: Omit<Udp, 'id'>): Promise<Udp> {
  return apiPut<Udp>(`${UDP}/${encodeURIComponent(id)}`, data);
}
export function deleteUdp(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`${UDP}/${encodeURIComponent(id)}`);
}
