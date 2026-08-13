// API de Governance, consciente del changeset activo: con changeset → lee el
// overlay (/effective) y escribe al changeset (/changes); sin changeset → lee
// publicado (la UI queda read-only).
import { v4 as uuid } from 'uuid';
import { apiGet, apiPost } from '@/services/http';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useSessionStore } from '@/store/useSessionStore';
import * as csvc from './changeset.service';

import { API_BASE } from '@/services/apiBase';
const DOMAINS = `${API_BASE}/api/domains`;
const DICT = `${API_BASE}/api/glossary`;
const CATALOG = `${API_BASE}/api/catalog`;

export interface ParentDomain { id: string; name: string; defaultDataType: string; description?: string; }
export interface CanonicalTable { id: string; physicalName: string; logicalName: string; schema?: string; description?: string; udpValues?: Record<string, string>; }
export interface CanonicalColumn {
  id: string; tableId: string; physicalName: string; logicalName: string;
  parentDomainId?: string; dataType: string; typeOverridden: boolean;
  isPrimaryKey?: boolean; isForeignKey?: boolean; ordinal: number;
  /** Posición dentro de la LLAVE primaria (0-based) — independiente del
   *  `ordinal` físico. Ordena el bloque PK del canvas y el PRIMARY KEY(...)
   *  del DDL, como Erwin (doc 19 §12b). */
  pkPosition?: number | null;
  // R1a (backend) — persistidos; deben existir en el tipo o se pierden al recargar.
  isNullable?: boolean; isPartition?: boolean; description?: string;
  // UDP: valores de las etiquetas key-value asignadas ({udpDefId: value}).
  udpValues?: Record<string, string>;
}

const active = () => useChangesetStore.getState().activeId;
const rec = (collection: string, id: string, op: 'upsert' | 'delete', payload?: Record<string, unknown>) => {
  // Choke-point de TODAS las escrituras de modelo. En `readonly` puede haber
  // changeset activo (visualizar un request desde Review lee su overlay), pero
  // NUNCA habilita mutaciones — el backend igual respondería 409; esto corta
  // antes y con un mensaje claro.
  if (useSessionStore.getState().openMode === 'readonly') {
    throw new Error('The model is open read-only: it does not accept changes.');
  }
  const a = active();
  if (!a) throw new Error('An active changeset is required to edit.');
  return csvc.recordChange(a, collection, id, op, payload);
};

// ── lectura helper público (siempre publicado): conversión lógico→físico ──
// `scope` opcional: 'table' usa términos+separador de tabla (join, sin separador);
// 'column' (default backend) usa los de columna. La UI de New table pasa 'table'.
export const physicalize = (logical: string, scope?: 'table' | 'column') =>
  apiPost<{ physical: string }>(`${DICT}/physicalize`, scope ? { logical, scope } : { logical });

// ── Parent Domains — SOLO LECTURA directa (2026-07-04) ──
// UDP y Parent Domains salieron del changeset del canvas (dejaron de ser
// VERSIONED): editarlos/versionarlos es exclusivo del módulo Data Standards.
// Acá solo se LEEN (directo, nunca por /effective — daría 422) para el dropdown
// de parent domain de las columnas del canvas. Escribir estándares desde el
// canvas ya no es posible por diseño.
export const listDomains = () => apiGet<ParentDomain[]>(DOMAINS);

// ── Catálogo canónico ──
export const listTables = () => {
  const a = active();
  return a ? csvc.effective<CanonicalTable>(a, 'canonical_tables') : apiGet<CanonicalTable[]>(`${CATALOG}/tables`);
};
/** Búsqueda server-side del pool (modales de catálogo): a 15k tablas el
 *  cliente NO baja la colección completa para filtrar — el backend matchea por
 *  nombre físico/lógico y devuelve las primeras `limit`. `q` vacío = página
 *  inicial alfabética. `schema` opcional acota a UN esquema server-side (el
 *  filtro del modal Import existing NO puede hacerse en el cliente sobre la
 *  página de `limit`: se perderían las tablas del esquema fuera de esa página).
 *  Con changeset activo busca sobre el estado efectivo. */
export const searchTables = (q: string, limit = 50, schema?: string) => {
  const a = active();
  if (a) return csvc.effective<CanonicalTable>(a, 'canonical_tables', { q: q || undefined, limit, schema: schema || undefined });
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('limit', String(limit));
  if (schema) params.set('schema', schema);
  return apiGet<CanonicalTable[]>(`${CATALOG}/tables?${params.toString()}`);
};
export const createTable = (t: CanonicalTable) => rec('canonical_tables', t.id, 'upsert', { ...t });
/** Borra la tabla en el changeset (soft-delete VERSIONADO). El cascade
 *  (columnas/relaciones/vistas/membresías de canvas) lo orquesta el store. */
export const deleteTable = (id: string) => rec('canonical_tables', id, 'delete');
export const listColumns = (tableId: string) => {
  const a = active();
  if (!a) return apiGet<CanonicalColumn[]>(`${CATALOG}/tables/${encodeURIComponent(tableId)}/columns`);
  // Filtro server-side (?tableId=): bajar canonical_columns COMPLETO (300k docs
  // a escala) para quedarse con una tabla no es viable.
  return csvc.effective<CanonicalColumn>(a, 'canonical_columns', { tableId });
};
export const createColumn = (c: CanonicalColumn) => rec('canonical_columns', c.id, 'upsert', { ...c });
// Upsert changeset-aware de una columna ya existente (merge: el caller pasa la
// columna completa + los campos a cambiar). NO borra+recrea.
export const updateColumn = (c: CanonicalColumn) => rec('canonical_columns', c.id, 'upsert', { ...c });
export const deleteColumn = (id: string) => rec('canonical_columns', id, 'delete');
// Marca la columna hija de una relación como FK; si la relación es
// identificadora, la FK entra a la PK del hijo (y una PK no es nullable).
// `pkPosition` (opcional): posición AL FINAL de la llave cuando la tabla
// maneja orden explícito — no pisa una posición ya existente (doc 19 §12b).
export const markForeignKey = (col: CanonicalColumn, identifying: boolean, pkPosition?: number | null) =>
  rec('canonical_columns', col.id, 'upsert', {
    ...col, isForeignKey: true,
    ...(identifying ? {
      isPrimaryKey: true, isNullable: false,
      ...(pkPosition != null && col.pkPosition == null ? { pkPosition } : {}),
    } : {}),
  });

// Promueve la columna padre a PK: la relación "nace" de la PK del padre
// (doc 19 — al jalar el wire, el extremo padre se vuelve PK automáticamente).
export const markPrimaryKey = (col: CanonicalColumn, pkPosition?: number | null) =>
  rec('canonical_columns', col.id, 'upsert', {
    ...col, isPrimaryKey: true, isNullable: false,
    ...(pkPosition != null && col.pkPosition == null ? { pkPosition } : {}),
  });

// ── Relationships (ER) — changeset-aware ──
// v2 (doc 19): orientación EXPLÍCITA parent (lado PK) / child (lado FK) +
// pares múltiples de columnas (PK compuesta) + roleName estilo Erwin por par.
export type Cardinality = 'one' | 'many' | 'one-only' | 'zero-one' | 'one-many' | 'zero-many';
export interface RelationshipPair {
  parentColumnId: string;
  childColumnId: string;
  roleName?: string | null;
}
export interface Relationship {
  id: string; parentTableId: string; childTableId: string;
  pairs: RelationshipPair[];
  parentCardinality: Cardinality; childCardinality: Cardinality; identifying: boolean;
}
/** Con `tableId`, sólo las relaciones que tocan esa tabla (slice server-side
 *  en ambos modos) — el pool global de relaciones no se baja entero. */
export const listRelationships = (tableId?: string) => {
  const a = active();
  if (a) return csvc.effective<Relationship>(a, 'relationships', tableId ? { tableId } : undefined);
  const qs = tableId ? `?tableId=${encodeURIComponent(tableId)}` : '';
  return apiGet<Relationship[]>(`${API_BASE}/api/relationships${qs}`);
};
export const createRelationship = (r: Omit<Relationship, 'id'>) => { const id = uuid(); return rec('relationships', id, 'upsert', { ...r, id }); };
export const updateRelationship = (r: Relationship) => rec('relationships', r.id, 'upsert', { ...r });
export const deleteRelationship = (id: string) => rec('relationships', id, 'delete');

// ── Uso de la tabla (V3, doc 19 §12b): dónde está referenciada ──
export interface TableUsageRow {
  canvasId: string; canvas: string;
  folderId?: string | null; folder?: string | null;
  projectId?: string | null; project?: string | null;
}
/** Canvases que referencian la tabla, con carpeta y proyecto. Con changeset
 *  activo aplica el overlay del draft (canvases/membresías pendientes). */
export const tableUsage = (tableId: string) => {
  const a = active();
  const qs = a ? `?changesetId=${encodeURIComponent(a)}` : '';
  return apiGet<{ usage: TableUsageRow[]; total: number }>(
    `${CATALOG}/tables/${encodeURIComponent(tableId)}/usage${qs}`);
};

// ── Links de la tabla en TODOS los canvases (Properties · Links) ──
export interface TableLinkPair {
  parentColumnId: string; parentColumnName: string;
  childColumnId: string; childColumnName: string;
  roleName?: string | null;
}
export interface TableLinkRow {
  id: string;
  parentTableId: string; parentTableName: string;
  childTableId: string; childTableName: string;
  parentCardinality: Cardinality; childCardinality: Cardinality;
  identifying: boolean;
  pairs: TableLinkPair[];
  /** Canvases donde la relación es VISIBLE (contienen ambas tablas). */
  canvases: { id: string; name: string }[];
}
/** Relaciones GLOBALES de la tabla (la tabla es canónica): además de las del
 *  canvas abierto, las visibles sólo en otros canvases — con nombres resueltos
 *  server-side (esas tablas/columnas no están en el diagrama actual). */
export const tableLinks = (tableId: string) => {
  const params = new URLSearchParams({ tableId });
  const a = active();
  if (a) params.set('changesetId', a);
  return apiGet<{ links: TableLinkRow[]; total: number }>(
    `${API_BASE}/api/relationships/links?${params.toString()}`);
};

// ── Impacto de eliminar una columna (spec 10 §8) ──
export interface ImpactCanvas { id: string; name: string; }
export interface RelationshipImpactRow {
  relId: string; otherTableId: string; otherTableName: string;
  otherColumnId: string; otherColumnName: string;
  thisSide: 'parent' | 'child';
  parentCardinality: Cardinality; childCardinality: Cardinality;
  identifying: boolean;
  canvases: ImpactCanvas[];
}
export interface RelationshipImpact { relationships: RelationshipImpactRow[]; total: number; }
/** Relaciones GLOBALES (cualquier canvas) donde la columna es extremo —
 *  publicadas + overlay del changeset activo. Alimenta el warning del delete. */
export const columnImpact = (columnId: string) => {
  const params = new URLSearchParams({ columnId });
  const a = active();
  if (a) params.set('changesetId', a);
  return apiGet<RelationshipImpact>(`${API_BASE}/api/relationships/impact?${params.toString()}`);
};
