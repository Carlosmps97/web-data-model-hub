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

// Doc 105: texto que la base no puede guardar (Postgres rechaza el NUL y un
// surrogate UTF-16 suelto; el backend responde 400 a TODA la carga). SheetJS
// decodifica el escape de Excel `_x0000_` a U+0000: se quita (es invisible);
// un surrogate sin pareja pasa a U+FFFD, como `String.prototype.toWellFormed`.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const storable = (s: string): string => s.split('\u0000').join('').replace(LONE_SURROGATE, '\uFFFD');

const cellText = (v: unknown): string => (v == null ? '' : storable(typeof v === 'string' ? v : String(v)));

/** El formato sin los textos entre comillas ni los escapes. */
const bareFormat = (fmt: string) => fmt.replace(/"[^"]*"/g, '').replace(/\\./g, '');

/** ¿El formato MUESTRA la hora? (sin los corchetes de color/idioma — `[h]` de
 *  horas transcurridas sí cuenta). */
function showsTime(fmt: string): boolean {
  return /[hs]|am\/pm|a\/p/i.test(bareFormat(fmt).replace(/\[(?![hms]+\])[^\]]*\]/gi, ''));
}

/** Doc 105 (rondas 6–7): ¿es una FECHA? Un formato de fecha para SheetJS con
 *  parte de fecha — año o día, o el mes de un formato que no muestra la hora
 *  («mmmm», de la categoría Fecha de Excel; en «mm:ss» la «m» son minutos),
 *  fuera de corchetes. Una celda de sólo hora, una duración (`[h]:mm`) o
 *  «general» en minúsculas (SheetJS la toma por fecha) viajaban como una fecha
 *  de 1900 inventada («1900-01-00 08:30»). */
function isDateFormat(fmt: string): boolean {
  if (!XLSX.SSF.is_date(fmt)) return false;
  const bare = bareFormat(fmt).replace(/\[[^\]]*\]/g, '');
  return /[yd]/i.test(bare) || (/m/i.test(bare) && !showsTime(fmt));
}

/** Doc 105 (ronda 5): celda numérica con formato de FECHA → `YYYY-MM-DD` (más
 *  `HH:MM[:SS]` si el formato muestra la hora — ronda 6: con `=NOW()` y un
 *  formato de fecha, Excel muestra sólo la fecha). El texto formateado dependía
 *  del formato local de la celda («1/2/24», «02-ene-24»): un UDP de fecha lo
 *  guardaba así (el panel, que usa YYYY-MM-DD, lo mostraba vacío) y el backend
 *  ahora lo rechaza. Desde el número de serie (con el sistema de fechas del
 *  libro, 1900 o 1904): sin husos horarios de por medio. */
function isoDate(cell: XLSX.CellObject | undefined, date1904: boolean): string | null {
  if (!cell || cell.t !== 'n' || typeof cell.v !== 'number' || typeof cell.z !== 'string' || !isDateFormat(cell.z)) return null;
  const d = XLSX.SSF.parse_date_code(cell.v, { date1904 });
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${d.y}-${p(d.m)}-${p(d.d)}`;
  if (!showsTime(cell.z) || (!d.H && !d.M && !d.S)) return day;
  return `${day} ${p(d.H)}:${p(d.M)}${d.S ? `:${p(d.S)}` : ''}`;
}

export function readSheet(name: string, ws: XLSX.WorkSheet, { date1904 = false }: { date1904?: boolean } = {}): RawSheet {
  // `!ref` es el rango USADO (la plantilla real empieza en B4): se fuerza el
  // origen a A1 para que el índice de fila sea la fila Excel absoluta y las
  // celdas conserven su columna (la fila de cabecera del perfil es absoluta).
  const end = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).e : { r: 0, c: 0 };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1, raw: false, defval: '', blankrows: true, range: { s: { r: 0, c: 0 }, e: end },
  });
  const rows: RawSheet['rows'] = [];
  grid.forEach((line, i) => {
    const cells = (line ?? []).map((v, j) => isoDate(ws[XLSX.utils.encode_cell({ r: i, c: j })], date1904) ?? cellText(v));
    while (cells.length && !cells[cells.length - 1].trim()) cells.pop();
    if (cells.some((c) => c.trim())) rows.push({ row: i + 1, cells });
  });
  // Doc 105 (ronda 5): SheetJS decodifica `_x0000_` también en el nombre de la hoja.
  return { name: storable(name), rows };
}

export function readWorkbook(data: ArrayBuffer | Uint8Array, fileName: string): RawWorkbook {
  // `cellNF`: conserva el formato de cada celda (reconoce las de fecha).
  const wb = XLSX.read(data, { type: 'array', cellNF: true });
  const date1904 = !!wb.Workbook?.WBProps?.date1904;
  return { fileName: storable(fileName), sheets: wb.SheetNames.map((n) => readSheet(n, wb.Sheets[n], { date1904 })) };
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
