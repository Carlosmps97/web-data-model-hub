/**
 * reportSheets — las hojas del Excel del Reporting, que son también sus
 * pestañas: cada pestaña muestra su hoja en pantalla y su casilla la incluye en
 * el libro. Pantalla y Excel arman las filas con las mismas funciones
 * (`reportRows`), sobre los mismos datos ya acotados por la búsqueda
 * (`reportSearch.narrowSheetData`). Puras.
 */
import type { RelationshipRow, ReportColumnRow, ReportTableRow, ReportViewRow } from '@/services/reporting.service';
import {
  columnSheetRow, definitionSheetRow, joinedSheetRow, relationshipSheetRow, sortColumnRows, tableSheetRow, udpKeysOf,
  viewColumnSheetRow, viewSheetRow, type SheetRow,
} from './reportRows';
import type { WorkbookSheet } from './xlsxWriter';

export type SheetKey = 'tables' | 'columns' | 'joined' | 'relationships' | 'views' | 'viewColumns' | 'definitions';

export interface ReportSheet {
  key: SheetKey;
  /** Nombre de la pestaña = nombre de la hoja del libro. */
  label: string;
  sheet: string;
  hint: string;
}

export const REPORT_SHEETS: ReportSheet[] = [
  { key: 'tables', label: 'Tables', sheet: 'Tables', hint: 'One row per table: schema, counts, subject areas, projects, definition, flags, UDPs.' },
  { key: 'columns', label: 'Columns', sheet: 'Columns', hint: 'Every field: physical & logical type, PK/FK, nullable, partition, domain, ordinals, overrides, UDPs.' },
  { key: 'joined', label: 'Tables + Columns', sheet: 'Tables + Columns', hint: 'One row per column carrying its table metadata — everything in a single sheet.' },
  { key: 'relationships', label: 'Relationships', sheet: 'Relationships', hint: 'One row per column pair of each relationship: tables, columns, cardinality and verb phrases.' },
  { key: 'views', label: 'Views', sheet: 'Views', hint: 'One row per view derived from the tables: sources, canvases, description, SQL and User-Defined SQL.' },
  { key: 'viewColumns', label: 'View columns', sheet: 'View columns', hint: 'One row per view column: output alias, source table and column, cast type and expression.' },
  { key: 'definitions', label: 'Definitions', sheet: 'Definitions', hint: 'Functional definition text per table.' },
];

/** Datos de las hojas: las tablas del reporte y, si se leyeron, sus columnas,
 *  relaciones y vistas. */
export interface SheetData {
  tables: ReportTableRow[];
  columns?: ReportColumnRow[];
  relationships?: RelationshipRow[];
  views?: ReportViewRow[];
}

/** Qué lectura de detalle necesita la hoja (null = le bastan las tablas). */
export function sheetNeeds(key: SheetKey): 'columns' | 'relationships' | 'views' | null {
  if (key === 'columns' || key === 'joined') return 'columns';
  if (key === 'relationships') return 'relationships';
  if (key === 'views' || key === 'viewColumns') return 'views';
  return null;
}

const sheetOf = (key: SheetKey) => REPORT_SHEETS.find((s) => s.key === key)!.sheet;

/** Hoja del libro: su nombre y sus filas (se arman al pedirlas, no todas juntas). */
export function workbookSheet(key: SheetKey, data: SheetData): WorkbookSheet {
  const name = sheetOf(key);
  const of = (rows: readonly unknown[], rowAt: (i: number) => SheetRow): WorkbookSheet => ({ name, count: rows.length, rowAt });
  const tables = data.tables;
  const tableUdp = () => udpKeysOf(tables.map((t) => t.udpValues));
  switch (key) {
    case 'tables': {
      const udp = tableUdp();
      return of(tables, (i) => tableSheetRow(tables[i], udp));
    }
    case 'definitions':
      return of(tables, (i) => definitionSheetRow(tables[i]));
    case 'columns':
    case 'joined': {
      const byId = new Map(tables.map((t) => [t.id, t] as const));
      const cols = sortColumnRows(data.columns ?? [], (id) => byId.get(id)?.physicalName ?? id);
      const colUdp = udpKeysOf(cols.map((c) => c.udpValues));
      if (key === 'columns') return of(cols, (i) => columnSheetRow(cols[i], byId.get(cols[i].tableId), colUdp));
      const tblUdp = tableUdp();
      return of(cols, (i) => joinedSheetRow(cols[i], byId.get(cols[i].tableId), tblUdp, colUdp));
    }
    case 'relationships': {
      const rels = data.relationships ?? [];
      return of(rels, (i) => relationshipSheetRow(rels[i]));
    }
    case 'views': {
      const views = data.views ?? [];
      return of(views, (i) => viewSheetRow(views[i]));
    }
    case 'viewColumns': {
      const pairs = (data.views ?? []).flatMap((v) => v.columns.map((c) => [v, c] as const));
      return of(pairs, (i) => viewColumnSheetRow(pairs[i][0], pairs[i][1]));
    }
  }
}
