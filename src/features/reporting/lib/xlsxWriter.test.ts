// Escritor de Excel en flujo: límites de Excel (32 767 caracteres por celda,
// 1 048 576 filas por hoja) sin perder datos, y un libro que otro lector (SheetJS)
// lee igual a lo que se escribió.
import { strFromU8, unzipSync } from 'fflate';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import type { SheetRow } from './reportRows';
import {
  buildXlsx, EXCEL_CELL_MAX, EXCEL_MAX_COLUMNS, planSheets, sheetName, splitCellText, type WorkbookSheet,
} from './xlsxWriter';

const sheet = (name: string, rows: SheetRow[], header?: string[]): WorkbookSheet =>
  ({ name, header, count: rows.length, rowAt: (i) => rows[i] });
const read = async (blob: Blob) => XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
const aoa = (wb: XLSX.WorkBook, name: string) =>
  XLSX.utils.sheet_to_json<(string | number | undefined)[]>(wb.Sheets[name], { header: 1, defval: undefined, raw: true });

describe('splitCellText', () => {
  it('un texto que entra en una celda queda en una sola parte', () => {
    expect(splitCellText('')).toEqual(['']);
    expect(splitCellText('a'.repeat(EXCEL_CELL_MAX))).toEqual(['a'.repeat(EXCEL_CELL_MAX)]);
  });

  it('parte en trozos de a lo sumo 32 767 caracteres que, unidos, dan el texto exacto', () => {
    const text = 'x'.repeat(70_000);
    const parts = splitCellText(text);
    expect(parts.map((p) => p.length)).toEqual([32_767, 32_767, 4_466]);
    expect(parts.join('')).toBe(text);
  });

  it('corta después de un salto de línea si cae en la segunda mitad del trozo', () => {
    const text = `${'a'.repeat(20_000)}\n${'b'.repeat(19_999)}\n${'c'.repeat(30_000)}`;
    const parts = splitCellText(text);
    expect(parts).toEqual([`${'a'.repeat(20_000)}\n`, `${'b'.repeat(19_999)}\n`, 'c'.repeat(30_000)]);
    // Un salto en la primera mitad no sirve: se corta en el tope.
    const early = `${'a'.repeat(100)}\n${'b'.repeat(40_000)}`;
    expect(splitCellText(early).map((p) => p.length)).toEqual([32_767, 40_101 - 32_767]);
  });

  it('nunca parte un par sustituto (emoji)', () => {
    const text = `${'a'.repeat(EXCEL_CELL_MAX - 1)}😀${'b'.repeat(10)}`;
    const parts = splitCellText(text);
    expect(parts[0]).toBe('a'.repeat(EXCEL_CELL_MAX - 1));
    expect(parts[1]).toBe(`😀${'b'.repeat(10)}`);
    expect(parts.join('')).toBe(text);
    expect(Math.max(...parts.map((p) => p.length))).toBeLessThanOrEqual(EXCEL_CELL_MAX);
  });

  it('respeta un tope menor (pruebas)', () => {
    expect(splitCellText('abcdefg', 3)).toEqual(['abc', 'def', 'g']);
  });
});

describe('planSheets', () => {
  it('sin encabezado fijo, las columnas son la unión de claves en orden de aparición', () => {
    const [p] = planSheets([sheet('S', [{ A: 1, B: 'x' }, { A: 2, C: 'y' }])]);
    expect(p.header).toEqual(['A', 'B', 'C']);
  });

  it('un texto que no entra sigue en columnas «(2)», «(3)» pegadas a la suya, con las partes del más largo', () => {
    const [p] = planSheets([sheet('Views', [
      { View: 'V1', SQL: 'abcdefg', Note: 'n' },
      { View: 'V2', SQL: 'ab', Note: 'n' },
    ])], { cellMax: 3 });
    expect(p.header).toEqual(['View', 'SQL', 'SQL (2)', 'SQL (3)', 'Note']);
    expect(p.cells(0)).toEqual(['V1', 'abc', 'def', 'g', 'n']);
    expect(p.cells(1)).toEqual(['V2', 'ab', '', '', 'n']);
  });

  it('con encabezado fijo (plantilla) respeta su orden y también inserta la continuación', () => {
    const [p] = planSheets([sheet('QA', [{ B: 'abcd', A: 1 }], ['A', 'B', 'Z'])], { cellMax: 2 });
    expect(p.header).toEqual(['A', 'B', 'B (2)', 'Z']);
    expect(p.cells(0)).toEqual([1, 'ab', 'cd', undefined]);
  });

  it('una hoja con más filas que el tope sigue en «Nombre (2)» con el mismo encabezado', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ N: i }));
    const plan = planSheets([sheet('Columns', rows)], { maxRows: 4 });   // 3 filas + encabezado por hoja
    expect(plan.map((p) => p.name)).toEqual(['Columns', 'Columns (2)', 'Columns (3)']);
    expect(plan.map((p) => [p.from, p.to])).toEqual([[0, 3], [3, 6], [6, 7]]);
    expect(plan.every((p) => p.header.join() === 'N')).toBe(true);
  });

  it('una hoja sin filas sale con su encabezado fijo, o vacía si no lo tiene', () => {
    const plan = planSheets([sheet('A', [], ['X', 'Y']), sheet('B', [])]);
    expect(plan.map((p) => [p.name, p.header, p.to - p.from])).toEqual([['A', ['X', 'Y'], 0], ['B', [], 0]]);
  });

  it('los nombres de hoja no se repiten (sin distinguir mayúsculas)', () => {
    const plan = planSheets([sheet('Views', []), sheet('views', [])]);
    expect(plan.map((p) => p.name)).toEqual(['Views', 'views (2)']);
  });
});

describe('límites que no se pueden partir', () => {
  it('un nombre de continuación no repite una columna real: salta al siguiente número libre', () => {
    const [p] = planSheets([sheet('Views', [{ SQL: 'abcdefg', 'SQL (2)': 'x' }])], { cellMax: 3 });
    expect(p.header).toEqual(['SQL', 'SQL (3)', 'SQL (4)', 'SQL (2)']);
    expect(new Set(p.header).size).toBe(p.header.length);
    expect(p.cells(0)).toEqual(['abc', 'def', 'g', 'x']);
  });

  it('más columnas que las de Excel (16 384): error claro, sin escribir un libro que Excel rechaza', () => {
    const wide = Object.fromEntries(Array.from({ length: EXCEL_MAX_COLUMNS + 1 }, (_, i) => [`C${i}`, i]));
    expect(() => planSheets([sheet('Columns', [wide])])).toThrow(/more columns than Excel allows/);
  });

  it('el tope de una hoja se mide en bytes UTF-8, no en caracteres', async () => {
    const rows = Array.from({ length: 40 }, () => ({ Text: 'ñandú '.repeat(100) }));   // ~600 caracteres, ~800 bytes por fila
    await expect(buildXlsx([sheet('S', rows)], { entryBytesMax: 30_000 })).rejects.toThrow(/too large/);
    await expect(buildXlsx([sheet('S', rows)], { entryBytesMax: 40_000 })).resolves.toBeInstanceOf(Blob);
  });

  it('un libro que pasaría el tope total del formato (4 GB comprimido) falla con un error claro', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ Text: `fila ${i}` }));
    await expect(buildXlsx([sheet('S', rows)], { zipBytesMax: 500 })).rejects.toThrow(/larger than 4 GB/);
  });

  it('una hoja que pasaría el tope del formato (4 GB) falla con un error claro, no con un archivo corrupto', async () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({ Text: `fila ${i} `.repeat(20) }));
    await expect(buildXlsx([sheet('Tables + Columns', rows)], { entryBytesMax: 20_000 }))
      .rejects.toThrow(/«Tables \+ Columns» sheet is too large for an Excel file/);
  });
});

describe('sheetName', () => {
  it('la continuación «(n)» no pasa de 31 caracteres', () => {
    const base = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ01234';   // 31
    expect(sheetName(base, 1, new Set())).toBe(base);
    expect(sheetName(base, 2, new Set())).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ0 (2)');
    expect(sheetName(base, 12, new Set()).length).toBe(31);
  });

  it('si el nombre ya está tomado, sube el número', () => {
    expect(sheetName('Tables', 1, new Set(['tables']))).toBe('Tables (2)');
    expect(sheetName('Tables', 2, new Set(['tables (2)']))).toBe('Tables (3)');
  });
});

describe('buildXlsx (leído con SheetJS)', () => {
  it('cada hoja con su nombre, encabezado y valores; números como números y vacíos sin celda', async () => {
    const wb = await read(await buildXlsx([
      sheet('Tables', [{ Table: 'T1', '#Columns': 3, Note: '' }, { Table: 'T2', '#Columns': 0, Note: 'ok' }]),
      sheet('Tables + Columns', [{ Column: 'C1' }]),
    ]));
    expect(wb.SheetNames).toEqual(['Tables', 'Tables + Columns']);
    expect(aoa(wb, 'Tables')).toEqual([['Table', '#Columns', 'Note'], ['T1', 3], ['T2', 0, 'ok']]);
    expect(wb.Sheets.Tables.B2.t).toBe('n');
    expect(wb.Sheets.Tables.C2).toBeUndefined();
    expect(aoa(wb, 'Tables + Columns')).toEqual([['Column'], ['C1']]);
  });

  it('los textos vuelven idénticos: XML, saltos de línea, tabulaciones, controles, _xHHHH_ literal, emoji y espacios', async () => {
    const texts = [
      'a & b < c > d " e \' f',
      'línea 1\r\nlínea 2\nlínea 3\rfin',
      'col\tcol',
      'vertical\u000btab y \u0001 control',
      'Erwin dejó _x000d_ literal y _X0041_ también',
      'emoji 😀 y ñandú',
      '  con espacios  ',
      '\nempieza con salto',
    ];
    const wb = await read(await buildXlsx([sheet('S', texts.map((t) => ({ Text: t })))]));
    // El lector de SheetJS convierte «\r\n» en «\n» (también en los libros que escribe él mismo).
    expect(aoa(wb, 'S').slice(1).map((r) => r[0])).toEqual(texts.map((t) => t.replace(/\r\n/g, '\n')));
  });

  it('«\\r» se escribe como _x000D_: un lector XML lo convertiría en «\\n»', async () => {
    const blob = await buildXlsx([sheet('S', [{ Text: 'a\r\nb\rc' }])]);
    const xml = strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))['xl/worksheets/sheet1.xml']);
    expect(xml).toContain('a_x000D_\nb_x000D_c');
  });

  it('un texto de más de 32 767 caracteres sale en columnas de continuación y se reconstruye exacto', async () => {
    const sql = `CREATE VIEW v (\n${Array.from({ length: 9_000 }, (_, i) => `  COL_${i}`).join(',\n')}\n) AS SELECT 1;`;
    expect(sql.length).toBeGreaterThan(2 * EXCEL_CELL_MAX);
    const wb = await read(await buildXlsx([sheet('Views', [{ View: 'V', SQL: sql, Description: 'd' }])]));
    const [header, row] = aoa(wb, 'Views');
    const parts = header.map((h, i) => [h, i] as const).filter(([h]) => h === 'SQL' || /^SQL \(\d+\)$/.test(String(h)));
    expect(parts.length).toBe(splitCellText(sql).length);
    expect(header[header.length - 1]).toBe('Description');
    expect(parts.map(([, i]) => row[i]).join('')).toBe(sql);
    for (const cell of row) expect(String(cell ?? '').length).toBeLessThanOrEqual(EXCEL_CELL_MAX);
  });

  it('escribe muchas filas en flujo sin perder ninguna', async () => {
    const n = 30_000;
    const wb = await read(await buildXlsx([{
      name: 'Columns', count: n, rowAt: (i) => ({ Table: `T${i % 97}`, Column: `C${i}`, Ordinal: i }),
    }]));
    const rows = aoa(wb, 'Columns');
    expect(rows.length).toBe(n + 1);
    expect(rows[n]).toEqual(['T' + ((n - 1) % 97), `C${n - 1}`, n - 1]);
  });
});

describe('flujo', () => {
  it('planea cada hoja cediendo el hilo: no recorre todas las filas antes de la primera pausa', async () => {
    const Real = globalThis.MessageChannel;
    let yields = 0;
    let yieldsAtLastPlanRead = -1;
    const seen = new Set<number>();
    class Counting extends Real {
      constructor() { super(); yields += 1; }
    }
    globalThis.MessageChannel = Counting as typeof MessageChannel;
    try {
      const n = 60_000;
      await buildXlsx([{ name: 'Columns', count: n, rowAt: (i) => {
        if (!seen.has(i)) { seen.add(i); if (i === n - 1) yieldsAtLastPlanRead = yields; }
        return { Column: `C${i}` };
      } }]);
    } finally {
      globalThis.MessageChannel = Real;
    }
    expect(yieldsAtLastPlanRead).toBeGreaterThan(0);
  });
});
