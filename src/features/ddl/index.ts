// Public API of the `ddl` feature.
// Import from `@/features/ddl`; never reach into its subdirectories.
// (Los generators son internos: los consume ExportDdlModal directamente.)
export { default as ExportDdlModal } from './components/ExportDdlModal';

// F3: el generador de vistas y el inferidor de JOIN son API pública — los usa
// el ViewEditor del modeler (su preview emite el MISMO SQL que el export).
export { DEFAULT_DATABRICKS_OPTS, inferJoin, viewDDL } from './generators';
export type { DdlView } from './generators';
