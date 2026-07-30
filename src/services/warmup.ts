/**
 * Warm-up de sesión para Databricks Apps (doc 36).
 *
 * Cada Databricks App vive detrás de su PROPIO muro SSO por subdominio (la
 * cookie no se comparte entre apps). Un usuario que solo visitó el FRONT no
 * tiene sesión con el dominio del BACKEND, y un fetch() no puede completar
 * ese SSO (redirect cross-origin a Microsoft = imposible dentro de XHR): el
 * proxy responde su 401 sin CORS y el navegador lo reporta como
 * "Failed to fetch".
 *
 * Este probe detecta ese estado y hace UNA navegación top-level al endpoint
 * `GET /api/auth/warmup?next=<url>` del backend: el SSO ocurre solo, la
 * cookie queda puesta y el backend rebota de vuelta. Guard en sessionStorage
 * para no loopear si el backend está realmente caído.
 *
 * En dev (API_BASE = localhost) el probe responde bien y NUNCA se redirige.
 */
import { API_BASE } from './apiBase';

const GUARD_KEY = 'dmh-warmup-redirected';

export async function ensureBackendSession(
  base: string = API_BASE,
  navigate: (url: string) => void = (url) => { window.location.href = url; },
): Promise<void> {
  if (!base) return; // mismo origen (single-app): no existe el muro cruzado
  try {
    await fetch(`${base}/api/health`, { credentials: 'include' });
    // Se llegó al backend (cualquier status HTTP): hay sesión con su dominio.
    sessionStorage.removeItem(GUARD_KEY); // rearma el guard para futuras expiraciones
  } catch {
    // fetch rechazado = ni siquiera hubo respuesta legible (proxy SSO sin
    // sesión, o backend caído). Redirigir UNA vez; si volvemos igual, no
    // insistir: que el login muestre su error normal.
    if (sessionStorage.getItem(GUARD_KEY)) return;
    sessionStorage.setItem(GUARD_KEY, '1');
    navigate(`${base}/api/auth/warmup?next=${encodeURIComponent(window.location.href)}`);
  }
}
