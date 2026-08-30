// Parseo del .xlsx de la carga masiva (doc 55 §3.1 / §8): hojas por nombre
// (sin caso ni tildes), fila de cabecera detectada por TABLA_LOGICO, celdas
// como texto tal cual (saltos de línea incluidos), filas vacías fuera. El
// significado de cada columna lo pone el backend — acá NO hay semántica.
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseWorkbook } from './parseWorkbook';

type Aoa = (string | number | null)[][];

function workbook(sheets: Record<string, Aoa>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const HELP = ['(OPCIONAL)', 'Tamaño (Maximo 80)\n(OBLIGATORIO)', '(OPCIONAL)'];

describe('parseWorkbook', () => {
  it('detects the header row by TABLA_LOGICO and numbers data rows as in Excel', () => {
    const buf = workbook({
      Tablas: [HELP, ['PROJECT', 'TABLA_LOGICO', 'DEF_TABLA'], ['P1', 'Cliente', 'def'], ['P1', 'Cuenta', '']],
    });
    const out = parseWorkbook(buf, 'carga.xlsx');
    expect(out.problems).toEqual([]);
    expect(out.found).toEqual({ tables: true, columns: false });
    expect(out.counts).toEqual({ tables: 2, columns: 0 });
    expect(out.body.fileName).toBe('carga.xlsx');
    expect(out.body.sheets.tables?.headers).toEqual(['PROJECT', 'TABLA_LOGICO', 'DEF_TABLA']);
    expect(out.body.sheets.tables?.rows).toEqual([
      { row: 3, cells: { PROJECT: 'P1', TABLA_LOGICO: 'Cliente', DEF_TABLA: 'def' } },
      { row: 4, cells: { PROJECT: 'P1', TABLA_LOGICO: 'Cuenta', DEF_TABLA: '' } },
    ]);
    expect(out.body.sheets.columns).toBeUndefined();
  });

  it('matches sheet names without case or accents and parses both sheets', () => {
    const buf = workbook({
      tablas: [['TABLA_LOGICO'], ['A']],
      ATRIBUTÓS: [['TABLA_LOGICO', 'CAMPO_LOGICO', 'PK'], ['A', 'id', 'X']],
    });
    const out = parseWorkbook(buf, 'x.xlsx');
    expect(out.found).toEqual({ tables: true, columns: true });
    expect(out.body.sheets.columns?.rows).toEqual([{ row: 2, cells: { TABLA_LOGICO: 'A', CAMPO_LOGICO: 'id', PK: 'X' } }]);
  });

  it('keeps numbers as text and preserves line breaks inside cells', () => {
    const buf = workbook({ Tablas: [['TABLA_LOGICO', 'DEF_TABLA'], [2024, 'línea 1\nlínea 2 con ñ']] });
    const row = parseWorkbook(buf, 'x.xlsx').body.sheets.tables?.rows[0];
    expect(row?.cells).toEqual({ TABLA_LOGICO: '2024', DEF_TABLA: 'línea 1\nlínea 2 con ñ' });
  });

  it('skips fully empty rows and blank header cells', () => {
    const buf = workbook({
      Tablas: [['TABLA_LOGICO', '', 'DEF_TABLA'], ['A', '', ''], ['', '', ''], [null, null, null], ['B', 'x', 'd']],
    });
    const sheet = parseWorkbook(buf, 'x.xlsx').body.sheets.tables;
    expect(sheet?.headers).toEqual(['TABLA_LOGICO', 'DEF_TABLA']);
    expect(sheet?.rows.map((r) => r.row)).toEqual([2, 5]);
    expect(sheet?.rows[1].cells).toEqual({ TABLA_LOGICO: 'B', DEF_TABLA: 'd' });
  });

  it('reports a problem when no known sheet exists', () => {
    const out = parseWorkbook(workbook({ Otra: [['x'], ['y']] }), 'x.xlsx');
    expect(out.found).toEqual({ tables: false, columns: false });
    expect(out.body.sheets).toEqual({});
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]).toMatch(/Tablas.*Atributos/);
  });

  it('reports a problem when a sheet has no TABLA_LOGICO header row', () => {
    const out = parseWorkbook(workbook({ Tablas: [['PROJECT', 'NOMBRE'], ['P', 'x']] }), 'x.xlsx');
    expect(out.found.tables).toBe(true);
    expect(out.body.sheets.tables).toBeUndefined();
    expect(out.problems[0]).toMatch(/Tablas.*TABLA_LOGICO/);
  });

  it('accepts a header row written with spaces and lower case', () => {
    const out = parseWorkbook(workbook({ Tablas: [['tabla lógico', 'esquema'], ['A', 'ddv']] }), 'x.xlsx');
    expect(out.body.sheets.tables?.rows[0].cells).toEqual({ 'tabla lógico': 'A', esquema: 'ddv' });
  });
});
