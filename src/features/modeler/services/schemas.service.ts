/**
 * schemas.service — entidad `schemas` (esquema físico de BD, doc 18),
 * changeset-aware (patrón structure.service):
 *  - ESCRITURAS en sesión de edición → changeset (`recordChange`, doc COMPLETO);
 *    rename/delete van SIEMPRE por los endpoints del changeset (la propagación
 *    a tablas/vistas y el guard de uso se computan server-side).
 *  - LECTURAS con changeset activo → estado efectivo (los esquemas creados en
 *    el draft aparecen al instante en los dropdowns).
 *  - Sin changeset → endpoints directos (`/api/schemas`).
 */
import { apiDelete, apiGet, apiPost } from '@/services/http';
import * as csvc from '@/features/governance/services/changeset.service';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useSessionStore } from '@/store/useSessionStore';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const SCHEMAS = `${API_BASE}/api/schemas`;
const CS = `${API_BASE}/api/changesets`;

export interface DbSchema { id: string; name: string; description?: string | null }

/** Regla de nombre (espeja el backend): letras/números/guión bajo empezando
 *  con letra. Acepta mayúsculas — el legacy `No_Definido` debe validar. */
export const SCHEMA_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

const readCs = (): string | null => useChangesetStore.getState().activeId;
const writeCs = (): string | null =>
  useSessionStore.getState().openMode === 'editing' ? readCs() : null;

const byName = (a: DbSchema, b: DbSchema) => a.name.localeCompare(b.name);

export const listSchemas = async (): Promise<DbSchema[]> => {
  const cs = readCs();
  const rows = cs
    ? await csvc.effective<DbSchema>(cs, 'schemas')
    : await apiGet<DbSchema[]>(SCHEMAS);
  return rows.sort(byName);
};

/** Lista SIEMPRE publicada (Database Explorer): ignora el changeset activo. */
export const listPublishedSchemas = async (): Promise<DbSchema[]> =>
  (await apiGet<DbSchema[]>(SCHEMAS)).sort(byName);

export const createSchema = async (name: string, description?: string): Promise<DbSchema> => {
  const cs = writeCs();
  if (!cs) return apiPost<DbSchema>(SCHEMAS, { name, description });
  const s: DbSchema = { id: crypto.randomUUID(), name, description: description || null };
  await csvc.recordChange(cs, 'schemas', s.id, 'upsert', { ...s });
  return s;
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
