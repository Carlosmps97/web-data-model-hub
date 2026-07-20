/**
 * Lógica PURA de los pares de una relación v2 (doc 19): validación de pares,
 * plan de role name (rename vs split estilo Erwin) y demote seguro de PK al
 * pasar a non-identifying. Sin IO — la orquestación vive en RelationshipPopup.
 */
import type {
  CanonicalColumn,
  Relationship,
} from '@/features/governance/services/governance.service';

export type RoleNamePlan =
  | { kind: 'rename'; columnId: string }
  | { kind: 'split'; fromColumnId: string };

/**
 * Efecto de aplicar un role name al par `pairIndex` de `rel` (Erwin §1.2):
 * - la columna hija la usa SOLO este par (en `allRels`, que debe incluir a
 *   `rel`) → se RENOMBRA in place;
 * - está compartida/"unificada" (otro par de esta u otra relación la tiene
 *   como hija) → SPLIT: columna nueva y el par se repunta a ella.
 */
export function roleNamePlan(rel: Relationship, pairIndex: number,
                             allRels: Relationship[]): RoleNamePlan {
  const childId = rel.pairs[pairIndex]?.childColumnId;
  let otherUses = 0;
  for (const r of allRels) {
    r.pairs.forEach((p, i) => {
      if (p.childColumnId !== childId) return;
      if (r.id === rel.id && i === pairIndex) return;
      otherUses += 1;
    });
  }
  return otherUses > 0
    ? { kind: 'split', fromColumnId: childId }
    : { kind: 'rename', columnId: childId };
}

/** Error legible al agregar un par a `rel`; null si es válido. */
export function pairError(rel: Relationship, parentColumnId: string,
                          childColumnId: string): string | null {
  if (!parentColumnId || !childColumnId) return 'Pick both columns';
  if (rel.pairs.some((p) => p.parentColumnId === parentColumnId && p.childColumnId === childColumnId)) {
    return 'That pair already exists in the relationship';
  }
  if (rel.pairs.some((p) => p.childColumnId === childColumnId)) {
    return 'That child column is already used by another pair of this relationship';
  }
  return null;
}

/** Candidatas del PADRE para un par nuevo: SOLO sus columnas PK (la relación
 *  nace de la llave del padre — el 1er par auto-promueve, los extra no). */
export function parentCandidates(cols: CanonicalColumn[], parentTableId: string): CanonicalColumn[] {
  return cols.filter((c) => c.tableId === parentTableId && !!c.isPrimaryKey);
}

/** Candidatas del HIJO: cualquier columna de la tabla hija. */
export function childCandidates(cols: CanonicalColumn[], childTableId: string): CanonicalColumn[] {
  return cols.filter((c) => c.tableId === childTableId);
}

/**
 * Columnas hijas de `rel` que se pueden DEMOTEAR de PK al pasar la relación a
 * non-identifying: las que NO son hijas de OTRA relación identifying (guard
 * conservador — un PK puesto por otra relación identifying no se pisa).
 */
export function demotablePkChildren(rel: Relationship, otherRels: Relationship[]): string[] {
  return rel.pairs
    .map((p) => p.childColumnId)
    .filter((cid) => !otherRels.some(
      (r) => r.id !== rel.id && r.identifying && r.pairs.some((p) => p.childColumnId === cid)));
}
