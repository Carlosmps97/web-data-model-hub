/**
 * schemas.service — entidad `schemas` (esquema físico de BD), changeset-aware
 * (patrón structure.service):
 *  - Escrituras en sesión de edición → changeset (`recordChange`, doc completo);
 *    rename/delete van siempre por los endpoints del changeset (la propagación
 *    a tablas/vistas y el guard de uso se computan server-side).
 *  - Lecturas con changeset activo → estado efectivo (los esquemas creados en
 *    el draft aparecen al instante en los dropdowns).
 *  - Sin changeset → endpoints directos del proyecto de la sesión (los
 *    esquemas están aislados por proyecto).
 */
import { apiGet, apiPost } from '@/services/http';
import * as csvc from '@/services/changeset.service';
import { trackDraftWork } from '@/services/draftWork';
import { sessionProjectId, useSessionStore } from '@/store/useSessionStore';

import { API_BASE } from '@/services/apiBase';
const PROJECT_SCHEMAS = () => `${API_BASE}/api/projects/${encodeURIComponent(sessionProjectId())}/schemas`;
const CS = `${API_BASE}/api/changesets`;

import type { SchemaKind } from '../lib/schemaStaging';

/** Qué contiene el esquema: solo tablas, solo vistas o ambas (`both`). Es lo
 *  que filtran los combos de esquema. Erwin no trae este dato: nace en la
 *  plataforma (la carga de modelos Erwin lo deriva de los miembros, la UI lo
 *  pide al crear y Structure · Schemas lo deja cambiar). Opcional: esquemas
 *  nunca clasificados vienen sin él. */
export type { SchemaKind } from '../lib/schemaStaging';

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

/** Siempre dentro de una versión en edición: si la sesión se degradó (versión
 *  transferida, eliminada o enviada) rechaza con un mensaje legible. */
export const createSchema = async (name: string, description?: string, kind?: SchemaKind): Promise<DbSchema> => {
  const cs = writeCs();
  if (!cs) throw new Error('Creating a schema requires a version in edit mode.');
  // Camino changeset: el payload es el doc completo — kind debe ir acá o se
  // publicaría sin él (invariante round-trip).
  const s: DbSchema = { id: crypto.randomUUID(), name, description: description || null, kind: kind ?? null };
  await csvc.recordChange(cs, 'schemas', s.id, 'upsert', { ...s });
  return s;
};

/** Cambia qué contiene un esquema existente (lo declarado). Como el rename, lo
 *  arma el servidor a partir del doc efectivo de la versión: el cliente nunca
 *  manda el doc de un esquema existente (un catálogo desactualizado pisaría un
 *  rename pendiente). */
export const setSchemaKind = async (id: string, kind: SchemaKind): Promise<void> => {
  const cs = writeCs();
  if (!cs) throw new Error('Changing what a schema holds requires a version in edit mode.');
  await apiPost(`${CS}/${encodeURIComponent(cs)}/schemas/${encodeURIComponent(id)}/kind`, { kind });
};

/** Alta de un esquema desde un combo, solo dentro de una versión en edición
 *  (cambio `schemas` en el changeset activo, como Structure · Schemas). Sin
 *  versión en edición rechaza: jamás escribe directo a producción (p. ej. si
 *  la sesión salió de edición con el popup abierto). */
export const createSchemaInVersion = async (name: string, kind: SchemaKind): Promise<DbSchema> => {
  if (!writeCs()) throw new Error('Creating a schema here requires a version in edit mode.');
  return createSchema(name, undefined, kind);
};

export interface SchemaImpact { name: string; tables: number; views: number; canvases: number }

/** Impacto efectivo de tocar el esquema (tablas/vistas que lo usan y en
 *  cuántos canvases aparecen) — para mostrarlo antes de guardar. */
export const schemaImpact = (id: string): Promise<SchemaImpact> => {
  const cs = readCs();
  if (!cs) return Promise.reject(new Error('An active version is required.'));
  return apiGet(`${CS}/${encodeURIComponent(cs)}/schemas/${encodeURIComponent(id)}/impact`);
};

/** Rename versionado: propaga a todas las tablas/vistas efectivas del esquema
 *  dentro del draft (server-side). Devuelve cuántas se tocaron. */
export const renameSchema = (id: string, newName: string): Promise<{ tables: number; views: number }> => {
  const cs = writeCs();
  if (!cs) return Promise.reject(new Error('Renaming a schema requires a version in edit mode.'));
  return apiPost(`${CS}/${encodeURIComponent(cs)}/schemas/${encodeURIComponent(id)}/rename`, { newName });
};

/** Delete versionado: el backend rechaza (409) si el esquema tiene tablas o
 *  vistas en su estado efectivo. La escritura se avisa como las de
 *  `changeset.service`, con el número que devuelve el endpoint (sin él si falló). */
export const deleteSchema = async (id: string): Promise<void> => {
  const cs = writeCs();
  if (!cs) throw new Error('Deleting a schema requires a version in edit mode.');
  await trackDraftWork((async () => {
    let seq: number | undefined;
    try {
      seq = (await apiPost<{ deleted: boolean; writeSeq?: number }>(
        `${CS}/${encodeURIComponent(cs)}/schemas/${encodeURIComponent(id)}/delete`)).writeSeq;
    } finally {
      csvc.announceDraftWrite(cs, [{ collection: 'schemas', entityId: id, op: 'delete' }], seq);
    }
  })());
};
