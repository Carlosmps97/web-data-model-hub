/**
 * Output settings del Export DDL (doc 93 D1): CÓMO se escribe todo DDL y cómo
 * se nombran los archivos del zip. Son dato del PROYECTO (Data Standards →
 * DDL export rules → Output, versionadas); el modal Export DDL arranca desde
 * ellas y permite ajustarlas para un export puntual. Espejo de
 * `app/features/ddl_rules/output.py` del backend.
 */
import { DEFAULT_DATABRICKS_OPTS, type DatabricksDdlOptions } from './generators';
import { DEFAULT_FILE_NAMES, type DdlFileNames } from './ddlExportBundle';

export type DdlOutputSettings = Omit<DatabricksDdlOptions, 'partitionsLast'> & { fileNames: DdlFileNames };

export const DEFAULT_OUTPUT_SETTINGS: DdlOutputSettings = { ...DEFAULT_DATABRICKS_OPTS, fileNames: { ...DEFAULT_FILE_NAMES } };

const ENUMS: Record<string, readonly string[]> = {
  identifierCase: ['as-is', 'lower', 'upper'],
  quoteIdentifiers: ['when-needed', 'always'],
  typeCase: ['lower', 'upper'],
  createTable: ['or-replace', 'if-not-exists'],
  viewTagsAs: ['table', 'view'],
  tableFormat: ['delta', 'parquet', 'avro', 'orc', 'csv', 'json'],
  locationFolderCase: ['as-is', 'lower', 'upper'],
};
const BOOLS = ['includeViews', 'includeKeys', 'includeComments', 'includePartitions', 'includeIndexes', 'unityCatalog', 'external'];
const TEXTS = ['catalog', 'defaultSchema', 'location'];
const FILE_ENUMS: Record<string, readonly string[]> = { nameCase: ['upper', 'lower', 'as-is'], schema: ['when-needed', 'always'] };
const FILE_TEXTS = ['table', 'modeledView', 'generatedView', 'separator'];

/** Defaults + lo guardado en el proyecto. Defensivo: una clave desconocida o
 *  un valor inválido se ignoran (rige el default) — nunca rompe el modal. Puro. */
export function mergeOutputSettings(raw?: Record<string, unknown> | null): DdlOutputSettings {
  const out = structuredClone(DEFAULT_OUTPUT_SETTINGS) as unknown as Record<string, unknown>;
  const files = out.fileNames as Record<string, unknown>;
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (k in ENUMS) {
      if (typeof v === 'string' && ENUMS[k].includes(v)) out[k] = v;
    } else if (BOOLS.includes(k)) {
      if (typeof v === 'boolean') out[k] = v;
    } else if (TEXTS.includes(k)) {
      if (typeof v === 'string') out[k] = v;
    } else if (k === 'tblProperties') {
      if (Array.isArray(v)) {
        out[k] = v
          .filter((p): p is { key: string; value?: unknown } => !!p && typeof p === 'object' && typeof (p as { key?: unknown }).key === 'string')
          .map((p) => ({ key: p.key, value: String(p.value ?? '') }));
      }
    } else if (k === 'fileNames' && v && typeof v === 'object') {
      for (const [fk, fv] of Object.entries(v as Record<string, unknown>)) {
        if (fk in FILE_ENUMS) {
          if (typeof fv === 'string' && FILE_ENUMS[fk].includes(fv)) files[fk] = fv;
        } else if (FILE_TEXTS.includes(fk) && typeof fv === 'string') {
          files[fk] = fv;
        }
      }
    }
  }
  return out as unknown as DdlOutputSettings;
}

/** Parte las settings en opciones del generador + nombres de archivo. */
export function splitOutputSettings(s: DdlOutputSettings): { opts: DatabricksDdlOptions; fileNames: DdlFileNames } {
  const { fileNames, ...rest } = s;
  return { opts: { ...rest, partitionsLast: false }, fileNames };
}
