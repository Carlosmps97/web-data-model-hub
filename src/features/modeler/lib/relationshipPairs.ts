/**
 * Lógica PURA de los pares de una relación v2 (doc 19): validación de pares,
 * plan de role name (rename vs split estilo Erwin) y demote seguro de PK al
 * pasar a non-identifying. Sin IO — la orquestación vive en RelationshipPopup.
 */
import {
  bulk,
  type BulkChange,
  type CanonicalColumn,
  type Cardinality,
  type Relationship,
  type RelationshipPair,
} from '@/services/governance.service';
import { nextPkPosition } from './keyOrder';

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

// pairError / parentCandidates / childCandidates murieron con doc 47: el alta
// manual de pares se retiró — el mapeo N=N nace completo en buildKeyMapping.

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

// ── Mapeo N=N (doc 47): la relación migra la llave COMPLETA del padre ───────

export type MappingTarget =
  | { kind: 'existing'; columnId: string }
  | { kind: 'create' };

export interface MappingRow {
  parentColumnId: string;
  target: MappingTarget;
}

/**
 * Filas del popup de creación: UNA por PK del padre (en el orden recibido —
 * pasar `pkInKeyOrder`). Default por fila: columna del hijo HOMÓNIMA (físico o
 * lógico, case-insensitive) aún no reclamada; sin match → `create`.
 * `dropColumnId` (donde SOLTÓ el wire): si no quedó reclamada por un match,
 * se preselecciona en la primera fila `create`. Auto-mapeo excluido
 * (recursivas: una PK no migra a sí misma). Pura.
 */
export function buildKeyMapping(parentPks: CanonicalColumn[], childCols: CanonicalColumn[],
                                dropColumnId?: string | null): MappingRow[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const claimed = new Set<string>();
  const sameName = (pk: CanonicalColumn, c: CanonicalColumn) =>
    c.id !== pk.id && (norm(c.physicalName) === norm(pk.physicalName)
      || norm(c.logicalName) === norm(pk.logicalName));
  const rows: MappingRow[] = parentPks.map((pk) => {
    const hit = childCols.find((c) => !claimed.has(c.id) && sameName(pk, c));
    if (hit) {
      claimed.add(hit.id);
      return { parentColumnId: pk.id, target: { kind: 'existing' as const, columnId: hit.id } };
    }
    return { parentColumnId: pk.id, target: { kind: 'create' as const } };
  });
  const drop = dropColumnId ? childCols.find((c) => c.id === dropColumnId) : undefined;
  if (drop && !claimed.has(drop.id)) {
    const i = rows.findIndex((r) => r.target.kind === 'create' && r.parentColumnId !== drop.id);
    if (i >= 0) rows[i] = { parentColumnId: rows[i].parentColumnId, target: { kind: 'existing', columnId: drop.id } };
  }
  return rows;
}

export interface MappingResolution {
  parentCol: CanonicalColumn;
  target:
    | { kind: 'existing'; col: CanonicalColumn; preexisting?: boolean;
        /** Role name sobre columna EXISTENTE = rename in place (nombres ya
         *  fisicalizados — la función es pura). */
        rename?: { logicalName: string; physicalName: string } }
    | { kind: 'create'; id: string; logicalName: string; physicalName: string };
  /** Role name del par (en create nombra la columna nueva; en existentes viaja
   *  con `target.rename`; en preexisting conserva el vigente del par). */
  roleName?: string;
  /** Herencia POR FILA (feedback prueba viva 2026-08-15): definición/UDPs del
   *  padre (y en existentes también tipo/dominio). */
  inherit: boolean;
}

export interface MappingBulkInput {
  relId: string;
  parentTableId: string;
  childTableId: string;
  identifying: boolean;
  parentCardinality: Cardinality;
  childCardinality: Cardinality;
  /** En orden de llave del padre. */
  rows: MappingResolution[];
  /** Columnas ACTUALES del hijo (ordinal / nextPkPosition). */
  childCols: CanonicalColumn[];
  /** Doc 53: presencia = la relación es una SUBCATEGORÍA del símbolo dado
   *  (el caller pasa identifying=true y cardinalidades one/one). */
  subcategory?: { symbolId: string };
}

/**
 * Lote de confirmación del popup (create y sync): columnas nuevas + updates de
 * existentes + upsert de la relación — payloads DOC COMPLETO, la relación al
 * FINAL. Tipo/dominio SIEMPRE espejan al padre en columnas nuevas (contrato de
 * una FK); `inherit` va POR FILA y gobierna definición/UDPs (en existentes
 * también tipo/dominio). Role name en existentes = `target.rename` (rename in
 * place, mismo semántico que el Apply del popup de edición). `preexisting`
 * (sync): el par ya existía — la columna no se re-emite. Pura — `physicalize`
 * corre ANTES (los nombres llegan resueltos).
 */
export function mappingToBulk(input: MappingBulkInput): {
  changes: BulkChange[]; createdCols: CanonicalColumn[]; relationship: Relationship;
} {
  const { identifying, childCols } = input;
  let nextPos = nextPkPosition(childCols);
  const takePos = (): number | null => (nextPos == null ? null : nextPos++);
  const createdCols: CanonicalColumn[] = [];
  const changes: BulkChange[] = [];
  const pairs: RelationshipPair[] = [];
  let ordinal = childCols.length;

  for (const row of input.rows) {
    const p = row.parentCol;
    const pair = (childColumnId: string): RelationshipPair =>
      ({ parentColumnId: p.id, childColumnId, ...(row.roleName ? { roleName: row.roleName } : {}) });
    if (row.target.kind === 'create') {
      const colNew: CanonicalColumn = {
        id: row.target.id, tableId: input.childTableId,
        logicalName: row.target.logicalName, physicalName: row.target.physicalName,
        dataType: p.dataType, parentDomainId: p.parentDomainId, typeOverridden: p.typeOverridden,
        ordinal: ordinal++,
        isForeignKey: true, isPrimaryKey: identifying,
        isNullable: identifying ? false : true,
        pkPosition: identifying ? takePos() : null,
        ...(row.inherit ? { description: p.description, udpValues: p.udpValues ? { ...p.udpValues } : undefined } : {}),
      };
      createdCols.push(colNew);
      changes.push(bulk.createColumn(colNew));
      pairs.push(pair(colNew.id));
    } else {
      const colOld = row.target.col;
      if (!row.target.preexisting) {
        changes.push(bulk.createColumn({
          ...colOld, isForeignKey: true,
          ...(row.target.rename ?? {}),
          ...(identifying ? {
            isPrimaryKey: true, isNullable: false,
            ...(colOld.pkPosition == null ? { pkPosition: takePos() } : {}),
          } : {}),
          ...(row.inherit ? {
            dataType: p.dataType, parentDomainId: p.parentDomainId, typeOverridden: p.typeOverridden,
            description: p.description, udpValues: p.udpValues ? { ...p.udpValues } : undefined,
          } : {}),
        }));
      }
      pairs.push(pair(colOld.id));
    }
  }
  const relationship: Relationship = {
    id: input.relId, parentTableId: input.parentTableId, childTableId: input.childTableId,
    pairs, parentCardinality: input.parentCardinality, childCardinality: input.childCardinality,
    identifying,
    ...(input.subcategory ? { subcategory: true, subtypeSymbolId: input.subcategory.symbolId } : {}),
  };
  changes.push(bulk.upsertRelationship(relationship));
  return { changes, createdCols, relationship };
}

/** Drift de una relación vs la llave EFECTIVA del padre: `missing` = PKs sin
 *  par; `extra` = pares cuya columna padre ya no es PK. null = en sync. Pura.
 *  Padre SIN PK ⇒ todos los pares son `extra` ⇒ drift: delata la llave
 *  faltante al validar con los modeladores (owner 2026-08-23). */
export function relationshipDrift(rel: Relationship, parentPkIds: string[]):
    { missing: string[]; extra: string[] } | null {
  const inPairs = new Set(rel.pairs.map((p) => p.parentColumnId));
  const pkSet = new Set(parentPkIds);
  const missing = parentPkIds.filter((id) => !inPairs.has(id));
  const extra = rel.pairs.map((p) => p.parentColumnId).filter((id) => !pkSet.has(id));
  return missing.length || extra.length ? { missing, extra } : null;
}
