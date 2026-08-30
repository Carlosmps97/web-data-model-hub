/**
 * Parseo del `.xlsx` de la carga masiva (doc 55 §3.1 / §8) con SheetJS — la
 * MISMA librería que ya exporta el reporting. Sin semántica: el backend es
 * quien sabe qué significa cada cabecera; acá solo se localizan las hojas
 * (`Tablas` / `Atributos`, sin caso ni tildes), se detecta la fila de
 * cabeceras (la primera que contiene `TABLA_LOGICO`) y se emiten las filas de
 * datos como `{row, cells}` con el texto tal cual (saltos de línea incluidos).
 */
import * as XLSX from 'xlsx';

export interface UploadSheetRow { row: number; cells: Record<string, string>; }
export interface UploadSheet { headers: string[]; rows: UploadSheetRow[]; }
export interface UploadWorkbookBody {
  fileName: string;
  sheets: { tables?: UploadSheet; columns?: UploadSheet };
}
export interface ParsedWorkbook {
  body: UploadWorkbookBody;
  /** Qué hojas se encontraron (aunque no tengan cabecera válida). */
  found: { tables: boolean; columns: boolean };
  counts: { tables: number; columns: number };
  /** Problemas de estructura que impiden validar (se muestran en el popup). */
  problems: string[];
}

const ANCHOR = 'TABLA_LOGICO';
const HEADER_SCAN_ROWS = 10;
const SHEET_KEYS: Record<string, 'tables' | 'columns'> = { tablas: 'tables', atributos: 'columns' };

const stripAccents = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** `tabla lógico` → `TABLA_LOGICO` (misma regla que el parser del backend). */
export function headerKey(h: unknown): string {
  return stripAccents(String(h ?? '')).trim().toUpperCase().replace(/[\s-]+/g, '_').replace(/^_+|_+$/g, '');
}

const sheetKey = (name: string) => stripAccents(name).trim().toLowerCase();

const cellText = (v: unknown): string => {
  if (v == null) return '';
  return typeof v === 'string' ? v : String(v);
};

/** Hoja → `{headers, rows}` o null si no tiene fila de cabecera con TABLA_LOGICO. */
export function parseSheet(ws: XLSX.WorkSheet): UploadSheet | null {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' });
  const headerIdx = grid.slice(0, HEADER_SCAN_ROWS).findIndex((r) => (r ?? []).some((c) => headerKey(c) === ANCHOR));
  if (headerIdx === -1) return null;
  const headerRow = grid[headerIdx] ?? [];
  const columns: { idx: number; header: string }[] = [];
  for (let i = 0; i < headerRow.length; i++) {
    const h = cellText(headerRow[i]).trim();
    if (h) columns.push({ idx: i, header: h });
  }
  const rows: UploadSheetRow[] = [];
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const line = grid[r] ?? [];
    const cells: Record<string, string> = {};
    let empty = true;
    for (const { idx, header } of columns) {
      const text = cellText(line[idx]);
      if (text.trim()) empty = false;
      cells[header] = text;
    }
    if (!empty) rows.push({ row: r + 1, cells });
  }
  return { headers: columns.map((c) => c.header), rows };
}

export function parseWorkbook(data: ArrayBuffer | Uint8Array, fileName: string): ParsedWorkbook {
  const wb = XLSX.read(data, { type: 'array' });
  const out: ParsedWorkbook = {
    body: { fileName, sheets: {} },
    found: { tables: false, columns: false },
    counts: { tables: 0, columns: 0 },
    problems: [],
  };
  const labels = { tables: 'Tablas', columns: 'Atributos' } as const;
  for (const name of wb.SheetNames) {
    const key = SHEET_KEYS[sheetKey(name)];
    if (!key || out.found[key]) continue;
    out.found[key] = true;
    const sheet = parseSheet(wb.Sheets[name]);
    if (!sheet) {
      out.problems.push(`Sheet '${labels[key]}' has no header row with ${ANCHOR}.`);
      continue;
    }
    out.body.sheets[key] = sheet;
    out.counts[key] = sheet.rows.length;
  }
  if (!out.found.tables && !out.found.columns) {
    out.problems.push("The workbook has no 'Tablas' or 'Atributos' sheet — use the template.");
  }
  return out;
}
