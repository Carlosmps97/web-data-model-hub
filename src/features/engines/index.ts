// Public API of the `engines` feature (engine catalog + badges/selectors).
// Import from `@/features/engines`; never reach into its subdirectories.
export { default as EngineBadge } from './components/EngineBadge';
export { default as EngineSelect } from './components/EngineSelect';
export { ENGINES, getEngine, resolveSchema } from './engines';
export type { EngineDefinition } from './engines';
