// Public API of the `table-editor` feature (table form, list, ingestion modals).
// Import from `@/features/table-editor`; never reach into its subdirectories.
export { default as TableForm } from './components/TableForm';
export { default as TablesListView } from './components/TablesListView';
export type { CreateKind } from './components/TablesListView';
export { default as CreateFromSqlModal } from './components/CreateFromSqlModal';
export { default as DBMLModal } from './components/DBMLModal';
