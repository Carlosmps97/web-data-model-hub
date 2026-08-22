/**
 * Base ÚNICA del backend para todos los servicios (homologación 2026-07-19).
 *
 * Vacía = mismo origen, el caso NORMAL en dev Y en producción:
 *  - dev: el proxy de vite.config.ts reenvía /api → :8000;
 *  - producción (doc 36): server.mjs sirve la SPA y proxya /api al backend
 *    servidor-a-servidor — por eso VITE_API_URL NO se define en el build de
 *    Apps (definirla reactivaría el cruce navegador→backend y su doble SSO).
 * `VITE_API_URL` queda para apuntar el front a otro backend en local
 * (p. ej. probar contra el desplegado).
 */
export const API_BASE: string = import.meta.env.VITE_API_URL ?? '';
