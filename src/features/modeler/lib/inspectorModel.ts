// Object Inspector (doc 72 §3) — helpers PUROS de presentación: nombres y
// tipos por faceta, posiciones, rótulos de relaciones y rutas de uso.
import type { CanonicalColumn, TableLinkRow, TableUsageRow } from '@/services/governance.service';
import type { Facet } from '@/lib/facets';
import { sortByOrdinal } from './columnOrder';

/** Etiqueta compacta por extremo (misma tabla del panel de propiedades). */
export const CARD_LBL: Record<string, string> = {
  one: '1', 'one-only': '1', 'zero-one': '0..1', many: 'N', 'one-many': '1..N', 'zero-many': '0..N',
};

export const otherFacet = (f: Facet): Facet => (f === 'logical' ? 'physical' : 'logical');

/** Nombre del objeto en la faceta (entidad/atributo = lógico; tabla/columna =
 *  físico), con fallback al otro nombre si falta. */
export const facetName = (o: { logicalName?: string | null; physicalName?: string | null }, facet: Facet): string =>
  (facet === 'logical' ? (o.logicalName || o.physicalName || '') : (o.physicalName || o.logicalName || ''));

/** Tipo en la faceta: lógico con fallback al físico (doc 69 §4.9). */
export const facetType = (c: Pick<CanonicalColumn, 'dataType' | 'logicalDataType'>, facet: Facet): string =>
  (facet === 'logical' ? (c.logicalDataType || c.dataType || '') : (c.dataType || ''));

/** Posición 1-based de la columna en el orden de la tabla («#3 of 12»); 0 si no está. */
export function positionIn(cols: CanonicalColumn[], colId: string): { pos: number; of: number } {
  const list = sortByOrdinal(cols);
  return { pos: list.findIndex((c) => c.id === colId) + 1, of: list.length };
}

/** Existencia en una sola faceta (Is_Logical_Only / Is_Physical_Only). */
export const facetOnly = (c: { logicalOnly?: boolean; physicalOnly?: boolean }): 'logical' | 'physical' | null =>
  (c.logicalOnly ? 'logical' : c.physicalOnly ? 'physical' : null);

/** Rótulo de llaves: «PK · #2 of 3 in the key» / «FK» / «—». */
export function keyLabel(c: CanonicalColumn, cols: CanonicalColumn[]): string {
  const parts: string[] = [];
  if (c.isPrimaryKey) {
    const pks = cols.filter((x) => x.isPrimaryKey).length;
    parts.push(c.pkPosition != null && pks > 1 ? `PK · #${c.pkPosition + 1} of ${pks} in the key` : 'PK');
  }
  if (c.isForeignKey) parts.push('FK');
  return parts.length ? parts.join(' · ') : '—';
}

/** «1 : 0..N · identifying · 2 pairs». */
export const cardinalityLabel = (l: Pick<TableLinkRow, 'parentCardinality' | 'childCardinality' | 'identifying' | 'pairs'>): string =>
  `${CARD_LBL[l.parentCardinality] ?? l.parentCardinality} : ${CARD_LBL[l.childCardinality] ?? l.childCardinality}`
  + `${l.identifying ? ' · identifying' : ''}${l.pairs.length > 1 ? ` · ${l.pairs.length} pairs` : ''}`;

/** Rol de la OTRA tabla respecto de `tableId` en la relación. */
export const linkRole = (l: Pick<TableLinkRow, 'parentTableId'>, tableId: string): 'parent' | 'child' =>
  (l.parentTableId === tableId ? 'child' : 'parent');

/** Columnas PROPIAS de `tableId` en la unión (todas las de los pares). */
export const ownColumns = (l: TableLinkRow, tableId: string): string[] =>
  l.pairs.map((p) => (l.parentTableId === tableId ? p.parentColumnName : p.childColumnName));

/** Ruta legible «proyecto › carpeta › canvas». */
export const usagePath = (u: TableUsageRow): string => [u.project || '—', u.folder || 'root', u.canvas].join(' › ');

/** Canvas destino de «Open in canvas»: el abierto si contiene el objeto, el
 *  único, o null (elegir en «Where used»). */
export function primaryCanvas(usage: TableUsageRow[], activeSaId: string | null): TableUsageRow | null {
  if (usage.length === 0) return null;
  const here = activeSaId ? usage.find((u) => u.canvasId === activeSaId) : undefined;
  if (here) return here;
  return usage.length === 1 ? usage[0] : null;
}
