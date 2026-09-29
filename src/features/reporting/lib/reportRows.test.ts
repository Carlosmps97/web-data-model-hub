// Doc 70 §4.2: filas puras del reporte tabular (pantalla + Excel).
import { describe, expect, it } from 'vitest';
import type { ReportColumnRow, ReportTableRow } from '@/services/reporting.service';
import type { RelationshipRow } from '../query.service';
import {
  chunk, columnSheetRow, joinedSheetRow, relationshipSheetRow, sheetHeaders, sortColumnRows, tableSheetRow, udpKeysOf,
  unionSorted, viewSheetRow,
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
  typeOverridden: true,
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
      PK: 'Y', FK: '', Nullable: 'N', 'Type overridden': 'Y', 'Logical type overridden': '',
      'UDP · Particion': 'No Definido', Definition: 'Identificador', 'Column ID': 'c1', 'Table ID': 't1',
    });
    // Doc 85: comment físico al lado de la definición (vacío si no hay)
    expect(columnSheetRow({ ...C, physicalDescription: 'Comentario fisico' }, T, [])['Physical comment']).toBe('Comentario fisico');
    expect(row['Physical comment']).toBe('');
    // sin tabla resuelta cae al id; opcionales ausentes → vacío
    const bare = columnSheetRow({ ...C, id: undefined }, undefined, []);
    expect(bare.Table).toBe('t1');
    expect(Object.keys(bare)).not.toContain('Logical ordinal');   // doc 74: un solo orden
    expect(Object.keys(bare)).not.toContain('PK position');   // doc 94: sin orden de llave aparte
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
    // Doc 94: dentro de la tabla, el orden único — PK primero aunque su ordinal sea mayor
    const legacy = [{ ...C, id: 'x', isPrimaryKey: false, ordinal: 0 }, { ...C, id: 'k', isPrimaryKey: true, ordinal: 5 }];
    expect(sortColumnRows(legacy, () => 'T').map((r) => r.id)).toEqual(['k', 'x']);
  });
});


describe('viewSheetRow (final review #3 — doc 96 D6)', () => {
  it('sin columna «Mode»: la User-Defined SQL va como texto informativo', () => {
    const row = viewSheetRow({
      id: 'v1', name: 'VW', schema: 'gold_vu', sourceTableIds: ['t1'], sourceTables: ['gold.HD'], showOnCanvas: true,
      canvases: ['C1'], description: 'd', sql: 'CREATE VIEW …', customSql: 'SELECT 1', columns: [],
    });
    expect(Object.keys(row)).not.toContain('Mode');
    expect(row).toMatchObject({ View: 'VW', Schema: 'gold_vu', '#Columns': 0, 'User-Defined SQL': 'SELECT 1', SQL: 'CREATE VIEW …' });
  });
});

describe('relationshipSheetRow (doc 98 — hoja Relationships)', () => {
  const R: RelationshipRow = {
    id: 'r1', pairIndex: 1, pairCount: 2,
    parent: 'M_CLIENTE.CODCLI', parentSchema: 'core', child: 'M_CUENTA.CODCLI', childSchema: 'stg',
    parentTableId: 't1', childTableId: 't2',
    parentTable: 'M_CLIENTE', parentColumn: 'CODCLI', childTable: 'M_CUENTA', childColumn: 'CODCLI',
    roleName: 'titular', cardinality: '1 → 0..N', identifying: true,
    isSelfReferencing: false, crossSchema: true, label: 'M_CLIENTE.CODCLI → M_CUENTA.CODCLI (1 → 0..N)',
    parentToChildPhrase: 'Cliente tiene', childToParentPhrase: 'pertenece a un Cliente',
  };

  it('las columnas de siempre, con las dos frases junto a los datos de la relación', () => {
    expect(relationshipSheetRow(R)).toEqual({
      'Parent schema': 'core', 'Parent table': 'M_CLIENTE', 'Parent column': 'CODCLI',
      'Child schema': 'stg', 'Child table': 'M_CUENTA', 'Child column': 'CODCLI',
      'Role name': 'titular', Pair: '2/2', Cardinality: '1 → 0..N', Identifying: 'Y',
      'Parent-to-child phrase': 'Cliente tiene', 'Child-to-parent phrase': 'pertenece a un Cliente',
      'Self-referencing': '', 'Cross-schema': 'Y',
    });
  });

  it('el orden de las columnas del Excel es estable', () => {
    expect(Object.keys(relationshipSheetRow(R))).toEqual([
      'Parent schema', 'Parent table', 'Parent column', 'Child schema', 'Child table', 'Child column',
      'Role name', 'Pair', 'Cardinality', 'Identifying',
      'Parent-to-child phrase', 'Child-to-parent phrase', 'Self-referencing', 'Cross-schema',
    ]);
  });

  it('relación sin frases y de un solo par: celdas vacías', () => {
    const row = relationshipSheetRow({
      ...R, pairIndex: 0, pairCount: 1, roleName: null, parentToChildPhrase: null, childToParentPhrase: undefined,
    });
    expect(row).toMatchObject({
      'Role name': '', Pair: '', 'Parent-to-child phrase': '', 'Child-to-parent phrase': '',
    });
  });

  it('respuesta de un backend viejo (sin tabla/columna separadas): cae al extremo combinado', () => {
    const row = relationshipSheetRow({
      ...R, parentTable: undefined, parentColumn: undefined, childTable: undefined, childColumn: undefined,
    });
    expect(row).toMatchObject({
      'Parent table': 'M_CLIENTE.CODCLI', 'Parent column': '', 'Child table': 'M_CUENTA.CODCLI', 'Child column': '',
    });
  });
});
