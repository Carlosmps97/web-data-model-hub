// Doc 70 §4.2: filas puras del reporte tabular (pantalla + Excel).
import { describe, expect, it } from 'vitest';
import type { ReportColumnRow, ReportTableRow } from '@/services/reporting.service';
import {
  chunk, columnSheetRow, joinedSheetRow, sheetHeaders, sortColumnRows, tableSheetRow, udpKeysOf, unionSorted,
} from './reportRows';

const T: ReportTableRow = {
  id: 't1', physicalName: 'M_CLIENTE', logicalName: 'Cliente', schema: 'core',
  subjectAreas: ['Banking', 'Risk'], columnCount: 2, relationshipCount: 1, projects: ['DDV'],
  udpValues: { 'Tipo de Tabla': 'Maestro' }, description: 'Maestro de clientes',
  physicalNameOverridden: true, logicalOnly: false, physicalOnly: false,
};
const C: ReportColumnRow = {
  id: 'c1', tableId: 't1', physicalName: 'CODCLI', logicalName: 'Codigo Cliente', dataType: 'VARCHAR(30)',
  logicalDataType: 'VARCHAR(20)', parentDomain: 'Codigo', isPrimaryKey: true, isForeignKey: false, isNullable: false,
  isPartition: false, udpValues: { Particion: 'No Definido' }, description: 'Identificador', ordinal: 0,
  pkPosition: 0, typeOverridden: true,
};

describe('reportRows', () => {
  it('tableSheetRow: metadata completa + UDP dinámicos + id al final', () => {
    const row = tableSheetRow(T, ['Tipo de Tabla', 'Otro']);
    expect(row).toMatchObject({
      Table: 'M_CLIENTE', Schema: 'core', 'Subject areas': 'Banking, Risk', '#Columns': 2,
      'Functional definition': 'Maestro de clientes', 'Physical name overridden': 'Y', 'Logical only': '',
      'UDP · Tipo de Tabla': 'Maestro', 'UDP · Otro': '', 'Table ID': 't1',
    });
    expect(Object.keys(row).at(-1)).toBe('Table ID');
  });

  it('columnSheetRow: resuelve la tabla y expone facetas/overrides/posiciones', () => {
    const row = columnSheetRow(C, T, ['Particion']);
    expect(row).toMatchObject({
      Table: 'M_CLIENTE', Schema: 'core', Column: 'CODCLI', Ordinal: 0,
      'Data type': 'VARCHAR(30)', 'Logical type': 'VARCHAR(20)', 'Parent domain': 'Codigo',
      PK: 'Y', 'PK position': 0, FK: '', Nullable: 'N', 'Type overridden': 'Y', 'Logical type overridden': '',
      'UDP · Particion': 'No Definido', Definition: 'Identificador', 'Column ID': 'c1', 'Table ID': 't1',
    });
    // sin tabla resuelta cae al id; opcionales ausentes → vacío
    const bare = columnSheetRow({ ...C, id: undefined, pkPosition: null }, undefined, []);
    expect(bare.Table).toBe('t1');
    expect(Object.keys(bare)).not.toContain('Logical ordinal');   // doc 74: un solo orden
    expect(bare['PK position']).toBe('');
    expect(bare['Column ID']).toBe('');
  });

  it('joinedSheetRow: prefija tabla y columna sin repetir Table/Schema/Table ID', () => {
    const row = joinedSheetRow(C, T, ['Tipo de Tabla'], ['Particion']);
    const keys = Object.keys(row);
    expect(keys[0]).toBe('Table');
    expect(row['Table · Functional definition']).toBe('Maestro de clientes');
    expect(row['Table · UDP · Tipo de Tabla']).toBe('Maestro');
    expect(row.Column).toBe('CODCLI');
    expect(row['Column · Data type']).toBe('VARCHAR(30)');
    expect(row['Column · UDP · Particion']).toBe('No Definido');
    expect(keys.filter((k) => k === 'Schema' || k === 'Table ID')).toEqual([]);
    expect(row['Table · ID']).toBe('t1');
    expect(row['Column · ID']).toBe('c1');
  });

  it('sheetHeaders / udpKeysOf / unionSorted / chunk / sortColumnRows', () => {
    expect(sheetHeaders([{ a: 1, b: 2 }, { b: 3, c: 4 }])).toEqual(['a', 'b', 'c']);
    expect(udpKeysOf([{ b: '1' }, undefined, { a: '2', b: '3' }])).toEqual(['a', 'b']);
    expect(unionSorted(['core', 'Risk'], ['analytics', 'core', ''])).toEqual(['analytics', 'core', 'Risk']);
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    const rows = [
      { ...C, tableId: 't2', ordinal: 0 }, { ...C, tableId: 't1', ordinal: 1 }, { ...C, tableId: 't1', ordinal: 0 },
    ];
    const names: Record<string, string> = { t1: 'B_TABLE', t2: 'A_TABLE' };
    expect(sortColumnRows(rows, (id) => names[id] ?? id).map((r) => `${r.tableId}:${r.ordinal}`))
      .toEqual(['t2:0', 't1:0', 't1:1']);
  });
});
