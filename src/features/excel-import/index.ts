// Public API of the `excel-import` feature.
// Import from `@/features/excel-import`; never reach into its subdirectories.
export { default as ExcelImportModal } from './components/ExcelImportModal';
export { previewExcelImport } from './services/excelImport.service';
export type {
  ExcelPreview,
  PreviewColumn,
  PreviewTable,
  TypeMatchKind,
} from './services/excelImport.service';
export { previewToTables } from './utils/previewToTables';
export type { PreviewMeta } from './utils/previewToTables';
