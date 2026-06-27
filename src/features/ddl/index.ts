// Public API of the `ddl` feature.
// Import from `@/features/ddl`; never reach into its subdirectories.
export { default as DDLPreviewModal } from './components/DDLPreviewModal';
export { default as ExportDdlModal } from './components/ExportDdlModal';
export { genDDL, genViewDDL, countViews, databricksDdl, ddlFilename, DEFAULT_DATABRICKS_OPTS } from './generators';
export type {
  GenDDLOptions,
  DatabricksDdlOptions,
  DatabricksDdlInput,
  DdlDialect,
  DdlTableFormat,
  DdlTable,
  DdlColumn,
  DdlRelationship,
} from './generators';
