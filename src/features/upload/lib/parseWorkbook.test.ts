// Lectura cruda del .xlsx (doc 78 §3.2): todas las hojas como grillas con el
// nº de fila Excel, sin filas vacías ni celdas finales vacías; celdas como
// texto (saltos de línea incluidos). El significado lo pone el backend según
// el perfil — acá NO hay semántica.
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { findSheet, headerKey, headersAt, readWorkbook, sheetKey, sheetRowCount } from './parseWorkbook';

type Aoa = (string | number | null)[][];

function workbook(sheets: Record<string, Aoa>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('readWorkbook', () => {
  it('emits every sheet as a raw grid with Excel row numbers and no empty rows', () => {
    const out = readWorkbook(workbook({
      Cargar_Tablas: [[], [], [], ['', '(help)'], ['', 'SUBJECT', 'TABLA_LOGICO'], [], ['', 'S1', 'Cliente', '']],
      Otra: [['x']],
    }), 'p.xlsx');
    expect(out.fileName).toBe('p.xlsx');
    expect(out.sheets.map((s) => s.name)).toEqual(['Cargar_Tablas', 'Otra']);
    const t = out.sheets[0];
    expect(t.rows.map((r) => r.row)).toEqual([4, 5, 7]);
    expect(t.rows[1].cells).toEqual(['', 'SUBJECT', 'TABLA_LOGICO']);
    expect(t.rows[2].cells).toEqual(['', 'S1', 'Cliente']);        // trailing empty cells trimmed
  });

  it('keeps numbers as text and preserves line breaks inside cells', () => {
    const out = readWorkbook(workbook({ T: [['TABLA_LOGICO', 'DEF_TABLA'], [2024, 'línea 1\nlínea 2 con ñ']] }), 'x.xlsx');
    expect(out.sheets[0].rows[1].cells).toEqual(['2024', 'línea 1\nlínea 2 con ñ']);
  });

  it('editor helpers: sheet by name (no case/accents), headers of a row, data row count', () => {
    const out = readWorkbook(workbook({ 'Cargar Tablás': [['', 'A', 'B'], ['', '1', '2'], ['', '3', '']] }), 'p.xlsx');
    const s = findSheet(out.sheets, 'cargar tablas')!;
    expect(s.name).toBe('Cargar Tablás');
    expect(findSheet(out.sheets, 'otra')).toBeUndefined();
    expect(headersAt(s, 1)).toEqual(['A', 'B']);
    expect(headersAt(s, 9)).toEqual([]);
    expect(sheetRowCount(s, 1)).toBe(2);
    expect(sheetRowCount(s, null)).toBe(3);
    expect(headerKey('tabla lógico')).toBe('TABLA_LOGICO');
    expect(headerKey('UDP Campo Cross')).toBe(headerKey('UDP_Campo_Cross'));
    expect(sheetKey('  Cargar   Tablás ')).toBe('cargar tablas');
  });
});
