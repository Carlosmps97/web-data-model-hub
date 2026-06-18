// Public API of the `editor` feature (the project's scope-driven ER canvas).
// Import from `@/features/editor`; never reach into its subdirectories.
// Composes the diagram / table-editor / views / ddl / chat-agent features.
export { default as EditorScreen } from './components/EditorScreen';
export type { EditorScreenProps } from './components/EditorScreen';
