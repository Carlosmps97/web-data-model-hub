/**
 * Base ÚNICA del backend para todos los servicios (homologación 2026-07-19).
 *
 * Vacía = mismo origen (dev: el proxy de vite.config.ts reenvía /api → :8000).
 * En producción la define `VITE_API_URL` en el BUILD — Vite la inlinea; en
 * Databricks Apps llega como env del app desde `databricks.yml` (variable
 * `backend_api_url`) y el build corre en el arranque (`prestart`).
 */
export const API_BASE: string = import.meta.env.VITE_API_URL ?? '';
