// API pública de la feature `reporting`. Se importa desde `@/features/reporting`,
// nunca desde sus subdirectorios.
export { default as SheetTemplateCard } from './components/SheetTemplateCard';
export {
  COLUMN_BATCH, columnSheetRow, joinedSheetRow, relationshipSheetRow, sheetHeaders, sortColumnRows, tableSheetRow,
  udpKeysOf, unionSorted, viewSheetRow,
} from './lib/reportRows';
export type { SheetRow } from './lib/reportRows';
export { fetchColumnsFor, fetchRelationshipsFor, fetchViewsFor } from './lib/reportFetch';
export {
  levelsFileName, ownOpenVersions, productionLabel, readErrorText, vanishedVersionText, VERSION_CLOSED_TEXT, VERSION_TOAST,
  versionGoneText, versionOptionLabel,
} from './lib/reportVersions';
