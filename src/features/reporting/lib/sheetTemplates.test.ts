import { describe, expect, it } from 'vitest';
import type { ReportColumnRow, ReportTableRow } from '@/services/reporting.service';
import {
  canEditTemplate, cleanFileName, compileFilters, fileNameProblem, filterOps, isKnownSource, moveItem, sourceLabel,
  sourceOptions, splitValues, templateFileName, templateProblems, templateRows, toFilterBody, toFilterDraft,
  type SheetTemplateFilter,
} from './sheetTemplates';

describe('canEditTemplate (dueño + compartida)', () => {
  it.each([
    [{ owner: 'ana', shared: false }, 'ana', false, true],       // la dueña
    [{ owner: 'ana', shared: true }, 'luis', false, false],      // compartida ajena: solo la usa
    [{ owner: 'system', shared: true }, 'jefa', true, true],     // admin: las compartidas (QA_MODELO)
    [{ owner: 'ana', shared: false }, 'jefa', true, false],      // ni el admin toca una privada ajena
    [{ owner: 'ana', shared: false }, undefined, false, false],  // sin sesión
  ])('%o · %s · admin=%s → %s', (tpl, user, admin, ok) => {
    expect(canEditTemplate(tpl, user, admin)).toBe(ok);
  });
});

const T: ReportTableRow = {
  id: 't1', physicalName: 'HM_PAGOCLIENTEDEUDOR', logicalName: 'hm pago', schema: 'stg_pagos',
  subjectAreas: [], columnCount: 3, relationshipCount: 0, projects: ['Ventas'], description: '',
  udpValues: { 'Clasificacion del Dato': 'No DAC', 'Dominio Principal': 'Soluciones de Pago' },
};
const col = (over: Partial<ReportColumnRow>): ReportColumnRow => ({
  tableId: 't1', physicalName: 'X', logicalName: 'x', dataType: 'STRING', isPrimaryKey: false, isForeignKey: false,
  isNullable: true, isPartition: false, description: '', ordinal: 0, udpValues: {}, ...over,
});
const COLS = [
  col({ physicalName: 'TIPRANGOPOBLACION', ordinal: 0, udpValues: { 'Clasificacion del Dato': 'No DAC' } }),
  col({ physicalName: 'CODMES', ordinal: 4, isPrimaryKey: true, parentDomain: 'CodMes',
        udpValues: { Particion: 'PART_02', 'Clasificacion del Dato': 'No DAC' } }),
  col({ physicalName: 'CODCLAVEPARTYCLI', ordinal: 1, isPrimaryKey: true, parentDomain: 'Codigo Clave SHA2 512' }),
];
const QA = {
  columns: [
    { header: 'DATABASE', source: 'table.schema' }, { header: 'TABLA_FISICA', source: 'table.physicalName' },
    { header: 'ORDEN_FISICO', source: 'column.position' }, { header: 'CAMPO_FISICO', source: 'column.physicalName' },
    { header: 'PK', source: 'column.isPrimaryKey' }, { header: 'CLASIF_DATO', source: 'column.udp:Clasificacion del Dato' },
    { header: 'PARTICION', source: 'column.udp:Particion' }, { header: 'PARENT_DOMAIN', source: 'column.parentDomain' },
    { header: 'UDP_CLASIFICACION_DEL_DATO', source: 'table.udp:Clasificacion del Dato' },
    { header: 'UDP_DOMINIO_PRINCIPAL', source: 'table.udp:Dominio Principal' },
  ],
};

describe('templateRows', () => {
  it('una fila por columna: PK primero, posición 1-based, X en PK, UDP de tabla y de columna', () => {
    const rows = templateRows(QA, [T], COLS);
    expect(rows.map((r) => [r.ORDEN_FISICO, r.CAMPO_FISICO, r.PK])).toEqual([
      [1, 'CODCLAVEPARTYCLI', 'X'], [2, 'CODMES', 'X'], [3, 'TIPRANGOPOBLACION', '']]);
    expect(rows[1]).toMatchObject({
      DATABASE: 'stg_pagos', TABLA_FISICA: 'HM_PAGOCLIENTEDEUDOR', PARTICION: 'PART_02', PARENT_DOMAIN: 'CodMes',
      UDP_CLASIFICACION_DEL_DATO: 'No DAC', UDP_DOMINIO_PRINCIPAL: 'Soluciones de Pago',
    });
    expect(Object.keys(rows[0])).toEqual(QA.columns.map((c) => c.header));
  });
  it('un dato desconocido o un UDP sin valor quedan vacíos (no rompe)', () => {
    const rows = templateRows({ columns: [{ header: 'A', source: 'column.udp:No Existe' }, { header: 'B', source: 'column.nope' }] }, [T], COLS);
    expect(rows[0]).toEqual({ A: '', B: '' });
  });
  it('la posición se reinicia en cada tabla', () => {
    const t2: ReportTableRow = { ...T, id: 't2', physicalName: 'A_PRIMERA' };
    const rows = templateRows({ columns: [{ header: 'T', source: 'table.physicalName' }, { header: 'P', source: 'column.position' }] },
      [T, t2], [...COLS, col({ tableId: 't2', physicalName: 'Z', ordinal: 0 })]);
    expect(rows.map((r) => [r.T, r.P])).toEqual([
      ['A_PRIMERA', 1], ['HM_PAGOCLIENTEDEUDOR', 1], ['HM_PAGOCLIENTEDEUDOR', 2], ['HM_PAGOCLIENTEDEUDOR', 3]]);
  });
});

describe('editor de plantillas', () => {
  const defs = [
    { name: 'Clasificacion del Dato', level: 'column', view: 'physical' },
    { name: 'Clasificacion del Dato', level: 'column', view: 'logical' },
    { name: 'Dominio Principal', level: 'table', view: 'physical' },
  ];
  it('opciones agrupadas, con los UDP por su nombre legible', () => {
    const groups = sourceOptions(defs);
    expect(groups.map((g) => g.group)).toEqual(['Table fields', 'Table UDPs', 'Column fields', 'Column UDPs']);
    expect(groups[3].options.map((o) => o.value)).toEqual([
      'column.udp:Clasificacion del Dato', 'column.udp:Clasificacion del Dato (Logical)']);
    expect(isKnownSource('table.udp:Dominio Principal', groups)).toBe(true);
    expect(isKnownSource('column.udp:Renombrado', groups)).toBe(false);
    expect(sourceLabel('column.udp:Particion')).toBe('Column UDP · Particion');
    expect(sourceLabel('column.position')).toBe('Column position (1…, PK first)');
  });
  it('valida como el backend', () => {
    expect(templateProblems({ name: ' ', sheetName: 'A/B', columns: [
      { header: 'X', source: 'table.schema' }, { header: 'x', source: 'table.schema' }] })).toEqual([
      'Give the template a name.',
      "The sheet name must be 1–31 characters, without : \\ / ? * [ ], not start or end with an apostrophe, and not be History.",
      "The header 'x' is repeated."]);
    expect(templateProblems({ name: 'QA', sheetName: 'QA_MODELO', columns: [{ header: 'A', source: 'table.schema' }] })).toEqual([]);
    // Lo que Excel (y el escritor xlsx) no admite como nombre de hoja.
    for (const sheetName of ['History', 'history', "'Datos", "Datos'"]) {
      expect(templateProblems({ name: 'QA', sheetName, columns: [{ header: 'A', source: 'table.schema' }] })).toHaveLength(1);
    }
    expect(templateProblems({ name: 'QA', sheetName: "Datos d'Hoja", columns: [{ header: 'A', source: 'table.schema' }] })).toEqual([]);
  });
  it('mover columnas y nombre de archivo', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a'], 0, -1)).toEqual(['a']);
    expect(templateFileName({ name: 'QA_MODELO' }, new Date(2026, 8, 25, 12, 0, 0))).toBe('QA_MODELO-2026-09-25.xlsx');
  });
});

describe('nombre del archivo', () => {
  const QA = 'QA_REPORTE_{yyyy}-{MM}-{dd} {HH}{mm}{ss}';
  it('resuelve los marcadores con la hora local (también a las 23:59)', () => {
    expect(templateFileName({ name: 'QA_MODELO', fileName: QA }, new Date(2026, 8, 28, 15, 30, 45)))
      .toBe('QA_REPORTE_2026-09-28 153045.xlsx');
    expect(templateFileName({ name: 'QA_MODELO', fileName: QA }, new Date(2026, 8, 28, 23, 59, 59)))
      .toBe('QA_REPORTE_2026-09-28 235959.xlsx');
    expect(templateFileName({ name: 'X', fileName: 'Mes {MM}.xlsx' }, new Date(2026, 0, 5, 1, 2, 3))).toBe('Mes 01.xlsx');
  });
  it('sin nombre propio o con uno inválido cae a <plantilla>-<fecha local>', () => {
    expect(templateFileName({ name: 'Mi plantilla', fileName: null }, new Date(2026, 8, 28, 23, 59, 0))).toBe('Mi_plantilla-2026-09-28.xlsx');
    expect(templateFileName({ name: 'QA', fileName: 'A/B {yyyy}' }, new Date(2026, 8, 28))).toBe('QA-2026-09-28.xlsx');
  });
  it('limpia y valida como el backend', () => {
    expect(cleanFileName('  QA {yyyy}.XLSX ')).toBe('QA {yyyy}');
    expect(cleanFileName('.xlsx')).toBeNull();
    expect(cleanFileName('   ')).toBeNull();
    expect(fileNameProblem(null)).toBeNull();
    expect(fileNameProblem(QA)).toBeNull();
    expect(fileNameProblem('A/B')).toBe('The file name can\'t contain \\ / : * ? " < > |.');
    expect(fileNameProblem('x'.repeat(121))).toBe('The file name can have at most 120 characters.');
    expect(fileNameProblem('QA_{fecha}')).toBe('Unknown placeholder {fecha} in the file name — use {yyyy} {MM} {dd} {HH} {mm} {ss}.');
    expect(fileNameProblem('QA_{yyyy')).toBe('Unbalanced braces in the file name — placeholders look like {yyyy}.');
    expect(templateProblems({ name: 'QA', sheetName: 'QA', fileName: 'A:B', columns: [{ header: 'A', source: 'table.schema' }] }))
      .toEqual(['The file name can\'t contain \\ / : * ? " < > |.']);
  });
  // El backend cuenta el largo con `len()` de Python (code points); contar
  // unidades UTF-16 haría que un emoji valga 2.
  it('el largo se cuenta en caracteres (code points), como el backend', () => {
    expect(fileNameProblem('😀'.repeat(61))).toBeNull();                 // 61 caracteres, 122 unidades UTF-16
    expect(fileNameProblem(`${'😀'.repeat(60)}${'x'.repeat(60)}`)).toBeNull();   // justo 120
    expect(fileNameProblem('😀'.repeat(121))).toBe('The file name can have at most 120 characters.');
    expect(fileNameProblem('x'.repeat(120))).toBeNull();
  });
});

describe('campos Subject / Diagram / Space', () => {
  it('salen en el grupo de tabla y se llenan desde la fila (separados por coma)', () => {
    const groups = sourceOptions([]);
    expect(groups[0].options.slice(0, 3).map((o) => o.value)).toEqual(['table.space', 'table.subject', 'table.diagram']);
    const t: ReportTableRow = { ...T, spaces: ['COMERCIAL'], subjectAreas: ['Despriorizado', 'Riesgos'], diagrams: ['D1'] };
    const rows = templateRows({ columns: [{ header: 'SPACE', source: 'table.space' }, { header: 'SUBJECT', source: 'table.subject' },
      { header: 'DIAGRAMA', source: 'table.diagram' }] }, [t], [COLS[0]]);
    expect(rows[0]).toEqual({ SPACE: 'COMERCIAL', SUBJECT: 'Despriorizado, Riesgos', DIAGRAMA: 'D1' });
    expect(templateRows({ columns: [{ header: 'S', source: 'table.space' }] }, [T], [COLS[0]])[0]).toEqual({ S: '' });
  });
});

describe('filtros de la plantilla', () => {
  const COLUMNS = [{ header: 'CAMPO', source: 'column.physicalName' }, { header: 'POS', source: 'column.position' }];
  const rowsWith = (...filters: SheetTemplateFilter[]) =>
    templateRows({ columns: COLUMNS, filters }, [T], COLS).map((r) => [r.CAMPO, r.POS]);

  it('sin filtros salen todas las filas', () => {
    expect(rowsWith()).toEqual([['CODCLAVEPARTYCLI', 1], ['CODMES', 2], ['TIPRANGOPOBLACION', 3]]);
    expect(templateRows({ columns: COLUMNS }, [T], COLS)).toHaveLength(3);
  });
  it('sale la fila que cumple todos; la posición es la real en la tabla (no se renumera)', () => {
    expect(rowsWith({ source: 'column.isPrimaryKey', op: 'isEmpty' })).toEqual([['TIPRANGOPOBLACION', 3]]);
    expect(rowsWith({ source: 'column.isPrimaryKey', op: 'isNotEmpty' },
      { source: 'column.parentDomain', op: 'startsWith', value: 'cod' })).toEqual([['CODCLAVEPARTYCLI', 1], ['CODMES', 2]]);
    expect(rowsWith({ source: 'column.isPrimaryKey', op: 'isNotEmpty' },
      { source: 'column.udp:Particion', op: 'isNotEmpty' })).toEqual([['CODMES', 2]]);
  });
  it('cada operador, sin distinguir mayúsculas ni espacios al borde', () => {
    expect(rowsWith({ source: 'column.physicalName', op: 'is', value: ' codmes ' })).toEqual([['CODMES', 2]]);
    expect(rowsWith({ source: 'column.physicalName', op: 'isNot', value: 'CODMES' })).toHaveLength(2);
    expect(rowsWith({ source: 'column.physicalName', op: 'isOneOf', values: ['codmes', 'TIPRANGOPOBLACION'] }))
      .toEqual([['CODMES', 2], ['TIPRANGOPOBLACION', 3]]);
    expect(rowsWith({ source: 'column.physicalName', op: 'contains', value: 'clave' })).toEqual([['CODCLAVEPARTYCLI', 1]]);
    expect(rowsWith({ source: 'column.physicalName', op: 'notContains', value: 'cod' })).toEqual([['TIPRANGOPOBLACION', 3]]);
    expect(rowsWith({ source: 'column.udp:Clasificacion del Dato', op: 'is', value: 'no dac' })).toHaveLength(2);
    expect(rowsWith({ source: 'table.udp:Dominio Principal', op: 'contains', value: 'pago' })).toHaveLength(3);
    expect(rowsWith({ source: 'column.position', op: 'is', value: '2' })).toEqual([['CODMES', 2]]);
  });
  it('un dato con varios valores (canvases, carpetas) cumple si alguno cumple', () => {
    const t: ReportTableRow = { ...T, diagrams: ['Canvas Uno', 'Canvas Dos'] };
    const rows = (f: SheetTemplateFilter) => templateRows({ columns: COLUMNS, filters: [f] }, [t], COLS).length;
    expect(rows({ source: 'table.diagram', op: 'is', value: 'canvas dos' })).toBe(3);
    expect(rows({ source: 'table.diagram', op: 'isNot', value: 'canvas dos' })).toBe(0);
    expect(rows({ source: 'table.diagram', op: 'isOneOf', values: ['X', 'Canvas Uno'] })).toBe(3);
    expect(rows({ source: 'table.diagram', op: 'startsWith', value: 'canvas d' })).toBe(3);
    expect(rows({ source: 'table.space', op: 'isEmpty' })).toBe(3);                     // sin espacios
  });
  it('un dato que ya no existe (UDP borrado) se ve vacío', () => {
    expect(rowsWith({ source: 'column.udp:No Existe', op: 'isEmpty' })).toHaveLength(3);
    expect(rowsWith({ source: 'column.udp:No Existe', op: 'is', value: 'x' })).toEqual([]);
  });
  it('sin filtros siempre deja pasar', () => {
    expect(compileFilters(undefined)(COLS[0], T, 1)).toBe(true);
    expect(compileFilters([])(COLS[0], T, 1)).toBe(true);
  });
  it('los filtros se preparan una vez para todas las filas', () => {
    let reads = 0;
    const filter = { source: 'column.physicalName', op: 'isOneOf' as const, get values() { reads += 1; return ['codmes']; } };
    const many = Array.from({ length: 50 }, (_, i) => ({ ...COLS[1], id: `c${i}`, physicalName: i ? `X${i}` : 'CODMES' }));
    expect(templateRows({ columns: COLUMNS, filters: [filter] }, [T], many)).toHaveLength(1);
    expect(reads).toBe(1);
  });
  it('operadores por dato: las banderas solo «is marked» / «is not marked»', () => {
    expect(filterOps('column.isPrimaryKey')).toEqual([{ value: 'isNotEmpty', label: 'is marked' }, { value: 'isEmpty', label: 'is not marked' }]);
    expect(filterOps('column.dataType').map((o) => o.label)).toEqual(
      ['is', 'is not', 'is one of', 'contains', 'does not contain', 'starts with', 'is empty', 'is not empty']);
  });
  it('«is one of» se escribe separado por comas', () => {
    expect(splitValues(' STRING, varchar ,, ')).toEqual(['STRING', 'varchar']);
    // La coma dentro de paréntesis es parte del valor (tipos como DECIMAL(10,2)).
    expect(splitValues('DECIMAL(10,2), DECIMAL(18, 2) ,STRING')).toEqual(['DECIMAL(10,2)', 'DECIMAL(18, 2)', 'STRING']);
    // …y dentro de <> (tipos complejos de Databricks).
    expect(splitValues('MAP<STRING, INT>, STRUCT<id: INT, name: STRING>, ARRAY<DECIMAL(10,2)>'))
      .toEqual(['MAP<STRING, INT>', 'STRUCT<id: INT, name: STRING>', 'ARRAY<DECIMAL(10,2)>']);
    // Un ( o < sin cerrar no se traga el resto: se corta en todas las comas.
    expect(splitValues('DECIMAL(10, 2, STRING, INT')).toEqual(['DECIMAL(10', '2', 'STRING', 'INT']);
    expect(splitValues(')(, a')).toEqual([')(', 'a']);
    expect(splitValues('a<b, c')).toEqual(['a<b', 'c']);
    expect(splitValues('a), b > c, d')).toEqual(['a)', 'b > c', 'd']);
    expect(toFilterBody(toFilterDraft({ source: 'column.dataType', op: 'isOneOf', values: ['DECIMAL(10,2)', 'INT'] })))
      .toEqual({ source: 'column.dataType', op: 'isOneOf', values: ['DECIMAL(10,2)', 'INT'] });
    expect(toFilterBody({ source: 'column.dataType', op: 'isOneOf', text: 'STRING, VARCHAR' }))
      .toEqual({ source: 'column.dataType', op: 'isOneOf', values: ['STRING', 'VARCHAR'] });
    expect(toFilterBody({ source: 'column.dataType', op: 'is', text: ' DATE ' })).toEqual({ source: 'column.dataType', op: 'is', value: 'DATE' });
    expect(toFilterBody({ source: 'column.isPrimaryKey', op: 'isNotEmpty', text: 'x' })).toEqual({ source: 'column.isPrimaryKey', op: 'isNotEmpty' });
    expect(toFilterDraft({ source: 'column.dataType', op: 'isOneOf', values: ['STRING', 'VARCHAR'] }))
      .toEqual({ source: 'column.dataType', op: 'isOneOf', text: 'STRING, VARCHAR' });
    expect(toFilterDraft({ source: 'column.dataType', op: 'is', value: 'DATE' })).toEqual({ source: 'column.dataType', op: 'is', text: 'DATE' });
  });
  it('valida como el backend', () => {
    const base = { name: 'X', sheetName: 'S', columns: [{ header: 'A', source: 'column.physicalName' }] };
    expect(templateProblems({ ...base, filters: [{ source: 'column.dataType', op: 'is', value: ' ' }] }))
      .toEqual(['Filter 1 needs a value.']);
    expect(templateProblems({ ...base, filters: [{ source: 'column.dataType', op: 'isOneOf', values: [] }] }))
      .toEqual(['Filter 1 needs at least one value.']);
    expect(templateProblems({ ...base, filters: [{ source: 'column.dataType', op: 'is', value: 'x'.repeat(201) }] }))
      .toEqual(['A filter value can have at most 200 characters.']);
    expect(templateProblems({ ...base, filters: Array.from({ length: 21 }, () => ({ source: 'column.dataType', op: 'isEmpty' as const })) }))
      .toEqual(['A template can have at most 20 filters.']);
    expect(templateProblems({ ...base, filters: [{ source: 'column.isPrimaryKey', op: 'isNotEmpty' }] })).toEqual([]);
    // El tope se cuenta en caracteres (code points), como `len()` del backend: un emoji = 1.
    expect(templateProblems({ ...base, filters: [{ source: 'column.dataType', op: 'is', value: '😀'.repeat(200) }] })).toEqual([]);
    expect(templateProblems({ ...base, filters: [{ source: 'column.dataType', op: 'isOneOf', values: ['😀'.repeat(201)] }] }))
      .toEqual(['A filter value can have at most 200 characters.']);
    // El backend admite hasta 50 valores en «is one of» (validarlo acá evita un 422 ilegible).
    expect(templateProblems({ ...base, filters: [{ source: 'column.dataType', op: 'isOneOf', values: Array.from({ length: 50 }, (_, i) => `T${i}`) }] }))
      .toEqual([]);
    expect(templateProblems({ ...base, filters: [{ source: 'column.dataType', op: 'isOneOf', values: Array.from({ length: 51 }, (_, i) => `T${i}`) }] }))
      .toEqual(['Filter 1 can have at most 50 values.']);
  });
});
