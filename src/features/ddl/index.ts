// Public API of the `ddl` feature.
// Import from `@/features/ddl`; never reach into its subdirectories.
// (Los generators son internos: los consume ExportDdlModal directamente.)
export { default as ExportDdlModal } from './components/ExportDdlModal';

// F3: el generador de vistas es API pública — lo usa el ViewEditor del modeler
// (su preview emite el MISMO SQL que el export). Doc 91 D5: `inferJoin` se
// retiró (con 2+ fuentes el DDL lista `FROM t1, t2`, como Erwin).
export { DEFAULT_DATABRICKS_OPTS, viewDDL } from './generators';
export type { DdlView } from './generators';
