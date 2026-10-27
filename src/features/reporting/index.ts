// API pública de la feature `reporting`. Se importa desde `@/features/reporting`,
// nunca desde sus subdirectorios.
export { default as SheetTemplateCard } from './components/SheetTemplateCard';
export { COLUMN_BATCH, sheetHeaders, unionSorted } from './lib/reportRows';
export type { SheetRow } from './lib/reportRows';
export { REPORT_SHEETS, sheetNeeds, workbookSheet } from './lib/reportSheets';
export type { SheetData, SheetKey } from './lib/reportSheets';
export {
  columnFilter, narrowSheetData, scopeSheet, SEARCH_MAX_CHARS, SEARCH_MIN_CHARS, SEARCH_SCOPES, searchTerm, serverScope,
  tableMatches,
} from './lib/reportSearch';
export type { SearchScope } from './lib/reportSearch';
export { buildXlsx, saveXlsx } from './lib/xlsxWriter';
export { fetchColumnsFor, fetchRelationshipsFor, fetchViewsFor } from './lib/reportFetch';
export {
  reportFileName, ownOpenVersions, productionLabel, readErrorText, vanishedVersionText, VERSION_CLOSED_TEXT, VERSION_TOAST,
  versionGoneText, versionOptionLabel,
} from './lib/reportVersions';
