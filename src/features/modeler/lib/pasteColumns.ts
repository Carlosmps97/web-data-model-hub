/**
 * Lógica PURA del copy/paste de columnas entre bloques (doc 48). Sin IO — la
 * orquestación (bulk + vistas espejo + reload) vive en PasteColumnsPopup.
 *
 * El paste es la variante "sobre tabla EXISTENTE" de createTableFromSources
 * (docs 43/45): cada columna pegada hereda su metadata INDIVIDUAL completa
 * (definición, PK/FK/nullable/partition, UDPs, dominio y tipo) con id NUEVO;
 * lo que NO viaja: relaciones (isForeignKey queda como marca) ni vistas.
 */
import {
  bulk,
  type BulkChange,
  type CanonicalColumn,
} from '@/services/governance.service';
import { nextPkPosition } from './keyOrder';

export interface PasteRow {
  /** Snapshot fuente (por valor, tomado al copiar). */
  col: CanonicalColumn;
  /** Físico duplicado CI en el destino → se EXCLUYE del lote (regla owner:
   *  bloqueo automático; espejo del guard 409 del backend). */
  blocked: boolean;
  /** Lógico duplicado CI — el backend no lo considera clave de unicidad:
   *  warning en el popup, se pega igual (decisión owner ii). */
  logicalDup: boolean;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Estado por fila del popup: qué se pega y qué queda bloqueado, contra el
 *  estado EFECTIVO del destino (diagram draft-aware del cliente). */
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
 * Cambios del lote (UN recordChangesBulk) para pegar `cols` en el destino.
 * `cols` debe venir YA filtrado (sin blocked) y en el orden del clipboard
 * (orden físico de la fuente). Reglas de createTableFromSources adaptadas:
 *  - ordinal: al FINAL del físico del destino (max+1, no length — hay huecos);
 *  - PK pegada: entra al FINAL de la llave si el destino maneja orden
 *    explícito (nextPkPosition, doc 19 §12b); si no, rige el orden físico;
 *  - payload limpio: flags solo cuando se apartan del default.
 */
export function pasteColumnsToBulk(input: {
  targetTableId: string;
  cols: CanonicalColumn[];
  targetCols: CanonicalColumn[];
  /** Tabla FUENTE del clipboard — procedencia para el historial de auditoría
   *  (doc 51: "Copied from column …"). */
  sourceTable?: string;
  /** Inyectable para tests; default crypto.randomUUID. */
  newId?: () => string;
}): BulkChange[] {
  const newId = input.newId ?? (() => crypto.randomUUID());
  let ordinal = input.targetCols.length
    ? Math.max(...input.targetCols.map((c) => c.ordinal)) + 1
    : 0;
  let pkPos = nextPkPosition(input.targetCols);
  return input.cols.map((c) => {
    const description = (c.description ?? '').trim();
    const pkPosition = c.isPrimaryKey && pkPos != null ? pkPos++ : null;
    return bulk.createColumn({
      id: newId(), tableId: input.targetTableId,
      logicalName: c.logicalName, physicalName: c.physicalName,
      parentDomainId: c.parentDomainId, dataType: c.dataType, typeOverridden: c.typeOverridden,
      isPrimaryKey: c.isPrimaryKey, ordinal: ordinal++,
      ...(description ? { description } : {}),
      ...(c.isForeignKey ? { isForeignKey: true } : {}),
      ...(c.isNullable === false ? { isNullable: false } : {}),
      ...(c.isPartition ? { isPartition: true } : {}),
      ...(c.udpValues && Object.keys(c.udpValues).length ? { udpValues: { ...c.udpValues } } : {}),
      ...(pkPosition != null ? { pkPosition } : {}),
    }, input.sourceTable
      ? { kind: 'paste-columns', sourceTable: input.sourceTable, sourceColumn: c.physicalName }
      : undefined);
  });
}
