// API pública de la feature `ddl`.
// Se importa desde `@/features/ddl`; nunca desde sus subdirectorios.
// (Los generators son internos: los consume ExportDdlModal directamente.)
export { default as ExportDdlModal } from './components/ExportDdlModal';

// El generador de vistas es API pública: lo usa el ViewEditor del modeler (su
// preview emite el mismo SQL que el export). Con 2+ fuentes el DDL lista
// `FROM t1, t2`, como Erwin.
export { DEFAULT_DATABRICKS_OPTS, viewDDL } from './generators';
export type { DdlView } from './generators';

// Output settings: el mismo formulario lo usa Data Standards.
export { default as DdlOutputForm } from './components/DdlOutputForm';
export { DEFAULT_OUTPUT_SETTINGS, mergeOutputSettings } from './outputSettings';
export type { DdlOutputSettings } from './outputSettings';
// Dialecto por defecto del proyecto (Databricks | Oracle).
export type { DdlDialect } from './generators';
