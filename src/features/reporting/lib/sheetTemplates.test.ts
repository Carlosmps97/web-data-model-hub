import { describe, expect, it } from 'vitest';
import type { ReportColumnRow, ReportTableRow } from '@/services/reporting.service';
import {
  canEditTemplate, cleanFileName, fileNameProblem, isKnownSource, moveItem, sourceLabel, sourceOptions, templateFileName,
  templateProblems, templateRows,
} from './sheetTemplates';

describe('canEditTemplate (final review #1: dueño + compartida, como los saved reports)', () => {
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
  id: 't1', physicalName: 'HM_PAGOCLIENTEDEUDOR', logicalName: 'hm pago', schema: 'bcp_ddv_sdp',
  subjectAreas: [], columnCount: 3, relationshipCount: 0, projects: ['DDV'], description: '',
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

describe('templateRows (doc 95 D11)', () => {
  it('una fila por columna: PK primero, posición 1-based, X en PK, UDP de tabla y de columna', () => {
    const rows = templateRows(QA, [T], COLS);
    expect(rows.map((r) => [r.ORDEN_FISICO, r.CAMPO_FISICO, r.PK])).toEqual([
      [1, 'CODCLAVEPARTYCLI', 'X'], [2, 'CODMES', 'X'], [3, 'TIPRANGOPOBLACION', '']]);
    expect(rows[1]).toMatchObject({
      DATABASE: 'bcp_ddv_sdp', TABLA_FISICA: 'HM_PAGOCLIENTEDEUDOR', PARTICION: 'PART_02', PARENT_DOMAIN: 'CodMes',
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
      'Give the template a name.', 'The sheet name must be 1–31 characters, without : \\ / ? * [ ].',
      "The header 'x' is repeated."]);
    expect(templateProblems({ name: 'QA', sheetName: 'QA_MODELO', columns: [{ header: 'A', source: 'table.schema' }] })).toEqual([]);
  });
  it('mover columnas y nombre de archivo', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a'], 0, -1)).toEqual(['a']);
    expect(templateFileName({ name: 'QA_MODELO' }, new Date(2026, 8, 25, 12, 0, 0))).toBe('QA_MODELO-2026-09-25.xlsx');
  });
});

describe('nombre del archivo (doc 102)', () => {
  const QA = 'QA_REPORTE_{yyyy}-{MM}-{dd} {HH}{mm}{ss}';
  it('resuelve los marcadores con la hora LOCAL (también a las 23:59)', () => {
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
  // Doc 105 (B7): el backend cuenta el largo con `len()` de Python (code
  // points); el front contaba unidades UTF-16 y un emoji valía 2.
  it('el largo se cuenta en caracteres (code points), como el backend', () => {
    expect(fileNameProblem('😀'.repeat(61))).toBeNull();                 // 61 caracteres, 122 unidades UTF-16
    expect(fileNameProblem(`${'😀'.repeat(60)}${'x'.repeat(60)}`)).toBeNull();   // justo 120
    expect(fileNameProblem('😀'.repeat(121))).toBe('The file name can have at most 120 characters.');
    expect(fileNameProblem('x'.repeat(120))).toBeNull();
  });
});

describe('campos Subject / Diagram / Space (doc 102)', () => {
  it('salen en el grupo de tabla y se llenan desde la fila (separados por coma)', () => {
    const groups = sourceOptions([]);
    expect(groups[0].options.slice(0, 3).map((o) => o.value)).toEqual(['table.space', 'table.subject', 'table.diagram']);
    const t: ReportTableRow = { ...T, spaces: ['CPYBCA'], subjectAreas: ['Despriorizado', 'Riesgos'], diagrams: ['D1'] };
    const rows = templateRows({ columns: [{ header: 'SPACE', source: 'table.space' }, { header: 'SUBJECT', source: 'table.subject' },
      { header: 'DIAGRAMA', source: 'table.diagram' }] }, [t], [COLS[0]]);
    expect(rows[0]).toEqual({ SPACE: 'CPYBCA', SUBJECT: 'Despriorizado, Riesgos', DIAGRAMA: 'D1' });
    expect(templateRows({ columns: [{ header: 'S', source: 'table.space' }] }, [T], [COLS[0]])[0]).toEqual({ S: '' });
  });
});
