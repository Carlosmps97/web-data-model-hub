/**
 * xlsxWriter — escribe los .xlsx del Reporting por partes (en flujo) y los
 * comprime mientras escribe (`fflate`): la memoria queda acotada al archivo
 * comprimido, no al libro entero. Armar el libro completo en memoria no escala:
 * con todo un proyecto grande (168 mil columnas) pasaba de 4 GB o fallaba con
 * «Too many properties to enumerate» / «Invalid array length».
 *
 * Límites de Excel, sin perder datos:
 *  · una celda admite 32 767 caracteres: el texto más largo sigue en columnas
 *    «<encabezado> (2)», «(3)»… pegadas a la suya (unirlas da el texto exacto);
 *  · una hoja admite 1 048 576 filas: el resto sigue en «<hoja> (2)»…
 * Celdas: número finito → número; texto → cadena en línea; vacío → sin celda.
 */
import { Zip, ZipDeflate, strToU8 } from 'fflate';
import type { SheetRow } from './reportRows';

/** Caracteres por celda que admite Excel. */
export const EXCEL_CELL_MAX = 32_767;
/** Filas por hoja que admite Excel (incluye el encabezado). */
export const EXCEL_MAX_ROWS = 1_048_576;
/** Columnas por hoja que admite Excel. */
export const EXCEL_MAX_COLUMNS = 16_384;
const SHEET_NAME_MAX = 31;
/** Bytes de una parte del zip sin ZIP64 (fflate guarda los tamaños en 32 bits). */
const ZIP32_MAX = 0xffff_ffff;
/** Tamaño aproximado (caracteres) de cada bloque que se comprime antes de ceder el hilo. */
const CHUNK = 1 << 20;
/** Filas que se recorren al planear una hoja entre cada pausa. */
const SCAN_SLICE = 5_000;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Hoja a escribir. `rowAt` se llama dos veces por fila (una para planear las
 *  columnas, otra al escribir): así nunca se guarda la hoja entera armada. */
export interface WorkbookSheet {
  name: string;
  /** Orden fijo de columnas (plantillas); sin él, la unión de claves de las filas en orden de aparición. */
  header?: string[];
  count: number;
  rowAt: (i: number) => SheetRow;
}

type Cell = string | number | undefined;

/** Hoja ya planeada: nombre final, encabezado con las columnas de continuación y
 *  el tramo de filas [from, to) de su hoja de origen. */
export interface PlannedSheet {
  name: string;
  header: string[];
  from: number;
  to: number;
  /** Celdas de la fila `i` (de la hoja de origen) en el orden de `header`. */
  cells: (i: number) => Cell[];
}

interface Limits { cellMax?: number; maxRows?: number }

/** Parte un texto en trozos de a lo sumo `max` caracteres: corta después de un
 *  salto de línea si cae en la segunda mitad del trozo y nunca en medio de un
 *  par sustituto. Unir los trozos da el texto exacto. Pura. */
export function splitCellText(text: string, max = EXCEL_CELL_MAX): string[] {
  const parts: string[] = [];
  let i = 0;
  while (text.length - i > max) {
    let end = i + max;
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    const nl = text.lastIndexOf('\n', end - 1);
    if (nl >= i + Math.floor(max / 2)) end = nl + 1;
    parts.push(text.slice(i, end));
    i = end;
  }
  parts.push(text.slice(i));
  return parts;
}

/** Nombre de hoja válido para Excel (≤ 31 caracteres) y libre (sin distinguir
 *  mayúsculas): `n` > 1 agrega « (n)»; si ya está tomado, sube el número. Pura. */
export function sheetName(base: string, n: number, taken: Set<string>): string {
  for (let k = n; ; k += 1) {
    const suffix = k === 1 ? '' : ` (${k})`;
    let head = base.slice(0, SHEET_NAME_MAX - suffix.length);
    const last = head.charCodeAt(head.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
    const name = head + suffix;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** Tramos de cada hoja de origen: más filas que el tope → hojas de continuación.
 *  Los nombres dependen solo de la cantidad de filas: se conocen antes de leerlas. */
function sheetSlices(sheets: WorkbookSheet[], maxRows: number): { source: number; name: string; from: number; to: number }[] {
  const perSheet = maxRows - 1;   // la primera fila es el encabezado
  const taken = new Set<string>();
  const out: { source: number; name: string; from: number; to: number }[] = [];
  sheets.forEach((s, source) => {
    for (let from = 0, n = 1; from < s.count || n === 1; from += perSheet, n += 1) {
      const name = sheetName(s.name, n, taken);
      taken.add(name.toLowerCase());
      out.push({ source, name, from, to: Math.min(s.count, from + perSheet) });
    }
  });
  return out;
}

/** Columnas de una hoja mientras se recorren sus filas: la unión de claves (salvo
 *  encabezado fijo) y las partes del texto más largo de cada una. */
interface ColumnScan { keys: string[]; seen: Set<string>; parts: Map<string, number> }

function newScan(header?: string[]): ColumnScan {
  const keys = header ? [...header] : [];
  return { keys, seen: new Set(keys), parts: new Map() };
}

function scanRows(s: WorkbookSheet, scan: ColumnScan, from: number, to: number, cellMax: number): void {
  for (let i = from; i < to; i += 1) {
    const row = s.rowAt(i);
    for (const k of Object.keys(row)) {
      if (!s.header && !scan.seen.has(k)) { scan.seen.add(k); scan.keys.push(k); }
      const v = row[k];
      if (typeof v === 'string' && v.length > cellMax) {
        scan.parts.set(k, Math.max(scan.parts.get(k) ?? 1, splitCellText(v, cellMax).length));
      }
    }
  }
}

/** Encabezado con las columnas de continuación («<columna> (2)»…, pegadas a la suya y
 *  sin repetir el nombre de una columna real) y, por posición, qué parte de qué
 *  columna va. Más columnas que las de Excel: error claro. */
function finishScan(s: WorkbookSheet, scan: ColumnScan): { header: string[]; cols: { key: string; part: number }[] } {
  const used = new Set(scan.keys);
  const cols: { key: string; part: number }[] = [];
  const header: string[] = [];
  for (const k of scan.keys) {
    cols.push({ key: k, part: 0 });
    header.push(k);
    for (let p = 1, n = 2; p < (scan.parts.get(k) ?? 1); p += 1) {
      while (used.has(`${k} (${n})`)) n += 1;
      const name = `${k} (${n})`;
      used.add(name);
      cols.push({ key: k, part: p });
      header.push(name);
    }
  }
  if (header.length > EXCEL_MAX_COLUMNS) {
    throw new Error(`The «${s.name}» sheet has more columns than Excel allows (${EXCEL_MAX_COLUMNS.toLocaleString('en-US')}).`);
  }
  return { header, cols };
}

function cellsOf(s: WorkbookSheet, cols: { key: string; part: number }[], cellMax: number): (i: number) => Cell[] {
  return (i) => {
    const row = s.rowAt(i);
    const line: Cell[] = [];
    let splitKey: string | null = null;
    let split: string[] = [];
    for (const c of cols) {
      const v = row[c.key];
      if (typeof v === 'string' && v.length > cellMax) {
        if (splitKey !== c.key) { splitKey = c.key; split = splitCellText(v, cellMax); }
        line.push(split[c.part] ?? '');
      } else line.push(c.part === 0 ? v : '');
    }
    return line;
  };
}

/** Planea las hojas: columnas (con las de continuación de los textos que no
 *  entran en una celda) y hojas de continuación de las que pasan el tope de
 *  filas. `limits` solo cambia en pruebas. Pura. */
export function planSheets(sheets: WorkbookSheet[], limits: Limits = {}): PlannedSheet[] {
  const cellMax = limits.cellMax ?? EXCEL_CELL_MAX;
  const columns = sheets.map((s) => {
    const scan = newScan(s.header);
    scanRows(s, scan, 0, s.count, cellMax);
    const { header, cols } = finishScan(s, scan);
    return { header, cells: cellsOf(s, cols, cellMax) };
  });
  return sheetSlices(sheets, limits.maxRows ?? EXCEL_MAX_ROWS)
    .map(({ source, name, from, to }) => ({ name, from, to, ...columns[source] }));
}

// Caracteres que el XML no admite tal cual: los de marcado van como entidad y los
// de control (también `\r`, que un lector XML convertiría en `\n`) como `_xHHHH_`
// (OOXML, ST_Xstring). Un `_` que formaría un `_xHHHH_` con lo que sigue —también
// con el escape de un carácter de control— va como `_x005F_`: así Excel muestra
// el texto literal (Erwin trae, por ejemplo, «_x000d_» escrito en definiciones).
const CONTROL = '\\u0000-\\u0008\\u000b-\\u001f\\ufffe\\uffff';
const XML_UNSAFE = new RegExp(`[&<>"]|[${CONTROL}]|_(?=[xX][0-9A-Fa-f]{4}(?:_|[${CONTROL}]))`, 'g');
const XML_ENTITY: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escapeXml(text: string): string {
  return text.replace(XML_UNSAFE, (ch) =>
    XML_ENTITY[ch] ?? `_x${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`);
}

/** Letra(s) de la columna `i` (0 → A, 26 → AA). */
function columnName(i: number): string {
  let name = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function cellXml(ref: string, v: Cell): string {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
  const text = String(v);
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" t="inlineStr"><is><t${space}>${escapeXml(text)}</t></is></c>`;
}

function rowXml(r: number, letters: string[], cells: Cell[]): string {
  let xml = `<row r="${r}">`;
  for (let c = 0; c < cells.length; c += 1) xml += cellXml(`${letters[c]}${r}`, cells[c]);
  return `${xml}</row>`;
}

/** Cede el hilo entre bloques (la pantalla no se congela). Un mensaje y no un
 *  temporizador: el navegador demora los temporizadores de una pestaña oculta. */
const yieldToUi = () => new Promise<void>((resolve) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
  ch.port2.postMessage(null);
});

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

function contentTypes(sheets: number): string {
  const overrides = Array.from({ length: sheets }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT}.worksheet+xml"/>`).join('');
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + `<Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/>`
    + `<Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/>${overrides}</Types>`;
}

const ROOT_RELS = `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">`
  + `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

function workbookXml(names: string[]): string {
  const sheets = names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  return `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${sheets}</sheets></workbook>`;
}

function workbookRels(sheets: number): string {
  const rels = Array.from({ length: sheets }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  return `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${rels}`
    + `<Relationship Id="rId${sheets + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`;
}

const STYLES = `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">`
  + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** Error de la compresión (el primero gana) y bytes escritos: se revisa después
 *  de cada bloque para cortar el libro en ese momento. */
interface ZipState { error: Error | null; bytes: number }

function check(state: ZipState): void {
  if (state.error) throw state.error;
}

/** Escribe una hoja en el zip por bloques de ~1 MB, cediendo el hilo entre ellos. */
async function writeSheet(zip: Zip, state: ZipState, path: string, sheet: PlannedSheet, entryBytesMax: number): Promise<void> {
  const file = new ZipDeflate(path, { level: 6 });
  zip.add(file);
  const letters = sheet.header.map((_, i) => columnName(i));
  let buf: string[] = [];
  let size = 0;
  let bytes = 0;
  const add = (xml: string) => { buf.push(xml); size += xml.length; };
  const push = (final: boolean) => {
    const chunk = strToU8(buf.join(''));
    bytes += chunk.length;
    if (bytes > entryBytesMax) {
      throw new Error(`The «${sheet.name}» sheet is too large for an Excel file (over 4 GB of data) — narrow the selection or leave this sheet out.`);
    }
    file.push(chunk, final);
    buf = [];
    size = 0;
    check(state);
  };
  const dimension = letters.length ? `<dimension ref="A1:${letters[letters.length - 1]}${sheet.to - sheet.from + 1}"/>` : '';
  add(`${XML_HEAD}<worksheet xmlns="${NS_MAIN}">${dimension}<sheetData>`);
  if (letters.length) add(rowXml(1, letters, sheet.header));
  for (let i = sheet.from, r = 2; i < sheet.to; i += 1, r += 1) {
    add(rowXml(r, letters, sheet.cells(i)));
    if (size >= CHUNK) {
      push(false);
      await yieldToUi();
    }
  }
  add('</sheetData></worksheet>');
  push(true);
}

/** Libro .xlsx con las hojas dadas, escrito en flujo (ver el encabezado). Las
 *  columnas de cada hoja se planean justo antes de escribirla, cediendo el hilo.
 *  `limits` solo cambia en pruebas. */
export async function buildXlsx(sheets: WorkbookSheet[], limits: { entryBytesMax?: number; zipBytesMax?: number } = {}): Promise<Blob> {
  const entryBytesMax = limits.entryBytesMax ?? ZIP32_MAX - CHUNK * 4;
  const zipBytesMax = limits.zipBytesMax ?? ZIP32_MAX;
  const slices = sheetSlices(sheets, EXCEL_MAX_ROWS);
  // fflate entrega bloques sobre ArrayBuffer propio (nunca compartido).
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const state: ZipState = { error: null, bytes: 0 };
  const zip = new Zip((err, data) => {
    if (err) { state.error ??= err; return; }
    state.bytes += data.length;
    if (state.bytes > zipBytesMax) state.error ??= new Error('The Excel file would be larger than 4 GB — narrow the selection or leave some sheets out.');
    chunks.push(data as Uint8Array<ArrayBuffer>);
  });
  const part = (path: string, xml: string) => {
    const file = new ZipDeflate(path, { level: 6 });
    zip.add(file);
    file.push(strToU8(xml), true);
    check(state);
  };
  part('[Content_Types].xml', contentTypes(slices.length));
  part('_rels/.rels', ROOT_RELS);
  part('xl/workbook.xml', workbookXml(slices.map((x) => x.name)));
  part('xl/_rels/workbook.xml.rels', workbookRels(slices.length));
  part('xl/styles.xml', STYLES);
  let index = 0;
  for (let source = 0; source < sheets.length; source += 1) {
    const s = sheets[source];
    const scan = newScan(s.header);
    for (let from = 0; from < s.count; from += SCAN_SLICE) {
      scanRows(s, scan, from, Math.min(s.count, from + SCAN_SLICE), EXCEL_CELL_MAX);
      await yieldToUi();
    }
    const { header, cols } = finishScan(s, scan);
    const cells = cellsOf(s, cols, EXCEL_CELL_MAX);
    for (const slice of slices.filter((x) => x.source === source)) {
      index += 1;
      await writeSheet(zip, state, `xl/worksheets/sheet${index}.xml`, { name: slice.name, header, from: slice.from, to: slice.to, cells }, entryBytesMax);
    }
  }
  zip.end();
  check(state);
  return new Blob(chunks, { type: XLSX_MIME });
}

/** Descarga el libro con `fileName` (mismo patrón que el resto de exports: un
 *  `<a download>`; la URL se libera cuando la descarga ya empezó). */
export function saveXlsx(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = fileName;
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
