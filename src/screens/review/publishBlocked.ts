/**
 * Lógica pura del panel «Publish blocked»: agrupa los choques por tipo y
 * redacta el contexto de cada uno (dónde vive, con qué choca) en frases cortas.
 * La UI (PublishBlockedPanel) solo pinta.
 */
import type { PublishBlockedDetail, PublishBlockedItem } from '@/types/versioning';

export interface BlockedGroup { kind: string; label: string; items: PublishBlockedItem[] }

// El nombre de vista también es único: su grupo va tras las tablas.
const KIND_LABEL: Record<string, string> = {
  table: 'Tables', view: 'Views', column: 'Columns', relationship: 'Relationships', schema: 'Schemas',
  change: 'Changes',
};
const KIND_ORDER = ['table', 'view', 'column', 'relationship', 'schema', 'change'];

/** Fecha y hora locales de un ISO (lo deja tal cual si no se puede leer). */
export function fmtWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Título del panel: la cabecera del mensaje del backend, sin la cola de
 *  ejemplos (« — Table X already exists | …») — la lista completa va debajo. */
export function blockedTitle(detail: PublishBlockedDetail): string {
  const head = detail.message.split(' — ')[0].trim();
  return head || 'Publish blocked';
}

/** Ítems agrupados por tipo, en orden fijo (tablas, vistas, columnas, esquemas, otros). */
export function groupBlockedItems(items: PublishBlockedItem[]): BlockedGroup[] {
  const by = new Map<string, PublishBlockedItem[]>();
  items.forEach((it) => {
    const k = it.kind || 'change';
    by.set(k, [...(by.get(k) ?? []), it]);
  });
  return [...by.entries()]
    .sort(([a], [b]) => {
      const ia = KIND_ORDER.indexOf(a); const ib = KIND_ORDER.indexOf(b);
      return (ia === -1 ? KIND_ORDER.length : ia) - (ib === -1 ? KIND_ORDER.length : ib);
    })
    .map(([kind, list]) => ({ kind, label: KIND_LABEL[kind] ?? 'Other', items: list }));
}

/** Nombre con que se lista el ítem. Lo que otra versión borró va con su id
 *  entre paréntesis: los usuarios lo reconocen por el nombre y el id ubica el
 *  dato. */
export function itemLabel(it: PublishBlockedItem): string {
  if (it.where === 'deleted' && it.name && it.entityId) return `${it.name} (${it.entityId})`;
  return it.name ?? it.message;
}

/** Dónde vive el ítem dentro del request: «schema X» / «in table Y». */
export function itemContext(it: PublishBlockedItem): string {
  if (it.kind === 'column') return it.tableName ? `in table ${it.tableName}` : '';
  if (it.kind === 'table' || it.kind === 'view') return it.schema ? `schema ${it.schema}` : '';
  return '';
}

/** Con qué choca y desde cuándo, como frase: «In production since v2, published
 *  by Admin on 10 Sep 2026» / «Also created in this request as m_x». */
export function itemWhere(
  it: PublishBlockedItem,
  fmt: (iso: string) => string,
  userName: (id: string) => string,
): string {
  const ex = it.existing ?? null;
  if (it.where === 'deleted') {
    const p = it.deletedParent;
    const parent = p?.kind === 'schema' ? 'Schema' : p?.kind === 'column' ? 'Column' : 'Table';
    let out = p ? `${parent} ${p.name} deleted in production` : 'Deleted in production';
    if (ex?.version) out += ` by ${ex.version}`;
    if (ex?.owner) out += ` (${userName(ex.owner)})`;
    if (ex?.publishedAt) out += ` on ${fmt(ex.publishedAt)}`;
    return it.afterOpened === false ? out : `${out} after this version was opened`;
  }
  if (it.where === 'request') {
    const alias = ex?.name && ex.name !== it.name ? ` as ${ex.name}` : '';
    return `Also created in this request${alias}`;
  }
  if (it.where === 'production') {
    const where = ex?.tableName && it.kind === 'column' ? ` (table ${ex.tableName})`
      : ex?.schema && (it.kind === 'table' || it.kind === 'view') && ex.schema !== it.schema ? ` (schema ${ex.schema})` : '';
    if (!ex?.version && !ex?.owner && !ex?.publishedAt) return `Already in production${where}`;
    let out = 'In production';
    if (ex.version) out += ` since ${ex.version}`;
    if (ex.owner && ex.publishedAt) out += `, published by ${userName(ex.owner)} on ${fmt(ex.publishedAt)}`;
    else if (ex.owner) out += `, published by ${userName(ex.owner)}`;
    else if (ex.publishedAt) out += `, published on ${fmt(ex.publishedAt)}`;
    return out + where;
  }
  return it.message;
}
