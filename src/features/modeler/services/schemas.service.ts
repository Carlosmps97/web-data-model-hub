/**
 * schemas.service — entidad `schemas` (esquema físico de BD, doc 18),
 * changeset-aware (patrón structure.service):
 *  - ESCRITURAS en sesión de edición → changeset (`recordChange`, doc COMPLETO);
 *    rename/delete van SIEMPRE por los endpoints del changeset (la propagación
 *    a tablas/vistas y el guard de uso se computan server-side).
 *  - LECTURAS con changeset activo → estado efectivo (los esquemas creados en
 *    el draft aparecen al instante en los dropdowns).
 *  - Sin changeset → endpoints directos del PROYECTO de la sesión (doc 75:
 *    los esquemas están aislados por proyecto).
 */
import { apiDelete, apiGet, apiPost } from '@/services/http';
import * as csvc from '@/services/changeset.service';
import { sessionProjectId, useSessionStore } from '@/store/useSessionStore';

import { API_BASE } from '@/services/apiBase';
const PROJECT_SCHEMAS = () => `${API_BASE}/api/projects/${encodeURIComponent(sessionProjectId())}/schemas`;
const SCHEMAS = `${API_BASE}/api/schemas`;
const CS = `${API_BASE}/api/changesets`;

/** Qué contiene el esquema (doc 44): tablas o vistas. Erwin no trae este dato
 *  (los Hive_Database del XML no llevan ningún atributo/UDP que lo marque) —
 *  nace en la plataforma: la migración lo deriva de los miembros y la UI lo
 *  pide al crear. Opcional: esquemas pre-doc-44 pueden venir sin él. */
export type SchemaKind = 'tables' | 'views';

export interface DbSchema { id: string; name: string; description?: string | null; kind?: SchemaKind | null }

/** Regla de nombre del esquema (vive en la lib pura; se re-exporta acá). */
export { SCHEMA_NAME_RE } from '../lib/schemaStaging';

const readCs = (): string | null => useSessionStore.getState().activeChangesetId;
const writeCs = (): string | null =>
  useSessionStore.getState().openMode === 'editing' ? readCs() : null;

const byName = (a: DbSchema, b: DbSchema) => a.name.localeCompare(b.name);

export const listSchemas = async (): Promise<DbSchema[]> => {
  const cs = readCs();
  const rows = cs
    ? await csvc.effective<DbSchema>(cs, 'schemas')
    : await apiGet<DbSchema[]>(PROJECT_SCHEMAS());
  return rows.sort(byName);
};

/** Lista SIEMPRE publicada del proyecto (Database Explorer): ignora el changeset activo. */
export const listPublishedSchemas = async (): Promise<DbSchema[]> =>
  (await apiGet<DbSchema[]>(PROJECT_SCHEMAS())).sort(byName);

export const createSchema = async (name: string, description?: string, kind?: SchemaKind): Promise<DbSchema> => {
  const cs = writeCs();
  if (!cs) return apiPost<DbSchema>(PROJECT_SCHEMAS(), { name, description, kind });
  // Camino changeset: el payload es el DOC COMPLETO — kind debe ir acá o se
  // publicaría sin él (invariante round-trip).
  const s: DbSchema = { id: crypto.randomUUID(), name, description: description || null, kind: kind ?? null };
  await csvc.recordChange(cs, 'schemas', s.id, 'upsert', { ...s });
  return s;
};

/** Doc 96 (final review): alta de UN esquema desde un combo — SOLO dentro de
 *  una versión en edición (cambio `schemas` en el changeset activo, como
 *  Structure · Schemas). Sin versión en edición rechaza: jamás escribe directo
 *  a producción (p. ej. si la sesión salió de edición con el popup abierto). */
export const createSchemaInVersion = async (name: string, kind: SchemaKind): Promise<DbSchema> => {
  if (!writeCs()) throw new Error('Creating a schema here requires a version in edit mode.');
  return createSchema(name, undefined, kind);
};

export interface SchemaImpact { name: string; tables: number; views: number; canvases: number }

/** Impacto EFECTIVO de tocar el esquema (tablas/vistas que lo usan y en
 *  cuántos canvases aparecen) — para mostrarlo ANTES de guardar. */
export const schemaImpact = (id: string): Promise<SchemaImpact> => {
  const cs = readCs();
  if (!cs) return Promise.reject(new Error('An active version is required.'));
  return apiGet(`${CS}/${encodeURIComponent(cs)}/schemas/${encodeURIComponent(id)}/impact`);
};

/** Rename versionado: propaga a todas las tablas/vistas efectivas del esquema
 *  DENTRO del draft (server-side). Devuelve cuántas se tocaron. */
export const renameSchema = (id: string, newName: string): Promise<{ tables: number; views: number }> => {
  const cs = writeCs();
  if (!cs) return Promise.reject(new Error('Renaming a schema requires a version in edit mode.'));
  return apiPost(`${CS}/${encodeURIComponent(cs)}/schemas/${encodeURIComponent(id)}/rename`, { newName });
};

/** Delete versionado: el backend rechaza (409) si el esquema tiene tablas o
 *  vistas en su estado efectivo. */
export const deleteSchema = async (id: string): Promise<void> => {
  const cs = writeCs();
  if (cs) {
    await apiPost(`${CS}/${encodeURIComponent(cs)}/schemas/${encodeURIComponent(id)}/delete`);
    return;
  }
  await apiDelete(`${SCHEMAS}/${encodeURIComponent(id)}`);
};
