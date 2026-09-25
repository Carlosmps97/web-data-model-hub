// API de Governance, consciente del changeset activo: con changeset → lee el
// overlay (/effective) y escribe al changeset (/changes); sin changeset → lee
// publicado (la UI queda read-only). Doc 75: toda lectura publicada es DEL
// PROYECTO de la sesión (`sessionProjectId()`) — nunca «global».
import { apiGet, apiPost } from '@/services/http';
import { sessionProjectId, useSessionStore } from '@/store/useSessionStore';
import * as csvc from './changeset.service';

import { API_BASE } from '@/services/apiBase';
const PROJECT = () => `${API_BASE}/api/projects/${encodeURIComponent(sessionProjectId())}`;
const CATALOG = `${API_BASE}/api/catalog`;

export interface ParentDomain {
  id: string; name: string; defaultDataType: string; description?: string;
  /** Doc 69: nombre de atributo sugerido (default = name) y tipo LÓGICO del dominio. */
  namingTerm?: string | null; logicalDataType?: string | null;
  /** Doc 79: dominio "atributo estándar" (Erwin `Attribute_Definition`) — solo
   *  estos heredan su nombre y definición al atributo al asignarse. */
  inheritsName?: boolean;
  /** Doc 85: faceta física — null/undefined = físico DERIVADO del lógico por la regla
   *  de naming del scope column; texto = override. `physicalDescription` null = igual
   *  a la lógica. `udpValues` = UDP por defecto de atributo/columna (ambas facetas). */
  physicalName?: string | null; physicalDescription?: string | null;
  udpValues?: Record<string, string> | null;
}
export interface CanonicalTable {
  id: string; physicalName: string; logicalName: string; schema?: string;
  /** Doc 68: físico editado a mano — el rephysicalize del Glosario NO lo
   *  re-deriva. Debe existir acá Y en el Pydantic CanonicalTableDoc. */
  physicalNameOverridden?: boolean;
  description?: string; udpValues?: Record<string, string>;
  /** Doc 69 §4.9: existe en UNA sola faceta de Erwin (Is_Logical_Only / Is_Physical_Only). */
  logicalOnly?: boolean; physicalOnly?: boolean;
}
export interface CanonicalColumn {
  id: string; tableId: string; physicalName: string; logicalName: string;
  parentDomainId?: string; dataType: string; typeOverridden: boolean;
  /** Doc 68: override manual del NOMBRE físico (paridad con typeOverridden). */
  physicalNameOverridden?: boolean;
  isPrimaryKey?: boolean; isForeignKey?: boolean;
  /** Orden ÚNICO de la columna en la tabla (doc 74/94): el mismo en el modelo
   *  lógico y en el físico, con las PK siempre primero; entre PK también manda
   *  (no hay orden de llave aparte). Canvas, paneles, vistas, exports y DDL
   *  ordenan con `orderColumns`. */
  ordinal: number;
  // R1a (backend) — persistidos; deben existir en el tipo o se pierden al recargar.
  isNullable?: boolean; isPartition?: boolean; description?: string;
  /** Doc 85: comment FÍSICO (Erwin Comment) — el DDL lo emite como COMMENT con
   *  fallback a `description`. Debe existir acá Y en el Pydantic CanonicalColumnDoc. */
  physicalDescription?: string | null;
  // UDP: valores de las etiquetas key-value asignadas ({udpDefId: value}).
  udpValues?: Record<string, string>;
  // Doc 69 §4.9 — faceta LÓGICA (dataType sigue siendo el físico).
  logicalDataType?: string | null; logicalTypeOverridden?: boolean;
  logicalOnly?: boolean; physicalOnly?: boolean;
}

const active = () => useSessionStore.getState().activeChangesetId;
// Guard común de TODAS las escrituras de modelo. En `readonly` puede haber
// changeset activo (visualizar un request desde Review lee su overlay), pero
// NUNCA habilita mutaciones — el backend igual respondería 409; esto corta
// antes y con un mensaje claro.
const writableCs = (): string => {
  if (useSessionStore.getState().openMode === 'readonly') {
    throw new Error('The model is open read-only: it does not accept changes.');
  }
  const a = active();
  if (!a) throw new Error('An active changeset is required to edit.');
  return a;
};
const rec = (collection: string, id: string, op: 'upsert' | 'delete', payload?: Record<string, unknown>) =>
  csvc.recordChange(writableCs(), collection, id, op, payload);

/** Lote de cambios en UNA llamada (doc 39) — cascadas de borrar tabla / crear
 *  tabla desde fuentes: el camino cambio-por-cambio eran N requests
 *  secuenciales (minutos a 4k columnas). Mismos guards que `rec`; lote vacío
 *  no viaja. Los ítems se arman con los builders de `bulk` (las colecciones
 *  versionadas no se nombran fuera de los services). */
export type BulkChange = csvc.BulkChange;
export type ChangeOrigin = csvc.ChangeOrigin;
export const recordChangesBulk = (changes: BulkChange[]) => csvc.recordChangesBulk(writableCs(), changes);
export const bulk = {
  deleteTable: (id: string): BulkChange => ({ collection: 'canonical_tables', entityId: id, op: 'delete' }),
  deleteColumn: (id: string): BulkChange => ({ collection: 'canonical_columns', entityId: id, op: 'delete' }),
  deleteRelationship: (id: string): BulkChange => ({ collection: 'relationships', entityId: id, op: 'delete' }),
  // Paridad con views.service.deleteView (misma colección versionada).
  deleteView: (id: string): BulkChange => ({ collection: 'views', entityId: id, op: 'delete' }),
  // `origin` (doc 51, opcional): procedencia del alta — paste/CTAS — para el
  // historial de auditoría ("Created from …"). El backend la arrastra si una
  // edición posterior del mismo draft no la trae.
  createTable: (t: CanonicalTable, origin?: ChangeOrigin): BulkChange =>
    ({ collection: 'canonical_tables', entityId: t.id, op: 'upsert', payload: { ...t }, ...(origin ? { origin } : {}) }),
  createColumn: (c: CanonicalColumn, origin?: ChangeOrigin): BulkChange =>
    ({ collection: 'canonical_columns', entityId: c.id, op: 'upsert', payload: { ...c }, ...(origin ? { origin } : {}) }),
  // Doc 47: la migración de llave graba columnas + relación en UN solo lote.
  upsertRelationship: (r: Relationship): BulkChange => ({ collection: 'relationships', entityId: r.id, op: 'upsert', payload: { ...r } }),
  // Doc 50 (Undo): restaurar vistas de una cascada deshecha — el payload es el
  // doc COMPLETO que devolvió views.service (round-trip garantizado).
  upsertView: (v: { id: string }): BulkChange => ({ collection: 'views', entityId: v.id, op: 'upsert', payload: { ...v } }),
};

// ── lectura helper público (siempre publicado): conversión lógico→físico ──
// `scope` opcional: 'table' usa términos+separador de tabla (join, sin separador);
// 'column' (default backend) usa los de columna. La UI de New table pasa 'table'.
export const physicalize = async (logical: string, scope?: 'table' | 'column') =>
  apiPost<{ physical: string }>(`${PROJECT()}/glossary/physicalize`, scope ? { logical, scope } : { logical });

// ── Parent Domains — SOLO LECTURA directa (2026-07-04) ──
// UDP y Parent Domains salieron del changeset del canvas (dejaron de ser
// VERSIONED): editarlos/versionarlos es exclusivo del módulo Data Standards.
// Acá solo se LEEN (directo, nunca por /effective — daría 422) para el dropdown
// de parent domain de las columnas del canvas. Escribir estándares desde el
// canvas ya no es posible por diseño.
export const listDomains = async () => apiGet<ParentDomain[]>(`${PROJECT()}/domains`);

// ── Catálogo canónico (del proyecto de la sesión) ──
export const listTables = async () => {
  const a = active();
  return a ? csvc.effective<CanonicalTable>(a, 'canonical_tables') : apiGet<CanonicalTable[]>(`${PROJECT()}/catalog/tables`);
};
/** Búsqueda server-side del pool (modales de catálogo): a 15k tablas el
 *  cliente NO baja la colección completa para filtrar — el backend matchea por
 *  nombre físico/lógico y devuelve las primeras `limit`. `q` vacío = página
 *  inicial alfabética. `schema` opcional acota a UN esquema server-side (el
 *  filtro del modal Import existing NO puede hacerse en el cliente sobre la
 *  página de `limit`: se perderían las tablas del esquema fuera de esa página).
 *  Con changeset activo busca sobre el estado efectivo. */
export const searchTables = async (q: string, limit = 50, schema?: string) => {
  const a = active();
  if (a) return csvc.effective<CanonicalTable>(a, 'canonical_tables', { q: q || undefined, limit, schema: schema || undefined });
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('limit', String(limit));
  if (schema) params.set('schema', schema);
  return apiGet<CanonicalTable[]>(`${PROJECT()}/catalog/tables?${params.toString()}`);
};
// ── Buscador del Model (doc 70 §11): tablas · columnas · definiciones ──
export interface ModelSearchCanvas { id: string; name: string; projectId?: string | null }
export interface ModelSearchTable {
  id: string; physicalName: string; logicalName: string; schema?: string | null; description?: string | null;
  /** Canvases donde la tabla está dibujada (vacío = sólo en el catálogo). */
  canvases: ModelSearchCanvas[];
}
export interface ModelSearchColumn {
  id: string; tableId: string; tableName: string; tableLogicalName?: string | null; schema?: string | null;
  physicalName: string; logicalName: string; dataType?: string | null; description?: string | null;
  canvases: ModelSearchCanvas[];
}
export type ModelSearchScope = 'all' | 'tables' | 'columns' | 'definitions';
export interface ModelSearchResult {
  tables: ModelSearchTable[];
  columns: ModelSearchColumn[];
  /** Columnas cuya DEFINICIÓN funcional contiene el término. */
  definitions: ModelSearchColumn[];
  /** Tope por grupo aplicado por el backend (tamaño de página). */
  limit: number;
  /** Doc 72 r2: offset de esta página y el de la SIGUIENTE por grupo (null = agotado). */
  offset: number;
  next: { tables: number | null; columns: number | null; definitions: number | null };
  scope: ModelSearchScope;
}
/** Selectores y filtros del buscador (owner): alcance por grupo; la jerarquía
 *  del explorer es Sub-proyecto (carpeta raíz) › Dominio (sub-carpeta) › Modelo
 *  (canvas), siempre DENTRO del proyecto de la sesión (doc 75). `folderId` =
 *  sub-proyecto O dominio: el backend alcanza todo su subárbol; `canvasId` = un
 *  modelo. */
export interface ModelSearchOptions {
  limit?: number;
  /** Doc 72 r2: página siguiente (viene de `ModelSearchResult.next`). */
  offset?: number;
  scope?: ModelSearchScope;
  folderId?: string | null;
  canvasId?: string | null;
}
/** Un request, tres grupos, cada hit con sus canvases. Con changeset activo
 *  (draft, request en visor o snapshot `asof:`) el backend aplica el overlay.
 *  Doc 72 r2: `q` vacío navega el alcance de los filtros; `offset` pagina. */
export const searchModel = async (q: string, opts: ModelSearchOptions = {}) => {
  const params = new URLSearchParams({ q, limit: String(opts.limit ?? 25), scope: opts.scope ?? 'all' });
  if (opts.offset) params.set('offset', String(opts.offset));
  if (opts.folderId) params.set('folderId', opts.folderId);
  if (opts.canvasId) params.set('canvasId', opts.canvasId);
  const a = active();
  if (a) params.set('changesetId', a);
  return apiGet<ModelSearchResult>(`${PROJECT()}/catalog/search?${params.toString()}`);
};
// ── Historial de auditoría (doc 51): eventos PUBLICADOS de una entidad ──
export type { HistoryField, HistoryItem, HistoryUser } from './changeset.service';
export const tableHistory = (id: string, limit = 50) => csvc.entityHistory('canonical_tables', id, limit);
export const columnHistory = (id: string, limit = 50) => csvc.entityHistory('canonical_columns', id, limit);
export const viewHistory = (id: string, limit = 50) => csvc.entityHistory('views', id, limit);

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
// markPrimaryKey se retiró (doc 47): la relación ya no promueve la columna
// padre — el gesto exige que el padre TENGA llave (guard en el canvas).
// markForeignKey se retiró (doc 94): la promoción de los hijos de una
// identificante va por `keyLayoutBulk` (orden único con PK primero, un lote).

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
  /** Doc 53: relación de SUBCATEGORÍA (supertipo→subtipo, "ES-UN"). El backend
   *  normaliza: subcategory ⇒ identifying=true y cardinalidades one/one. */
  subcategory?: boolean;
  /** Doc 53: aristas del mismo grupo comparten símbolo (círculo DERIVADO en el
   *  canvas — no es una entidad persistida; su posición vive en layout[id]). */
  subtypeSymbolId?: string | null;
}
/** Con `tableId`, sólo las relaciones que tocan esa tabla (slice server-side
 *  en ambos modos) — el pool global de relaciones no se baja entero. */
export const listRelationships = (tableId?: string) => {
  const a = active();
  if (a) return csvc.effective<Relationship>(a, 'relationships', tableId ? { tableId } : undefined);
  const qs = tableId ? `?tableId=${encodeURIComponent(tableId)}` : '';
  return apiGet<Relationship[]>(`${API_BASE}/api/relationships${qs}`);
};
// createRelationship se retiró (doc 47): crear una relación exige el mapeo
// N=N completo — va SIEMPRE en lote (bulk.upsertRelationship + columnas).
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
