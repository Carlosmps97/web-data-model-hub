import { apiGet } from '@/services/http';
import type { Principal } from '@/types/identity';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

/** Trae la identidad del usuario en sesión. Backend: `GET /api/me`. */
export function getMe(): Promise<Principal> {
  return apiGet<Principal>(`${API_BASE}/api/me`);
}
