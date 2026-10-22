// Lectura cruda del .xlsx: todas las hojas como grillas con el nº de fila
// Excel, sin filas vacías ni celdas finales vacías; celdas como texto (saltos
// de línea incluidos). El significado lo pone el backend según el perfil: aquí
// no hay semántica.
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { findSheet, headerKey, headersAt, readSheet, readWorkbook, sheetKey, sheetRowCount } from './parseWorkbook';

type Aoa = (string | number | null)[][];

function workbook(sheets: Record<string, Aoa>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('readWorkbook', () => {
  it('emite cada hoja como una grilla cruda con los números de fila de Excel y sin filas vacías', () => {
    const out = readWorkbook(workbook({
      Cargar_Tablas: [[], [], [], ['', '(help)'], ['', 'SUBJECT', 'TABLA_LOGICO'], [], ['', 'S1', 'Cliente', '']],
      Otra: [['x']],
    }), 'p.xlsx');
    expect(out.fileName).toBe('p.xlsx');
    expect(out.sheets.map((s) => s.name)).toEqual(['Cargar_Tablas', 'Otra']);
    const t = out.sheets[0];
    expect(t.rows.map((r) => r.row)).toEqual([4, 5, 7]);
    expect(t.rows[1].cells).toEqual(['', 'SUBJECT', 'TABLA_LOGICO']);
    expect(t.rows[2].cells).toEqual(['', 'S1', 'Cliente']);        // sin las celdas vacías del final
  });

  it('conserva los números como texto y los saltos de línea dentro de las celdas', () => {
    const out = readWorkbook(workbook({ T: [['TABLA_LOGICO', 'DEF_TABLA'], [2024, 'línea 1\nlínea 2 con ñ']] }), 'x.xlsx');
    expect(out.sheets[0].rows[1].cells).toEqual(['2024', 'línea 1\nlínea 2 con ñ']);
  });

  it('helpers del editor: hoja por nombre (sin caso ni tildes), cabeceras de una fila, conteo de filas de datos', () => {
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

describe('texto que la base no puede guardar', () => {
  it('quita el NUL (SheetJS decodifica `_x0000_` a U+0000) y sustituye un surrogate suelto', () => {
    const ws = XLSX.utils.aoa_to_sheet([['TABLA_LOGICO', 'DESC'], ['Clie\u0000nte', 'X\uD800Y'], ['ok', '😀']]);
    const sheet = readSheet('Tablas', ws);
    expect(sheet.rows[1].cells).toEqual(['Cliente', 'X�Y']);
    expect(sheet.rows[2].cells).toEqual(['ok', '😀']);          // un par válido (emoji) queda igual
  });
});

describe('nombres de hoja y de archivo que la base no puede guardar', () => {
  it('SheetJS decodifica `_x0000_` también en el nombre de la hoja: se limpia igual que las celdas', () => {
    const ws = XLSX.utils.aoa_to_sheet([['x']]);
    expect(readSheet('Hoja\u00001', ws).name).toBe('Hoja1');
    expect(readSheet('Mal\uD800', ws).name).toBe('Mal\uFFFD');
  });

  it('readWorkbook limpia el nombre de la hoja (y la sigue leyendo) y el del archivo', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['A'], ['1']]), 'Hoja\u00001');
    const out = readWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, 'carga\u0000.xlsx');
    expect(out.fileName).toBe('carga.xlsx');
    expect(out.sheets.map((x) => x.name)).toEqual(['Hoja1']);
    expect(out.sheets[0].rows).toEqual([{ row: 1, cells: ['A'] }, { row: 2, cells: ['1'] }]);
  });
});

// Toda celda numérica con formato de fecha viaja como YYYY-MM-DD (con hora, si
// la tiene), no con el formato local de la celda («1/2/24», «02-ene-24»): el
// panel de un UDP de fecha usa YYYY-MM-DD y el backend rechaza otro formato.
describe('celdas de fecha de Excel', () => {
  function dated(cells: Record<string, XLSX.CellObject>): ArrayBuffer {
    const ws = XLSX.utils.aoa_to_sheet([['FECHA']]);
    Object.assign(ws, cells);
    ws['!ref'] = 'A1:A6';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  }

  it('fecha con el formato por defecto, uno propio o con nombre del mes → YYYY-MM-DD', () => {
    const out = readWorkbook(dated({
      A2: { t: 'n', v: 45293, z: 'm/d/yy' },
      A3: { t: 'n', v: 45293, z: 'dd/mm/yyyy' },
      A4: { t: 'n', v: 45293, z: 'd-mmm-yy' },
      A5: { t: 'n', v: 45293.5729166667, z: 'm/d/yy h:mm' },
      A6: { t: 'n', v: 12.5, z: '0.0' },
    }), 'f.xlsx');
    expect(out.sheets[0].rows.map((r) => r.cells[0])).toEqual(['FECHA', '2024-01-02', '2024-01-02', '2024-01-02', '2024-01-02 13:45', '12.5']);
  });
});

// (1) Con hora pero un formato que solo muestra la fecha (típico de =NOW()),
// Excel muestra la fecha: viaja solo la fecha (un UDP de fecha la acepta);
// (2) en un libro con sistema de fechas 1904 la serie se lee con ese sistema
// (leída como del sistema 1900, las fechas se correrían 4 años).
describe('celdas de fecha: lo que muestra Excel', () => {
  it('la hora solo viaja si el formato la muestra', () => {
    const ws = XLSX.utils.aoa_to_sheet([['FECHA']]);
    Object.assign(ws, {
      A2: { t: 'n', v: 45293.5729166667, z: 'dd/mm/yyyy' },
      A3: { t: 'n', v: 45293.5729166667, z: '[$-409]m/d/yy h:mm AM/PM;@' },
      A4: { t: 'n', v: 45293.5729166667, z: 'yyyy-mm-dd hh:mm:ss' },
      A5: { t: 'n', v: 45293.5, z: '"Fecha:" dd/mm/yyyy' },
      A6: { t: 'n', v: 45293.5, z: '[$-es-PE]dd/mm/yyyy' },
    });
    ws['!ref'] = 'A1:A6';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const out = readWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, 'f.xlsx');
    expect(out.sheets[0].rows.map((r) => r.cells[0])).toEqual(['FECHA', '2024-01-02', '2024-01-02 13:45', '2024-01-02 13:45', '2024-01-02', '2024-01-02']);
  });

  it('un libro con sistema de fechas 1904 no corre las fechas', () => {
    const ws = XLSX.utils.aoa_to_sheet([['FECHA']]);
    Object.assign(ws, { A2: { t: 'n', v: 45293, z: 'yyyy-mm-dd' } });
    ws['!ref'] = 'A1:A2';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    wb.Workbook = { WBProps: { date1904: true } };
    const out = readWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, 'f.xlsx');
    expect(out.sheets[0].rows[1].cells[0]).toBe('2028-01-03');     // 45293 + 1462 días
  });
});

// Solo es fecha un formato con parte de fecha (año o día). Una celda de solo
// hora o una duración viaja como la muestra Excel, no como una fecha de 1900
// inventada («1900-01-00 08:30»).
describe('horas y duraciones no son fechas', () => {
  it('solo hora, duración y «general» viajan como los muestra Excel', () => {
    const ws = XLSX.utils.aoa_to_sheet([['X']]);
    Object.assign(ws, {
      A2: { t: 'n', v: 0.3541666666666667, z: 'h:mm' },
      A3: { t: 'n', v: 0.75, z: 'hh:mm:ss' },
      A4: { t: 'n', v: 1.5, z: '[h]:mm' },
      A5: { t: 'n', v: 10, z: 'general' },
      A6: { t: 'n', v: 0.3541666666666667, z: '[Red]h:mm' },      // la «d» del corchete no es un día
    });
    ws['!ref'] = 'A1:A6';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const out = readWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, 'f.xlsx');
    expect(out.sheets[0].rows.map((r) => r.cells[0])).toEqual(['X', '8:30', '18:00:00', '36:00', '10', '8:30']);
  });
});

// Los formatos de fecha de solo mes («mmmm», «mmm», «[$-409]mmmm;@») son
// fechas (Excel los ofrece en la categoría Fecha).
describe('formatos de fecha de solo mes', () => {
  it('viajan como fecha; los de hora siguen siendo texto', () => {
    const ws = XLSX.utils.aoa_to_sheet([['X']]);
    Object.assign(ws, {
      A2: { t: 'n', v: 45306, z: 'mmmm' },
      A3: { t: 'n', v: 45306, z: 'mmm' },
      A4: { t: 'n', v: 45306, z: '[$-409]mmmm;@' },
      A5: { t: 'n', v: 0.3541666666666667, z: 'mm:ss' },
    });
    ws['!ref'] = 'A1:A5';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const out = readWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, 'f.xlsx');
    expect(out.sheets[0].rows.map((r) => r.cells[0])).toEqual(['X', '2024-01-15', '2024-01-15', '2024-01-15', '30:00']);
  });
});
