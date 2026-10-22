/**
 * Warm-up de sesión para Databricks Apps.
 *
 * Cada Databricks App vive detrás de su propio muro SSO por subdominio (la
 * cookie no se comparte entre apps). Un usuario que solo visitó el front no
 * tiene sesión con el dominio del backend, y un fetch() no puede completar
 * ese SSO (redirect cross-origin a Microsoft = imposible dentro de XHR): el
 * proxy responde su 401 sin CORS y el navegador lo reporta como
 * "Failed to fetch".
 *
 * Este probe detecta ese estado y hace una navegación top-level al endpoint
 * `GET /api/auth/warmup/{next_b64}` del backend (destino en base64url): el SSO ocurre solo, la
 * cookie queda puesta y el backend rebota de vuelta. Un guard en sessionStorage
 * evita un bucle de redirecciones si el backend está realmente caído.
 *
 * En dev (API_BASE = localhost) el probe responde bien y nunca se redirige.
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
    // sesión, o backend caído). Se redirige una sola vez; si al volver sigue
    // igual, no se insiste y el login muestra su error normal.
    if (sessionStorage.getItem(GUARD_KEY)) return;
    sessionStorage.setItem(GUARD_KEY, '1');
    // `next` va en el path (base64url sin padding), no como query string: el
    // replay post-SSO del proxy de Databricks se atora con query strings y
    // deja al usuario varado en un `{}`.
    const token = btoa(window.location.href)
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    navigate(`${base}/api/auth/warmup/${token}`);
  }
}
