// Public API of the `diagram` feature (ER canvas, inspector, scope, layouts, DBML).
// Import from `@/features/diagram`; never reach into its subdirectories.

// Components
export { default as ERCanvas } from './components/ERCanvas';
export type { ERModel } from './components/ERCanvas';
export { default as Inspector } from './components/Inspector';
export { default as ScopeControl } from './components/ScopeControl';

// DBML / table builders
export { col, genDBML, parseDBML, tableFromSources } from './builders';
export type { FromSourcesMeta } from './builders';

// Canvas layouts
export {
  arrange,
  layoutByLayer,
  layoutCompact,
  layoutSnowflake,
  nodeHeight,
} from './layout/layouts';
export type { Positions, ArrangeKind } from './layout/layouts';
