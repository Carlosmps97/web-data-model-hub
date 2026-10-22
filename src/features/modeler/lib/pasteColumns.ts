/**
 * Lógica pura del copy/paste de columnas entre bloques. Sin IO: la
 * orquestación (bulk + vistas espejo + reload) vive en PasteColumnsPopup.
 *
 * El paste es la variante "sobre tabla existente" de createTableFromSources:
 * cada columna pegada hereda su metadata individual completa de las dos
 * facetas (definición y comment físico, PK/nullable/partition, UDPs, dominio,
 * tipos lógico y físico) con id nuevo; lo que no viaja: relaciones (tampoco
 * la marca FK) ni vistas.
 */
import {
  bulk,
  type BulkChange,
  type CanonicalColumn,
} from '@/services/governance.service';
import { columnCopyFields } from './copyTable';
import { pkFirstOrdinals } from './columnOrder';
import { preKey } from './undoInvert';

export interface PasteRow {
  /** Snapshot fuente (por valor, tomado al copiar). */
  col: CanonicalColumn;
  /** Físico duplicado CI en el destino → se excluye del lote (bloqueo
   *  automático; espejo del guard 409 del backend). */
  blocked: boolean;
  /** Lógico duplicado CI — el backend no lo considera clave de unicidad:
   *  warning en el popup, se pega igual. */
  logicalDup: boolean;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Estado por fila del popup: qué se pega y qué queda bloqueado, contra el
 *  estado efectivo del destino (diagram draft-aware del cliente). */
export function pastePlan(clipboard: CanonicalColumn[], targetCols: CanonicalColumn[]): PasteRow[] {
  const phys = new Set(targetCols.map((c) => norm(c.physicalName)));
  const logi = new Set(targetCols.map((c) => norm(c.logicalName)));
  return clipboard.map((col) => ({
    col,
    blocked: phys.has(norm(col.physicalName)),
    logicalDup: logi.has(norm(col.logicalName)),
  }));
}

/**
 * Cambios del lote (un recordChangesBulk) para pegar `cols` en el destino.
 * `cols` debe venir ya filtrado (sin blocked) y en el orden del clipboard
 * (orden físico de la fuente). Reglas de createTableFromSources adaptadas:
 *  - ordinal: al final del físico del destino (max+1, no length — hay huecos);
 *  - si se pegan PK, entran tras la última PK del destino (en el orden del
 *    clipboard) y las no-PK del destino se corren en el mismo lote (upsert del
 *    documento completo con el ordinal nuevo): la tabla queda PK primero;
 *  - payload limpio: flags solo cuando se apartan del default.
 * Undo: `invertBulk(changes, pastePreImages(targetCols))` — borra las pegadas y
 * devuelve las corridas a su ordinal.
 */
export function pasteColumnsToBulk(input: {
  targetTableId: string;
  cols: CanonicalColumn[];
  targetCols: CanonicalColumn[];
  /** Tabla fuente del clipboard — procedencia para el historial de auditoría
   *  ("Copied from column …"). */
  sourceTable?: string;
  /** Físico de origen de cada columna por id (la pegada puede salir con el case
   *  del destino); sin él, el de `cols`. */
  sourceColumns?: ReadonlyMap<string, string>;
  /** Pegado desde otro proyecto: su nombre. */
  sourceProject?: string;
  /** Inyectable para tests; default crypto.randomUUID. */
  newId?: () => string;
}): BulkChange[] {
  const newId = input.newId ?? (() => crypto.randomUUID());
  const created = input.cols.map((c) => ({ c, id: newId() }));
  const pkIds = created.filter(({ c }) => !!c.isPrimaryKey).map(({ id }) => id);
  let ordinalOf: Map<string, number>;
  let shifts: BulkChange[] = [];
  if (pkIds.length) {
    ordinalOf = pkFirstOrdinals(input.targetCols, { toKey: pkIds, add: created.map(({ id }) => ({ id })) });
    shifts = input.targetCols
      .filter((c) => ordinalOf.has(c.id))
      .map((c) => bulk.createColumn({ ...c, ordinal: ordinalOf.get(c.id)! }));
  } else {
    let next = input.targetCols.length ? Math.max(...input.targetCols.map((c) => c.ordinal)) + 1 : 0;
    ordinalOf = new Map(created.map(({ id }) => [id, next++]));
  }
  const creates = created.map(({ c, id }) => bulk.createColumn({
    id, tableId: input.targetTableId,
    logicalName: c.logicalName, physicalName: c.physicalName,
    parentDomainId: c.parentDomainId, dataType: c.dataType, typeOverridden: c.typeOverridden,
    isPrimaryKey: c.isPrimaryKey, ordinal: ordinalOf.get(id)!,
    ...columnCopyFields(c),
  }, input.sourceTable
    ? { kind: 'paste-columns', sourceTable: input.sourceTable, sourceColumn: input.sourceColumns?.get(c.id) ?? c.physicalName,
      ...(input.sourceProject ? { sourceProject: input.sourceProject } : {}) }
    : undefined));
  return [...creates, ...shifts];
}

/** Pre-imágenes del destino para el Undo del paste: las
 *  columnas existentes corridas vuelven a su ordinal; las pegadas se borran. */
export function pastePreImages(targetCols: CanonicalColumn[]): Map<string, Record<string, unknown>> {
  return new Map(targetCols.map((c) => [
    preKey('canonical_columns', c.id),
    { ...c, ...(c.udpValues ? { udpValues: { ...c.udpValues } } : {}) } as Record<string, unknown>,
  ]));
}
