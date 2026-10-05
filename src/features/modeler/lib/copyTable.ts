/**
 * Lógica PURA del copy/paste de TABLAS completas (doc 50). Sin IO — la
 * orquestación (pool global, bulk, canvas, layout, reintentos) vive en
 * `useModelerStore.pasteTable`.
 *
 * El paste es la variante "tabla NUEVA desde un snapshot" de
 * createTableFromSources (docs 43/45): la tabla hereda esquema, definición,
 * UDPs y su color (doc 109, como Erwin); cada columna hereda su metadata INDIVIDUAL completa con id NUEVO y el
 * ORDEN DE LA LLAVE re-numerado. Lo que NO viaja: relaciones (pedido
 * explícito) ni el flag `isForeignKey` (sin relación sería una marca
 * huérfana — difiere del paste de columnas del doc 48) ni vistas.
 */
import {
  bulk,
  type BulkChange,
  type CanonicalColumn,
  type CanonicalTable,
} from '@/services/governance.service';
import { orderColumns } from './columnOrder';

const PHYS_SUFFIX = /_copy_\d+$/i;
const LOGI_SUFFIX = / copy \d+$/i;

/** Base del nombre de la copia: despoja UN sufijo previo (`X_copy_2` copiada
 *  → base `X`, no `X_copy_2_copy_1`) — el correlativo cuenta copias de la
 *  MISMA tabla. */
export function copyNameBase(name: string, kind: 'physical' | 'logical'): string {
  const trimmed = name.trim();
  const base = trimmed.replace(kind === 'physical' ? PHYS_SUFFIX : LOGI_SUFFIX, '');
  return base || trimmed;
}

/**
 * Nombres de la copia: el menor `n ≥ 1` cuyo FÍSICO `${base}_copy_${n}` esté
 * libre (CI) contra `takenPhysical`; el lógico usa el MISMO `n` (los lógicos
 * no tienen unicidad — doc 50 §2 — pero mantener el correlativo alineado los
 * hace legibles). El caller arma `takenPhysical` con el pool GLOBAL efectivo
 * (la unicidad del físico es global) + el diagrama local.
 */
export function nextCopyNames(
  basePhysical: string,
  baseLogical: string,
  takenPhysical: Iterable<string>,
): { physicalName: string; logicalName: string; n: number } {
  const taken = new Set<string>();
  for (const t of takenPhysical) taken.add(t.trim().toLowerCase());
  let n = 1;
  while (taken.has(`${basePhysical}_copy_${n}`.toLowerCase())) n += 1;
  return {
    physicalName: `${basePhysical}_copy_${n}`,
    logicalName: `${baseLogical} copy ${n}`,
    n,
  };
}

/**
 * Cambios del lote (UN recordChangesBulk) de la tabla pegada. Reglas de
 * createTableFromSources adaptadas al snapshot:
 *  - ids SIEMPRE nuevos (tabla `input.id`, columnas `newId()`);
 *  - ordinal secuencial 0.. en el ORDEN ÚNICO del snapshot (doc 94: PK
 *    primero, cada bloque por ordinal — un dato viejo desordenado se copia
 *    normalizado);
 *  - `isForeignKey` NO viaja (doc 50: las relaciones no se copian);
 *  - payload limpio: claves opcionales solo cuando aportan (patrón doc 40).
 */
export function copyTableToBulk(input: {
  table: CanonicalTable;
  cols: CanonicalColumn[];
  id: string;
  physicalName: string;
  logicalName: string;
  /** Inyectable para tests; default crypto.randomUUID. */
  newId?: () => string;
}): BulkChange[] {
  const newId = input.newId ?? (() => crypto.randomUUID());
  const t = input.table;
  // Procedencia (doc 51): el historial de auditoría muestra de qué tabla/
  // columna nació cada entidad pegada ("Copied from …").
  const srcTable = t.physicalName || t.logicalName;
  const ordered = orderColumns(input.cols);
  const changes: BulkChange[] = [
    bulk.createTable({
      id: input.id,
      logicalName: input.logicalName,
      physicalName: input.physicalName,
      ...(t.schema ? { schema: t.schema } : {}),
      ...(t.description ? { description: t.description } : {}),
      ...(t.udpValues && Object.keys(t.udpValues).length ? { udpValues: { ...t.udpValues } } : {}),
      ...(t.color ? { color: t.color } : {}),
    }, { kind: 'paste-table', sourceTable: srcTable }),
  ];
  let ordinal = 0;
  for (const c of ordered) {
    const description = (c.description ?? '').trim();
    changes.push(bulk.createColumn({
      id: newId(), tableId: input.id,
      logicalName: c.logicalName, physicalName: c.physicalName,
      parentDomainId: c.parentDomainId, dataType: c.dataType, typeOverridden: c.typeOverridden,
      isPrimaryKey: c.isPrimaryKey, ordinal: ordinal++,
      ...(description ? { description } : {}),
      ...(c.isNullable === false ? { isNullable: false } : {}),
      ...(c.isPartition ? { isPartition: true } : {}),
      ...(c.udpValues && Object.keys(c.udpValues).length ? { udpValues: { ...c.udpValues } } : {}),
    }, { kind: 'paste-table', sourceTable: srcTable, sourceColumn: c.physicalName }));
  }
  return changes;
}
