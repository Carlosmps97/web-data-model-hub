/**
 * Base única del backend para todos los servicios.
 *
 * Vacía = mismo origen, el caso normal en desarrollo y en producción:
 *  - desarrollo: el proxy de vite.config.ts reenvía /api → :8000;
 *  - producción: server.mjs sirve la SPA y hace de proxy de /api al backend,
 *    servidor a servidor; por eso VITE_API_URL no se define en el build de
 *    Apps (definirla haría que el navegador cruce al backend, con su doble SSO).
 * `VITE_API_URL` queda para apuntar el front a otro backend en local
 * (p. ej. probar contra el desplegado).
 */
export const API_BASE: string = import.meta.env.VITE_API_URL ?? '';
