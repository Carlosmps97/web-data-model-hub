import { apiGet } from '@/services/http';
import type { Principal } from '@/types/identity';

import { API_BASE } from '@/services/apiBase';

/** Trae la identidad del usuario en sesión. Backend: `GET /api/me`. */
export function getMe(): Promise<Principal> {
  return apiGet<Principal>(`${API_BASE}/api/me`);
}
