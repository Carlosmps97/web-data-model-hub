// API de Governance, consciente del changeset activo: con changeset → lee el
// overlay (/effective) y escribe al changeset (/changes); sin changeset → lee
// publicado (la UI queda read-only).
import { v4 as uuid } from 'uuid';
import { apiGet, apiPost } from '@/services/http';
import { useChangesetStore } from '@/store/useChangesetStore';
import * as csvc from './changeset.service';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const DOMAINS = `${API_BASE}/api/domains`;
const DICT = `${API_BASE}/api/dictionary`;
const CATALOG = `${API_BASE}/api/catalog`;

export interface ParentDomain { id: string; name: string; defaultDataType: string; description?: string; }
export interface Abbreviation { id: string; term: string; abbrev: string; }
export interface CanonicalTable { id: string; physicalName: string; logicalName: string; schema?: string; description?: string; }
export interface CanonicalColumn {
  id: string; tableId: string; physicalName: string; logicalName: string;
  parentDomainId?: string; dataType: string; typeOverridden: boolean;
  isPrimaryKey?: boolean; isForeignKey?: boolean; ordinal: number;
  // R1a (backend) — persistidos; deben existir en el tipo o se pierden al recargar.
  isNullable?: boolean; isPartition?: boolean; description?: string;
}

const active = () => useChangesetStore.getState().activeId;
const rec = (collection: string, id: string, op: 'upsert' | 'delete', payload?: Record<string, unknown>) => {
  const a = active();
  if (!a) throw new Error('Se requiere un changeset activo para editar.');
  return csvc.recordChange(a, collection, id, op, payload);
};

// ── lectura helper público (siempre publicado): conversión lógico→físico ──
// `scope` opcional: 'table' usa términos+separador de tabla (join, sin separador);
// 'column' (default backend) usa los de columna. La UI de New table pasa 'table'.
export const physicalize = (logical: string, scope?: 'table' | 'column') =>
  apiPost<{ physical: string }>(`${DICT}/physicalize`, scope ? { logical, scope } : { logical });

// ── Parent Domains ──
export const listDomains = () => {
  const a = active();
  return a ? csvc.effective<ParentDomain>(a, 'parent_domains') : apiGet<ParentDomain[]>(DOMAINS);
};
export const createDomain = (d: Omit<ParentDomain, 'id'>) => { const id = uuid(); return rec('parent_domains', id, 'upsert', { ...d, id }); };
export const updateDomain = (id: string, d: Omit<ParentDomain, 'id'>) => rec('parent_domains', id, 'upsert', { ...d, id });
export const deleteDomain = (id: string) => rec('parent_domains', id, 'delete');

// ── Diccionario / UDP ──
export const listAbbrev = () => {
  const a = active();
  return a ? csvc.effective<Abbreviation>(a, 'abbreviation_dict') : apiGet<Abbreviation[]>(DICT);
};
export const createAbbrev = (x: Omit<Abbreviation, 'id'>) => { const id = uuid(); return rec('abbreviation_dict', id, 'upsert', { ...x, id }); };
export const updateAbbrev = (id: string, x: Omit<Abbreviation, 'id'>) => rec('abbreviation_dict', id, 'upsert', { ...x, id });
export const deleteAbbrev = (id: string) => rec('abbreviation_dict', id, 'delete');

// ── Catálogo canónico ──
export const listTables = () => {
  const a = active();
  return a ? csvc.effective<CanonicalTable>(a, 'canonical_tables') : apiGet<CanonicalTable[]>(`${CATALOG}/tables`);
};
export const createTable = (t: CanonicalTable) => rec('canonical_tables', t.id, 'upsert', { ...t });
export const listColumns = (tableId: string) => {
  const a = active();
  if (!a) return apiGet<CanonicalColumn[]>(`${CATALOG}/tables/${encodeURIComponent(tableId)}/columns`);
  return csvc.effective<CanonicalColumn>(a, 'canonical_columns').then((cols) => cols.filter((c) => c.tableId === tableId));
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
export const listRelationships = () => {
  const a = active();
  return a ? csvc.effective<Relationship>(a, 'relationships') : apiGet<Relationship[]>(`${API_BASE}/api/relationships`);
};
export const createRelationship = (r: Omit<Relationship, 'id'>) => { const id = uuid(); return rec('relationships', id, 'upsert', { ...r, id }); };
export const updateRelationship = (r: Relationship) => rec('relationships', r.id, 'upsert', { ...r });
export const deleteRelationship = (id: string) => rec('relationships', id, 'delete');
