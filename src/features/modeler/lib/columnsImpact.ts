import type { RelationshipImpact, RelationshipImpactRow, TableLinkRow } from '@/services/governance.service';

/** Impacto de borrar varias columnas de una tabla, con la lectura de sus links
 *  (`gov.tableLinks`: sus relaciones en cualquier canvas, con nombres): una fila
 *  por relación con algún par de esas columnas, vista desde su lado, como la de
 *  `columnImpact` para una columna. Puro. */
export function columnsImpactFromLinks(colIds: Iterable<string>, links: TableLinkRow[]): RelationshipImpact {
  const gone = new Set(colIds);
  const relationships = links.flatMap((l): RelationshipImpactRow[] => {
    const mine = l.pairs.filter((p) => gone.has(p.parentColumnId) || gone.has(p.childColumnId));
    if (!mine.length) return [];
    const thisParent = gone.has(mine[0].parentColumnId);
    return [{
      relId: l.id,
      otherTableId: thisParent ? l.childTableId : l.parentTableId,
      otherTableName: thisParent ? l.childTableName : l.parentTableName,
      otherColumnId: thisParent ? mine[0].childColumnId : mine[0].parentColumnId,
      // Cada par nombra su otra punta: en una recursiva, cada uno puede tener
      // elegida una punta distinta.
      otherColumnName: mine.map((p) => (gone.has(p.parentColumnId) ? p.childColumnName : p.parentColumnName)).join(', '),
      thisSide: thisParent ? 'parent' : 'child',
      parentCardinality: l.parentCardinality, childCardinality: l.childCardinality,
      identifying: l.identifying,
      canvases: l.canvases,
    }];
  });
  return { relationships, total: relationships.length };
}
