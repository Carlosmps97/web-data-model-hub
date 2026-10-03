/**
 * Output settings del Export DDL (doc 93 D1): CÓMO se escribe todo DDL y cómo
 * se nombran los archivos del zip. Son dato del PROYECTO (Data Standards →
 * DDL export rules → Output, versionadas); el modal Export DDL arranca desde
 * ellas y permite ajustarlas para un export puntual. Espejo de
 * `app/features/ddl_rules/output.py` del backend.
 *
 * Doc 101: `dialect` = con qué dialecto abre el modal (Databricks por default)
 * y `oracle` = la configuración PROPIA de Oracle. Las claves planas de siempre
 * son las de Databricks; `fileNames` es de los dos dialectos.
 *
 * Doc 106: Oracle ya no tiene mapeo de tipos (`typeMap`) ni tamaño máximo de
 * strings (`maxStringSize`); si una versión anterior los guardó, se ignoran.
 */
import { DEFAULT_DATABRICKS_OPTS, type DatabricksDdlOptions, type DdlDialect } from './generators';
import { DEFAULT_FILE_NAMES, type DdlFileNames } from './ddlExportBundle';
import { DEFAULT_ORACLE_OPTS, type OracleDdlOptions } from './oracle';

export type DdlOutputSettings = Omit<DatabricksDdlOptions, 'partitionsLast'> & {
  fileNames: DdlFileNames;
  /** Doc 101: dialecto con el que abre el modal Export DDL. */
  dialect: DdlDialect;
  /** Doc 101: configuración propia de Oracle. */
  oracle: OracleDdlOptions;
};

export const DEFAULT_OUTPUT_SETTINGS: DdlOutputSettings = {
  ...DEFAULT_DATABRICKS_OPTS,
  fileNames: { ...DEFAULT_FILE_NAMES },
  dialect: 'databricks',
  oracle: { ...DEFAULT_ORACLE_OPTS },
};

const ENUMS: Record<string, readonly string[]> = {
  identifierCase: ['as-is', 'lower', 'upper'],
  quoteIdentifiers: ['when-needed', 'always'],
  typeCase: ['lower', 'upper'],
  createTable: ['or-replace', 'if-not-exists'],
  viewTagsAs: ['table', 'view'],
  tableFormat: ['delta', 'parquet', 'avro', 'orc', 'csv', 'json'],
  locationFolderCase: ['as-is', 'lower', 'upper'],
  dialect: ['databricks', 'oracle'],
};
const BOOLS = ['includeViews', 'includeKeys', 'includeComments', 'includePartitions', 'includeIndexes', 'unityCatalog', 'external'];
const TEXTS = ['catalog', 'defaultSchema', 'location'];
const FILE_ENUMS: Record<string, readonly string[]> = { nameCase: ['upper', 'lower', 'as-is'], schema: ['when-needed', 'always'] };
const FILE_TEXTS = ['table', 'modeledView', 'generatedView', 'separator'];
const ORACLE_ENUMS: Record<string, readonly string[]> = {
  identifierCase: ['as-is', 'lower', 'upper'],
  quoteIdentifiers: ['when-needed', 'always'],
  typeCase: ['lower', 'upper'],
  schemaMode: ['none', 'model', 'custom'],                  // doc 108
};
const ORACLE_BOOLS = ['includeViews', 'includeKeys', 'includeNotNull', 'includeComments'];
const ORACLE_TEXTS = ['defaultSchema'];

function mergeOracle(target: Record<string, unknown>, raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k in ORACLE_ENUMS) {
      if (typeof v === 'string' && ORACLE_ENUMS[k].includes(v)) target[k] = v;
    } else if (ORACLE_BOOLS.includes(k)) {
      if (typeof v === 'boolean') target[k] = v;
    } else if (ORACLE_TEXTS.includes(k)) {
      if (typeof v === 'string') target[k] = v;
    }
  }
}

/** Defaults + lo guardado en el proyecto. Defensivo: una clave desconocida o
 *  un valor inválido se ignoran (rige el default) — nunca rompe el modal. Un
 *  proyecto guardado antes del doc 101 abre en Databricks con Oracle por default. Puro. */
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
    } else if (k === 'oracle') {
      mergeOracle(out.oracle as Record<string, unknown>, v);
    }
  }
  return out as unknown as DdlOutputSettings;
}

/** Parte las settings en opciones del generador Databricks + nombres de archivo. */
export function splitOutputSettings(s: DdlOutputSettings): { opts: DatabricksDdlOptions; fileNames: DdlFileNames } {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { fileNames, dialect, oracle, ...rest } = s;
  return { opts: { ...rest, partitionsLast: false }, fileNames };
}
