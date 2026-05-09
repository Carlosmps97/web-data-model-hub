/**
 * Maps the legacy `Relationship.type` + optional `isNullable` on the
 * FK column to the four-state Crow's Foot notation rendered at each
 * end of an edge.
 *
 * Convention (matches dbdiagram / drawSQL):
 *
 *   one-to-one   · source: one-only       · target: one-only
 *   one-to-many  · source: one-only       · target: one-or-many
 *   many-to-many · source: one-or-many    · target: one-or-many
 *
 * If the *source* column (treated as the FK side in our schema — see
 * `Relationship.sourceColumn` doc) is explicitly nullable, the "one"
 * prefixes on the source side become "zero-or". The target side
 * traditionally references a PK which is rarely nullable, but we apply
 * the same treatment if `isNullable` is explicitly true there.
 *
 * When `Relationship.sourceCardinality` / `targetCardinality` are
 * present, they override the derived values verbatim — this is the
 * hook for a future editor that lets the user tune the notation.
 */

import type {
  CrowsFootCardinality,
  Relationship,
  TableModel,
} from '@/types/model';
import { resolveColumn } from '@/lib/columnRef';

function weaken(card: CrowsFootCardinality): CrowsFootCardinality {
  switch (card) {
    case 'one-only':
      return 'zero-or-one';
    case 'one-or-many':
      return 'zero-or-many';
    default:
      return card;
  }
}

export function deriveCardinality(
  rel: Relationship,
  tables: TableModel[],
): { source: CrowsFootCardinality; target: CrowsFootCardinality } {
  if (rel.sourceCardinality && rel.targetCardinality) {
    return { source: rel.sourceCardinality, target: rel.targetCardinality };
  }

  let source: CrowsFootCardinality;
  let target: CrowsFootCardinality;
  switch (rel.type) {
    case 'one-to-one':
      source = 'one-only';
      target = 'one-only';
      break;
    case 'one-to-many':
      source = 'one-only';
      target = 'one-or-many';
      break;
    case 'many-to-many':
      source = 'one-or-many';
      target = 'one-or-many';
      break;
    default:
      source = 'one-only';
      target = 'one-only';
  }

  const srcCol = resolveColumn(tables, rel.sourceTable, rel.sourceColumn);
  const tgtCol = resolveColumn(tables, rel.targetTable, rel.targetColumn);
  if (srcCol?.isNullable === true) source = weaken(source);
  if (tgtCol?.isNullable === true) target = weaken(target);

  return {
    source: rel.sourceCardinality ?? source,
    target: rel.targetCardinality ?? target,
  };
}

/**
 * Builds the `cardinalityByRelId` map expected by the edge adapter.
 */
export function buildCardinalityMap(
  relationships: Relationship[],
  tables: TableModel[],
): Map<string, { source: CrowsFootCardinality; target: CrowsFootCardinality }> {
  const map = new Map<string, { source: CrowsFootCardinality; target: CrowsFootCardinality }>();
  for (const rel of relationships) {
    map.set(rel.id, deriveCardinality(rel, tables));
  }
  return map;
}
