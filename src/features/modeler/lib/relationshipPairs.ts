/**
 * Lógica pura de los pares de una relación: plan de role name (rename vs split
 * estilo Erwin), demote seguro de PK al pasar a non-identifying, mapeo de la
 * llave del padre y drift. Sin IO: la orquestación vive en RelationshipPopup.
 */
import {
  bulk,
  type BulkChange,
  type CanonicalColumn,
  type Cardinality,
  type Relationship,
  type RelationshipPair,
} from '@/services/governance.service';
import { pkFirstOrdinals } from './columnOrder';
import { cleanPhrase } from './relationshipLabel';

export type RoleNamePlan =
  | { kind: 'rename'; columnId: string }
  | { kind: 'split'; fromColumnId: string };

/**
 * Efecto de aplicar un role name al par `pairIndex` de `rel` (como en Erwin):
 * - la columna hija la usa solo este par (en `allRels`, que debe incluir a
 *   `rel`) → se renombra in place;
 * - está compartida/"unificada" (otro par de esta u otra relación la tiene
 *   como hija) → split: columna nueva y el par se repunta a ella.
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

/**
 * Columnas hijas de `rel` que se pueden demotear de PK al pasar la relación a
 * non-identifying: las que no son hijas de otra relación identifying (guard
 * conservador — un PK puesto por otra relación identifying no se pisa).
 */
export function demotablePkChildren(rel: Relationship, otherRels: Relationship[]): string[] {
  return rel.pairs
    .map((p) => p.childColumnId)
    .filter((cid) => !otherRels.some(
      (r) => r.id !== rel.id && r.identifying && r.pairs.some((p) => p.childColumnId === cid)));
}

// ── Mapeo N=N: la relación migra la llave completa del padre ────────────────

export type MappingTarget =
  | { kind: 'existing'; columnId: string }
  | { kind: 'create' };

export interface MappingRow {
  parentColumnId: string;
  target: MappingTarget;
}

/**
 * Filas del popup de creación: una por PK del padre (en el orden recibido —
 * pasar `pkInKeyOrder`). Default por fila: columna del hijo homónima (físico o
 * lógico, case-insensitive) sin reclamar; sin match → `create`.
 * `dropColumnId` (donde se soltó el wire): si no la reclama un match,
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
        /** Role name sobre columna existente = rename in place (nombres ya
         *  fisicalizados — la función es pura). */
        rename?: { logicalName: string; physicalName: string } }
    | { kind: 'create'; id: string; logicalName: string; physicalName: string };
  /** Role name del par (en create nombra la columna nueva; en existentes viaja
   *  con `target.rename`; en preexisting conserva el vigente del par). */
  roleName?: string;
  /** Herencia por fila: definición/UDPs del
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
  /** Columnas actuales del hijo (orden único). */
  childCols: CanonicalColumn[];
  /** Presencia = la relación es una subcategoría del símbolo dado
   *  (el caller pasa identifying=true y cardinalidades one/one). */
  subcategory?: { symbolId: string };
  /** Frases de relación. Crear las toma del popup; Sync pasa las
   *  vigentes: el lote re-emite la relación campo por campo. */
  parentToChildPhrase?: string | null;
  childToParentPhrase?: string | null;
}

/**
 * Lote de confirmación del popup (create y sync): columnas nuevas + updates de
 * existentes + upsert de la relación; payloads de documento completo, la
 * relación al final. Tipo/dominio siempre espejan al padre en columnas nuevas
 * (contrato de una FK); `inherit` va por fila y gobierna definición/UDPs (en
 * existentes también tipo/dominio). Role name en existentes = `target.rename`
 * (rename in place, misma semántica que el Apply del popup de edición).
 * `preexisting` (sync): el par ya existía y la columna no se re-emite. En una
 * identificante, las columnas que entran a la llave (creadas o promovidas, en
 * el orden de las filas) quedan tras la última PK del hijo y las no-PK se
 * corren en el mismo lote (cada columna viaja una sola vez); en una
 * no-identificante las creadas van al final. Pura: los nombres llegan
 * resueltos (`physicalize` corre en el llamador).
 */
export function mappingToBulk(input: MappingBulkInput): {
  changes: BulkChange[]; createdCols: CanonicalColumn[]; relationship: Relationship;
} {
  const { identifying, childCols } = input;
  const createdCols: CanonicalColumn[] = [];
  const changes: BulkChange[] = [];
  const pairs: RelationshipPair[] = [];
  const toKey = identifying
    ? input.rows.flatMap((r) => (r.target.kind === 'create' ? [r.target.id]
      : !r.target.preexisting && !r.target.col.isPrimaryKey ? [r.target.col.id] : []))
    : [];
  const created = input.rows.flatMap((r) => (r.target.kind === 'create' ? [{ id: r.target.id }] : []));
  const ord = identifying ? pkFirstOrdinals(childCols, { toKey, add: created }) : null;
  let ordinal = childCols.length;
  const touched = new Set<string>();

  for (const row of input.rows) {
    const p = row.parentCol;
    const pair = (childColumnId: string): RelationshipPair =>
      ({ parentColumnId: p.id, childColumnId, ...(row.roleName ? { roleName: row.roleName } : {}) });
    if (row.target.kind === 'create') {
      const colNew: CanonicalColumn = {
        id: row.target.id, tableId: input.childTableId,
        logicalName: row.target.logicalName, physicalName: row.target.physicalName,
        dataType: p.dataType, parentDomainId: p.parentDomainId, typeOverridden: p.typeOverridden,
        ordinal: ord ? ord.get(row.target.id)! : ordinal++,
        isForeignKey: true, isPrimaryKey: identifying,
        isNullable: identifying ? false : true,
        ...(row.inherit ? { description: p.description, udpValues: p.udpValues ? { ...p.udpValues } : undefined } : {}),
      };
      createdCols.push(colNew);
      changes.push(bulk.createColumn(colNew));
      pairs.push(pair(colNew.id));
    } else {
      const colOld = row.target.col;
      if (!row.target.preexisting) {
        touched.add(colOld.id);
        changes.push(bulk.createColumn({
          ...colOld, isForeignKey: true,
          ...(row.target.rename ?? {}),
          ...(identifying ? { isPrimaryKey: true, isNullable: false } : {}),
          ...(ord?.has(colOld.id) ? { ordinal: ord.get(colOld.id)! } : {}),
          ...(row.inherit ? {
            dataType: p.dataType, parentDomainId: p.parentDomainId, typeOverridden: p.typeOverridden,
            description: p.description, udpValues: p.udpValues ? { ...p.udpValues } : undefined,
          } : {}),
        }));
      }
      pairs.push(pair(colOld.id));
    }
  }
  // Corridas del orden único: existentes que se mueven y no viajaron ya.
  if (ord) {
    for (const c of childCols) {
      if (ord.has(c.id) && !touched.has(c.id)) changes.push(bulk.createColumn({ ...c, ordinal: ord.get(c.id)! }));
    }
  }
  // Las frases viajan limpias y solo si existen (sin frase, la relación sale
  // sin esa llave: el backend lee la llave ausente como null).
  const p2c = cleanPhrase(input.parentToChildPhrase);
  const c2p = cleanPhrase(input.childToParentPhrase);
  const relationship: Relationship = {
    id: input.relId, parentTableId: input.parentTableId, childTableId: input.childTableId,
    pairs, parentCardinality: input.parentCardinality, childCardinality: input.childCardinality,
    identifying,
    ...(input.subcategory ? { subcategory: true, subtypeSymbolId: input.subcategory.symbolId } : {}),
    ...(p2c ? { parentToChildPhrase: p2c } : {}),
    ...(c2p ? { childToParentPhrase: c2p } : {}),
  };
  changes.push(bulk.upsertRelationship(relationship));
  return { changes, createdCols, relationship };
}

/**
 * Entrada de `mappingToBulk` para re-emitir una relación que ya existe («Sync
 * with parent key»): lo que vive a nivel de relación sale de `rel` (id,
 * extremos, tipo, cardinalidades, frases y símbolo de subcategoría) y solo los
 * pares se rearman a partir de `rows`. Un campo nuevo de `Relationship` se
 * agrega acá: es el único punto que la reconstruye campo por campo. Pura.
 */
export function syncMappingInput(rel: Relationship, rows: MappingResolution[],
                                 childCols: CanonicalColumn[]): MappingBulkInput {
  return {
    relId: rel.id, parentTableId: rel.parentTableId, childTableId: rel.childTableId,
    identifying: rel.identifying,
    parentCardinality: rel.parentCardinality, childCardinality: rel.childCardinality,
    rows, childCols,
    parentToChildPhrase: rel.parentToChildPhrase, childToParentPhrase: rel.childToParentPhrase,
    ...(rel.subcategory && rel.subtypeSymbolId ? { subcategory: { symbolId: rel.subtypeSymbolId } } : {}),
  };
}

/** Drift de una relación vs la llave efectiva del padre: `missing` = PKs sin
 *  par; `extra` = pares cuya columna padre no es PK. null = en sync. Pura.
 *  Padre sin PK ⇒ todos los pares son `extra` ⇒ drift: delata la llave
 *  faltante. */
export function relationshipDrift(rel: Relationship, parentPkIds: string[]):
    { missing: string[]; extra: string[] } | null {
  const inPairs = new Set(rel.pairs.map((p) => p.parentColumnId));
  const pkSet = new Set(parentPkIds);
  const missing = parentPkIds.filter((id) => !inPairs.has(id));
  const extra = rel.pairs.map((p) => p.parentColumnId).filter((id) => !pkSet.has(id));
  return missing.length || extra.length ? { missing, extra } : null;
}
