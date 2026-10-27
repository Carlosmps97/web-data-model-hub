// Hojas del Reporting: una pestaña por hoja del libro, y las mismas filas en
// pantalla y en el Excel.
import { describe, expect, it } from 'vitest';
import type { RelationshipRow, ReportColumnRow, ReportTableRow, ReportViewRow } from '@/services/reporting.service';
import {
  columnSheetRow, definitionSheetRow, joinedSheetRow, relationshipSheetRow, tableSheetRow, viewColumnSheetRow, viewSheetRow,
} from './reportRows';
import { REPORT_SHEETS, sheetNeeds, workbookSheet, type SheetData, type SheetKey } from './reportSheets';

const T1: ReportTableRow = {
  id: 't1', physicalName: 'B_TABLA', logicalName: 'Tabla B', schema: 's', subjectAreas: [], columnCount: 2,
  relationshipCount: 0, projects: ['P'], description: 'def B', udpValues: { Tipo: 'Maestro' },
};
const T2: ReportTableRow = { ...T1, id: 't2', physicalName: 'A_TABLA', logicalName: 'Tabla A', description: 'def A', udpValues: {} };
const col = (id: string, tableId: string, ordinal: number, pk = false): ReportColumnRow => ({
  id, tableId, physicalName: `COL_${id}`, logicalName: '', dataType: 'INT', isPrimaryKey: pk, isForeignKey: false,
  isNullable: true, isPartition: false, description: '', ordinal, udpValues: id === 'c2' ? { Particion: 'P1' } : {},
});
const V: ReportViewRow = {
  id: 'v1', name: 'VW', schema: 's_vu', sourceTableIds: ['t1'], sourceTables: ['s.B_TABLA'], showOnCanvas: true,
  sql: 'CREATE VIEW', columns: [{ outputAlias: 'A' }, { outputAlias: 'B', expression: 'X+1' }],
};
const R = { id: 'r1', parent: 'A', child: 'B', cardinality: '1:N', identifying: false, isSelfReferencing: false,
  crossSchema: false, label: '' } as RelationshipRow;
const data: SheetData = {
  tables: [T1, T2],
  columns: [col('c1', 't1', 2), col('c2', 't1', 1), col('c3', 't2', 1), col('c4', 't1', 3, true)],
  relationships: [R],
  views: [V],
};
const rowsOf = (key: SheetKey, d = data) => {
  const s = workbookSheet(key, d);
  return Array.from({ length: s.count }, (_, i) => s.rowAt(i));
};

describe('REPORT_SHEETS', () => {
  it('una pestaña por hoja, con el nombre y el orden del libro', () => {
    expect(REPORT_SHEETS.map((s) => s.sheet)).toEqual(
      ['Tables', 'Columns', 'Tables + Columns', 'Relationships', 'Views', 'View columns', 'Definitions']);
    expect(REPORT_SHEETS.map((s) => s.label)).toEqual(REPORT_SHEETS.map((s) => s.sheet));
    expect(REPORT_SHEETS.every((s) => s.hint.length > 0)).toBe(true);
  });

  it('qué datos lee cada hoja', () => {
    expect(REPORT_SHEETS.map((s) => [s.key, sheetNeeds(s.key)])).toEqual([
      ['tables', null], ['columns', 'columns'], ['joined', 'columns'], ['relationships', 'relationships'],
      ['views', 'views'], ['viewColumns', 'views'], ['definitions', null],
    ]);
  });
});

describe('workbookSheet', () => {
  it('nombre de la hoja del libro', () => {
    expect(REPORT_SHEETS.map((s) => workbookSheet(s.key, data).name)).toEqual(REPORT_SHEETS.map((s) => s.sheet));
  });

  it('Tables y Definitions: una fila por tabla, con los UDP de todas', () => {
    expect(rowsOf('tables')).toEqual([tableSheetRow(T1, ['Tipo']), tableSheetRow(T2, ['Tipo'])]);
    expect(rowsOf('definitions')).toEqual([definitionSheetRow(T1), definitionSheetRow(T2)]);
  });

  it('Columns: por tabla (nombre físico) y, dentro, PK primero y ordinal', () => {
    const rows = rowsOf('columns');
    expect(rows.map((r) => r.Column)).toEqual(['COL_c3', 'COL_c4', 'COL_c2', 'COL_c1']);
    expect(rows[2]).toEqual(columnSheetRow(data.columns![1], T1, ['Particion']));
  });

  it('Tables + Columns: fila unida con los UDP de tabla y de columna', () => {
    expect(rowsOf('joined')[2]).toEqual(joinedSheetRow(data.columns![1], T1, ['Tipo'], ['Particion']));
  });

  it('Relationships, Views y View columns', () => {
    expect(rowsOf('relationships')).toEqual([relationshipSheetRow(R)]);
    expect(rowsOf('views')).toEqual([viewSheetRow(V)]);
    expect(rowsOf('viewColumns')).toEqual(V.columns.map((c) => viewColumnSheetRow(V, c)));
  });

  it('sin los datos leídos, la hoja sale sin filas', () => {
    for (const key of ['columns', 'joined', 'relationships', 'views', 'viewColumns'] as SheetKey[]) {
      expect(workbookSheet(key, { tables: [T1] }).count).toBe(0);
    }
  });
});
