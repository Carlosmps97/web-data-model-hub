// ─────────────────────────────────────────────────────────────────────────
//  Configuración de la feature `chat-agent`.
//
//  El servicio de agentes (`app-agents-modeler`) es un proceso independiente
//  del backend de plataforma (`backend-data-model-hub`). Vive en un puerto
//  distinto y NO comparte cookies de sesión: el aislamiento se da por CORS
//  estricto con allowlist explícita de orígenes en el lado servidor.
//
//  Por eso:
//  - El frontend lo invoca con `credentials: 'omit'` (sin cookies).
//  - La URL base se controla por `NEXT_PUBLIC_AGENT_API_URL`, NO por
//    `NEXT_PUBLIC_API_URL` (que apunta al backend de plataforma).
//  - El default de dev es `http://localhost:8001` (el agente).
// ─────────────────────────────────────────────────────────────────────────

/** URL base del servicio de agentes (sin path). */
export const AGENT_API_URL: string =
  (process.env.NEXT_PUBLIC_AGENT_API_URL?.trim() ||
    'http://localhost:8001').replace(/\/+$/, '');

/** Prefijo de la API REST del agente. */
export const AGENT_API_BASE = `${AGENT_API_URL}/api`;
