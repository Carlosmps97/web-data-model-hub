// API de Governance, consciente del changeset activo: con changeset → lee el
// overlay (/effective) y escribe al changeset (/changes); sin changeset → lee
// publicado (la UI queda read-only).
import { v4 as uuid } from 'uuid';
import { apiGet, apiPost } from '@/services/http';
import { useChangesetStore } from '@/store/useChangesetStore';
import { useSessionStore } from '@/store/useSessionStore';
import * as csvc from './changeset.service';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const DOMAINS = `${API_BASE}/api/domains`;
const DICT = `${API_BASE}/api/glossary`;
const CATALOG = `${API_BASE}/api/catalog`;

export interface ParentDomain { id: string; name: string; defaultDataType: string; description?: string; }
export interface CanonicalTable { id: string; physicalName: string; logicalName: string; schema?: string; description?: string; udpValues?: Record<string, string>; }
export interface CanonicalColumn {
  id: string; tableId: string; physicalName: string; logicalName: string;
  parentDomainId?: string; dataType: string; typeOverridden: boolean;
  isPrimaryKey?: boolean; isForeignKey?: boolean; ordinal: number;
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
    throw new Error('El modelo está abierto en solo lectura: no admite cambios.');
  }
  const a = active();
  if (!a) throw new Error('Se requiere un changeset activo para editar.');
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
 *  inicial alfabética. Con changeset activo busca sobre el estado efectivo. */
export const searchTables = (q: string, limit = 50) => {
  const a = active();
  if (a) return csvc.effective<CanonicalTable>(a, 'canonical_tables', { q: q || undefined, limit });
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('limit', String(limit));
  return apiGet<CanonicalTable[]>(`${CATALOG}/tables?${params.toString()}`);
};
export const createTable = (t: CanonicalTable) => rec('canonical_tables', t.id, 'upsert', { ...t });
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
// Marca la columna hija de una relación como FK (y PK si la relación es identificadora).
export const markForeignKey = (col: CanonicalColumn, identifying: boolean) =>
  rec('canonical_columns', col.id, 'upsert', { ...col, isForeignKey: true, isPrimaryKey: identifying ? true : col.isPrimaryKey });

// ── Relationships (ER) — changeset-aware ──
export type Cardinality = 'one' | 'many' | 'one-only' | 'zero-one' | 'one-many' | 'zero-many';
export interface Relationship {
  id: string; sourceTableId: string; sourceColumnId: string; targetTableId: string; targetColumnId: string;
  sourceCardinality: Cardinality; targetCardinality: Cardinality; identifying: boolean;
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
