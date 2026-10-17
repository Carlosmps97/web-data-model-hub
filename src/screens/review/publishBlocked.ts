/**
 * Doc 84 A1 — lógica PURA del panel «Publish blocked»: agrupa los choques por
 * tipo y redacta el contexto de cada uno (dónde vive, con qué choca) en frases
 * cortas. La UI (PublishBlockedPanel) sólo pinta.
 */
import type { PublishBlockedDetail, PublishBlockedItem } from '@/types/versioning';

export interface BlockedGroup { kind: string; label: string; items: PublishBlockedItem[] }

// Doc 113 §2: el nombre de vista también es único — su grupo va tras las tablas.
const KIND_LABEL: Record<string, string> = {
  table: 'Tables', view: 'Views', column: 'Columns', schema: 'Schemas', change: 'Changes',
};
const KIND_ORDER = ['table', 'view', 'column', 'schema', 'change'];

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
