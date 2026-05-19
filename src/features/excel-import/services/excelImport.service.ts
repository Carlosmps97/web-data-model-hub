/**
 * Cliente del endpoint `POST /api/excel-import/preview`.
 *
 * El backend (FastAPI) hace todo el parseo y la normalización de
 * tipos. El frontend solo sube el archivo y consume el preview ya
 * listo para mostrar.
 *
 * Reutiliza el envelope `{success, data, error}` igual que el resto
 * de los servicios (ver `services/http.ts`), pero usa `fetch`
 * directo porque el body es `FormData`, no JSON — `apiFetch` asume
 * JSON.
 */

import type { ApiResponse } from '@/types/api';
import { ApiError } from '@/services/http';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

// ─── Tipos del contrato HTTP ──────────────────────────────────────

/**
 * De qué paso del pipeline de normalización salió el `dataType`.
 * Mirrors `MatchKind` en `backend-data-model-hub/src/excel_import/type_normalizer.py`.
 */
export type TypeMatchKind = 'exact' | 'alias' | 'fuzzy' | 'unknown' | 'empty';

export interface PreviewColumn {
  name: string;
  /** Tipo canónico inferido por el backend (ej. `decimal`, `varchar`, `string`). */
  dataType: string;
  /** Cadena original tal cual estaba en el Excel (ej. `decimal(10,2)`, `decximam`). */
  rawDataType: string;
  length: number | null;
  scale: number | null;
  functionalDefinition: string | null;
  /** 0-100. 100 si fue exacto/alias; el score fuzzy si vino de similitud. */
  typeConfidence: number;
  typeMatchedVia: TypeMatchKind;
}

export interface PreviewTable {
  sheetName: string;
  /** Schema parseado del prefijo del nombre de la hoja (`{schema}.{table}`). */
  schema: string | null;
  name: string;
  /** Descripción tomada de la hoja opcional `TablesDescriptions`. */
  description: string | null;
  columns: PreviewColumn[];
}

export interface ExcelPreview {
  tables: PreviewTable[];
  tableDescriptionsFound: boolean;
  warnings: string[];
}

// ─── Llamada al backend ───────────────────────────────────────────

export async function previewExcelImport(file: File): Promise<ExcelPreview> {
  const formData = new FormData();
  formData.append('file', file);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/excel-import/preview`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : 'Network error', 0);
  }

  let json: ApiResponse<ExcelPreview> | null = null;
  try {
    json = (await response.json()) as ApiResponse<ExcelPreview>;
  } catch {
    throw new ApiError(`Invalid JSON response (HTTP ${response.status})`, response.status);
  }

  if (!json || typeof json.success !== 'boolean') {
    throw new ApiError(`Unexpected response shape (HTTP ${response.status})`, response.status);
  }
  if (!json.success || !json.data) {
    throw new ApiError(json.error ?? `Request failed (HTTP ${response.status})`, response.status);
  }
  return json.data;
}

// The `schema` field comes back via Pydantic's `populate_by_name`, which
// serialises the python attribute `schema_` under the alias `schema`. The
// type above already reflects that — no transform needed here.
