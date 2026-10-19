/**
 * Lógica PURA del copy/paste de TABLAS completas (doc 50). Sin IO — la
 * orquestación (nombres tomados en el proyecto, bulk, canvas, layout,
 * reintentos) vive en `useModelerStore.pasteTable`.
 *
 * El paste es la variante "tabla NUEVA desde un snapshot" de
 * createTableFromSources (docs 43/45): la tabla hereda esquema, definición,
 * UDPs y su color (doc 109, como Erwin); cada columna hereda su metadata INDIVIDUAL completa con id NUEVO y el
 * ORDEN DE LA LLAVE re-numerado. Viajan las DOS facetas (doc 118): tipo lógico
 * y su override, comment físico, override del físico y marcas de faceta. Lo que
 * NO viaja: relaciones (pedido explícito) ni el flag `isForeignKey` (sin
 * relación sería una marca huérfana) ni vistas.
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
 * hace legibles). La llama `pasteNames` con los físicos tomados del proyecto
 * (la unicidad del físico es por proyecto, doc 75).
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
 * Nombres de la tabla pegada (doc 118): si el físico está LIBRE en el destino
 * (CI) se conserva tal cual —lógico incluido, aunque ya traiga un `_copy_n`—;
 * si está tomado, el primer `_copy_n` libre sobre su base (`copyNameBase`).
 * `takenPhysical`: los físicos que ya existen en el destino.
 */
export function pasteNames(
  table: { physicalName: string; logicalName: string },
  takenPhysical: Iterable<string>,
): { physicalName: string; logicalName: string; renamed: boolean } {
  const taken = [...takenPhysical];
  const physical = table.physicalName.trim();
  if (!taken.some((t) => t.trim().toLowerCase() === physical.toLowerCase())) {
    return { physicalName: physical, logicalName: table.logicalName, renamed: false };
  }
  const next = nextCopyNames(
    copyNameBase(physical, 'physical'),
    copyNameBase(table.logicalName || physical, 'logical'),
    taken,
  );
  return { physicalName: next.physicalName, logicalName: next.logicalName, renamed: true };
}

/** Metadata propia de una columna que viaja al pegarla (tabla o columnas),
 *  sin nombres, tipo físico, dominio, llave ni orden: payload limpio — cada
 *  clave sólo cuando se aparta del default (patrón doc 40). */
export function columnCopyFields(c: CanonicalColumn): Partial<CanonicalColumn> {
  const description = (c.description ?? '').trim();
  const physicalDescription = (c.physicalDescription ?? '').trim();
  return {
    ...(description ? { description } : {}),
    ...(physicalDescription ? { physicalDescription } : {}),
    ...(c.logicalDataType ? { logicalDataType: c.logicalDataType } : {}),
    ...(c.logicalTypeOverridden ? { logicalTypeOverridden: true } : {}),
    ...(c.physicalNameOverridden ? { physicalNameOverridden: true } : {}),
    ...(c.isNullable === false ? { isNullable: false } : {}),
    ...(c.isPartition ? { isPartition: true } : {}),
    ...(c.logicalOnly ? { logicalOnly: true } : {}),
    ...(c.physicalOnly ? { physicalOnly: true } : {}),
    ...(c.udpValues && Object.keys(c.udpValues).length ? { udpValues: { ...c.udpValues } } : {}),
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
  /** Procedencia (doc 51): la tabla y los físicos de las columnas de ORIGEN por
   *  id — `table`/`cols` pueden traer ya los nombres finales de la copia — y,
   *  desde otro proyecto, su nombre (doc 118). Sin ella, los de `table`/`cols`. */
  source?: { table: string; columns: ReadonlyMap<string, string>; project?: string };
  /** Inyectable para tests; default crypto.randomUUID. */
  newId?: () => string;
}): BulkChange[] {
  const newId = input.newId ?? (() => crypto.randomUUID());
  const t = input.table;
  // Procedencia (doc 51): el historial de auditoría muestra de qué tabla/
  // columna nació cada entidad pegada ("Copied from …").
  const srcTable = input.source?.table ?? (t.physicalName || t.logicalName);
  const fromProject = input.source?.project ? { sourceProject: input.source.project } : {};
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
      ...(t.physicalNameOverridden ? { physicalNameOverridden: true } : {}),
      ...(t.logicalOnly ? { logicalOnly: true } : {}),
      ...(t.physicalOnly ? { physicalOnly: true } : {}),
    }, { kind: 'paste-table', sourceTable: srcTable, ...fromProject }),
  ];
  let ordinal = 0;
  for (const c of ordered) {
    changes.push(bulk.createColumn({
      id: newId(), tableId: input.id,
      logicalName: c.logicalName, physicalName: c.physicalName,
      parentDomainId: c.parentDomainId, dataType: c.dataType, typeOverridden: c.typeOverridden,
      isPrimaryKey: c.isPrimaryKey, ordinal: ordinal++,
      ...columnCopyFields(c),
    }, { kind: 'paste-table', sourceTable: srcTable, sourceColumn: input.source?.columns.get(c.id) ?? c.physicalName, ...fromProject }));
  }
  return changes;
}
