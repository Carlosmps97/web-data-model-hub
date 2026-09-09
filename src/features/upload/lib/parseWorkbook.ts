/**
 * Lectura CRUDA del `.xlsx` (doc 78 §3.2) con SheetJS — la MISMA librería que
 * ya exporta el reporting. Todas las hojas viajan como grillas
 * `{name, rows: [{row, cells}]}` sin semántica: el backend aplica el perfil
 * de carga (hojas, fila de cabecera, mapeo). Los helpers `findSheet`,
 * `headersAt` y `sheetRowCount` sirven a la tarjeta del popup y al editor de
 * perfiles («Read headers from a workbook»).
 */
import * as XLSX from 'xlsx';
import type { RawSheet } from '../upload.service';

export interface RawWorkbook { fileName: string; sheets: RawSheet[] }

const stripAccents = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** `tabla lógico` → `TABLA_LOGICO` (misma regla que `header_key` del backend). */
export const headerKey = (h: unknown): string =>
  stripAccents(String(h ?? '')).trim().toUpperCase().replace(/[\s-]+/g, '_').replace(/^_+|_+$/g, '');

/** Clave de nombre de hoja: sin caso, sin tildes, espacios colapsados (`norm_name`). */
export const sheetKey = (name: string) => stripAccents(name).trim().toLowerCase().replace(/\s+/g, ' ');

const cellText = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : String(v));

export function readSheet(name: string, ws: XLSX.WorkSheet): RawSheet {
  // `!ref` es el rango USADO (la plantilla real empieza en B4): se fuerza el
  // origen a A1 para que el índice de fila sea la fila Excel absoluta y las
  // celdas conserven su columna (la fila de cabecera del perfil es absoluta).
  const end = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).e : { r: 0, c: 0 };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1, raw: false, defval: '', blankrows: true, range: { s: { r: 0, c: 0 }, e: end },
  });
  const rows: RawSheet['rows'] = [];
  grid.forEach((line, i) => {
    const cells = (line ?? []).map(cellText);
    while (cells.length && !cells[cells.length - 1].trim()) cells.pop();
    if (cells.some((c) => c.trim())) rows.push({ row: i + 1, cells });
  });
  return { name, rows };
}

export function readWorkbook(data: ArrayBuffer | Uint8Array, fileName: string): RawWorkbook {
  const wb = XLSX.read(data, { type: 'array' });
  return { fileName, sheets: wb.SheetNames.map((n) => readSheet(n, wb.Sheets[n])) };
}

export const findSheet = (sheets: RawSheet[], name: string): RawSheet | undefined =>
  sheets.find((s) => sheetKey(s.name) === sheetKey(name));

/** Celdas no vacías de esa fila Excel (cabeceras candidatas). */
export function headersAt(sheet: RawSheet, headerRow: number): string[] {
  const r = sheet.rows.find((x) => x.row === headerRow);
  return r ? r.cells.map((c) => c.trim()).filter(Boolean) : [];
}

/** Filas con datos debajo de la fila de cabecera (todas si no hay cabecera). */
export const sheetRowCount = (sheet: RawSheet, headerRow: number | null): number =>
  sheet.rows.filter((r) => headerRow == null || r.row > headerRow).length;
