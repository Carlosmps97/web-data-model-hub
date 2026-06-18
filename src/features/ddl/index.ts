// Public API of the `ddl` feature.
// Import from `@/features/ddl`; never reach into its subdirectories.
export { default as DDLPreviewModal } from './components/DDLPreviewModal';
export { genDDL, genViewDDL, countViews } from './generators';
export type { GenDDLOptions } from './generators';
