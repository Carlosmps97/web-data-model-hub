// Excel file parser for semi-manual import
// Reads .xlsx files using SheetJS, extracts table definitions from each sheet
// Expected structure per sheet:
//   Column A = column names
//   Column B = data types
//   Column C = functional definitions (optional)
// Sheet/tab name = table name

import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import type { TableModel, TableColumn } from '@/types/model';

export interface ParsedSheet {
  sheetName: string;
  columns: {
    name: string;
    dataType: string;
    functionalDefinition?: string;
  }[];
}

export interface ExcelParseResult {
  sheets: ParsedSheet[];
  errors: string[];
}

export function parseExcelFile(data: ArrayBuffer): ExcelParseResult {
  const errors: string[] = [];
  const sheets: ParsedSheet[] = [];

  try {
    const workbook = XLSX.read(data, { type: 'array' });

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];

      // Get raw data as array of arrays (header: 1 means no auto-header)
      const rawData = XLSX.utils.sheet_to_json<string[]>(worksheet, {
        header: 1,
        defval: '',
      });

      if (!rawData || rawData.length === 0) {
        errors.push(`Sheet "${sheetName}" is empty`);
        continue;
      }

      const columns: ParsedSheet['columns'] = [];

      // Check if first row looks like a header
      let startRow = 0;
      const firstRow = rawData[0];
      if (firstRow && firstRow.length >= 2) {
        const firstCellStr = String(firstRow[0]).toLowerCase();
        // If first row contains typical header keywords, skip it
        if (
          firstCellStr === 'column' ||
          firstCellStr === 'name' ||
          firstCellStr === 'column_name' ||
          firstCellStr === 'columna' ||
          firstCellStr === 'nombre'
        ) {
          startRow = 1;
        }
      }

      for (let i = startRow; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length === 0) continue;

        const name = String(row[0] || '').trim();
        const dataType = String(row[1] || 'varchar').trim();
        const funcDef = row[2] ? String(row[2]).trim() : undefined;

        if (!name) continue;

        columns.push({
          name,
          dataType,
          functionalDefinition: funcDef || undefined,
        });
      }

      if (columns.length > 0) {
        sheets.push({ sheetName, columns });
      } else {
        errors.push(`Sheet "${sheetName}" has no valid column data`);
      }
    }
  } catch (err) {
    errors.push(`Failed to parse Excel file: ${err}`);
  }

  return { sheets, errors };
}

// Convert parsed sheets to TableModel array
export function sheetsToTables(sheets: ParsedSheet[]): TableModel[] {
  return sheets.map((sheet, index) => ({
    id: uuidv4(),
    name: sheet.sheetName,
    columns: sheet.columns.map((col): TableColumn => ({
      id: uuidv4(),
      name: col.name,
      dataType: col.dataType,
      functionalDefinition: col.functionalDefinition || undefined,
    })),
    position: {
      x: (index % 3) * 350 + 50,
      y: Math.floor(index / 3) * 400 + 50,
    },
  }));
}
