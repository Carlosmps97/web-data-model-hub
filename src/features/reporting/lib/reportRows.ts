// Filas del reporte tabular (doc 70 §4.2) — funciones PURAS compartidas por la
// grilla en pantalla y las hojas del Excel: la metadata COMPLETA de tablas y
// columnas, por separado (`tableSheetRow` / `columnSheetRow`) o unida en una
// fila por columna con la metadata de su tabla (`joinedSheetRow`). Los UDPs
// salen como columnas dinámicas «UDP · <def>» (unión de claves, orden estable).
import type { RelationshipRow } from '../query.service';
import type { ReportColumnRow, ReportTableRow, ReportViewRow } from '@/services/reporting.service';

export type SheetRow = Record<string, string | number>;

/** Tope de tablas por pedido de COLUMNAS (doc 102: los ids van en el CUERPO;
 *  el lote acota el tamaño de cada respuesta y permite pedirlos en paralelo);
 *  lotes más grandes se parten con `chunk`. */
export const COLUMN_BATCH = 300;

/** Doc 102: tope de ids por pedido de VISTAS (van en el cuerpo; el backend
 *  acepta hasta 5 000). */
export const VIEW_BATCH = 2000;

/** Doc 105 (A3-o1): tope de ids por pedido de RELACIONES (el backend acepta 1..300). */
export const RELATIONSHIP_BATCH = 300;

const yn = (b: boolean | null | undefined): string => (b ? 'Y' : '');
const str = (v: string | null | undefined): string => v ?? '';

/** Columnas Excel dinámicas «UDP · <def>» — una por cada UDP presente en las
 *  filas (unión de claves, orden alfabético estable). */
export function udpKeysOf(maps: Array<Record<string, string> | undefined>): string[] {
  return Array.from(new Set(maps.flatMap((m) => Object.keys(m ?? {})))).sort();
}

const udpCells = (values: Record<string, string> | undefined, keys: string[]): SheetRow =>
  Object.fromEntries(keys.map((k) => [`UDP · ${k}`, values?.[k] ?? '']));

/** Fila de la hoja Tables: toda la metadata de la tabla (docs 68/69 incl.). */
export function tableSheetRow(t: ReportTableRow, udpKeys: string[]): SheetRow {
  return {
    Table: t.physicalName,
    'Logical name': t.logicalName,
    Schema: t.schema,
    Space: (t.spaces ?? []).join(', '),   // doc 102: carpeta raíz (sub-proyecto)
    'Subject areas': t.subjectAreas.join(', '),
    Diagrams: (t.diagrams ?? []).join(', '),
    '#Columns': t.columnCount,
    '#Relations': t.relationshipCount,
    Projects: t.projects.join(', '),
    'Functional definition': str(t.description),
    'Physical name overridden': yn(t.physicalNameOverridden),
    'Logical only': yn(t.logicalOnly),
    'Physical only': yn(t.physicalOnly),
    ...udpCells(t.udpValues, udpKeys),
    'Table ID': t.id,
  };
}

/** Fila de la hoja Columns: toda la metadata de la columna (docs 19/68/69). */
export function columnSheetRow(c: ReportColumnRow, table: ReportTableRow | undefined, udpKeys: string[]): SheetRow {
  return {
    Table: table?.physicalName ?? c.tableId,
    Schema: str(table?.schema),
    Column: c.physicalName,
    'Logical name': c.logicalName,
    Ordinal: c.ordinal,
    'Data type': c.dataType,
    'Logical type': str(c.logicalDataType),
    'Parent domain': str(c.parentDomain),
    PK: yn(c.isPrimaryKey),
    FK: yn(c.isForeignKey),
    Nullable: c.isNullable ? 'Y' : 'N',
    Partition: yn(c.isPartition),
    'Type overridden': yn(c.typeOverridden),
    'Logical type overridden': yn(c.logicalTypeOverridden),
    'Physical name overridden': yn(c.physicalNameOverridden),
    'Logical only': yn(c.logicalOnly),
    'Physical only': yn(c.physicalOnly),
    ...udpCells(c.udpValues, udpKeys),
    Definition: str(c.description),
    'Physical comment': str(c.physicalDescription),   // doc 85
    'Column ID': str(c.id),
    'Table ID': c.tableId,
  };
}

/** Fila UNIDA (Tables + Columns): la metadata de la tabla («Table · …») seguida
 *  de la de la columna («Column · …»), una fila por columna. */
export function joinedSheetRow(
  c: ReportColumnRow, table: ReportTableRow | undefined,
  tableUdpKeys: string[], columnUdpKeys: string[],
): SheetRow {
  const t: SheetRow = table ? tableSheetRow(table, tableUdpKeys) : { Table: c.tableId, 'Table ID': c.tableId };
  const col = columnSheetRow(c, table, columnUdpKeys);
  const out: SheetRow = {};
  for (const [k, v] of Object.entries(t)) out[k === 'Table' ? 'Table' : `Table · ${k.replace(/^Table /, '')}`] = v;
  for (const [k, v] of Object.entries(col)) {
    if (k === 'Table' || k === 'Schema' || k === 'Table ID') continue;   // ya viajan del lado tabla
    out[k === 'Column' ? 'Column' : `Column · ${k.replace(/^Column /, '')}`] = v;
  }
  return out;
}

/** Orden estable de columnas para la grilla en pantalla: unión de las claves
 *  de todas las filas, en orden de primera aparición. */
export function sheetHeaders(rows: SheetRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); out.push(k); }
  return out;
}

/** Unión ordenada (case-insensitive) sin vacíos ni duplicados — opciones de un
 *  filtro = universo del servidor ∪ valores presentes en las filas cargadas. */
export function unionSorted(server: Iterable<string>, local: Iterable<string>): string[] {
  const s = new Set<string>();
  for (const v of server) if (v) s.add(v);
  for (const v of local) if (v) s.add(v);
  return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b));
}

/** Parte `xs` en lotes de `n` (último lote más corto). */
export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Orden de presentación de las columnas: tabla (físico) y, dentro de ella,
 *  el orden único (doc 94: PK primero y cada bloque por ordinal). */
export function sortColumnRows(rows: ReportColumnRow[], tableName: (id: string) => string): ReportColumnRow[] {
  return [...rows].sort((a, b) =>
    tableName(a.tableId).localeCompare(tableName(b.tableId)) || a.tableId.localeCompare(b.tableId)
    || Number(!!b.isPrimaryKey) - Number(!!a.isPrimaryKey) || a.ordinal - b.ordinal);
}

/** Fila de la hoja «Views» del export tabular. Doc 96 D6: sin «Mode» — la
 *  User-Defined SQL es texto informativo y va en su propia columna; el DDL de
 *  la vista sale de sus columnas. */
export function viewSheetRow(v: ReportViewRow): SheetRow {
  return {
    View: v.name,
    Schema: v.schema ?? '',
    'Source tables': v.sourceTables.join(', '),
    '#Columns': v.columns.length,
    'On canvas': v.showOnCanvas ? 'Y' : '',
    Canvases: (v.canvases ?? []).join(', '),   // doc 70: membresía por canvas
    Description: v.description ?? '',
    SQL: v.sql ?? '',
    'User-Defined SQL': v.customSql ?? '',
  };
}

/** Fila de la hoja «Relationships»: detalle POR PAR de columnas (v2, doc 19 —
 *  una FK compuesta emite una fila por par, con «Pair i/n»). Doc 98: las
 *  frases de la relación van junto a sus otros datos de relación. */
export function relationshipSheetRow(r: RelationshipRow): SheetRow {
  return {
    'Parent schema': str(r.parentSchema),
    'Parent table': r.parentTable ?? r.parent,
    'Parent column': str(r.parentColumn),
    'Child schema': str(r.childSchema),
    'Child table': r.childTable ?? r.child,
    'Child column': str(r.childColumn),
    'Role name': str(r.roleName),
    Pair: r.pairCount && r.pairCount > 1 ? `${(r.pairIndex ?? 0) + 1}/${r.pairCount}` : '',
    Cardinality: r.cardinality,
    Identifying: yn(r.identifying),
    'Parent-to-child phrase': str(r.parentToChildPhrase),
    'Child-to-parent phrase': str(r.childToParentPhrase),
    'Self-referencing': yn(r.isSelfReferencing),
    'Cross-schema': yn(r.crossSchema),
  };
}
