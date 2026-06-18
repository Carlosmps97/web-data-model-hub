// ─────────────────────────────────────────────────────────────────────────
//  Public API (barrel) of the `<feature>` feature.
//
//  This is the ONLY entry point other code may import from:
//      import { Thing } from '@/features/<feature>';
//
//  Never let outside code reach into subdirectories
//  (`@/features/<feature>/components/Thing`) — the ESLint boundary guard
//  flags that. Inside this feature, import siblings with relative paths
//  (`./components/Thing`). Re-export only what the rest of the app needs;
//  keep everything else internal so you can refactor freely.
//
//  Copy this folder to `src/features/<your-feature>/`, rename, and fill in.
//  See doc/feature-architecture.md for the full convention.
// ─────────────────────────────────────────────────────────────────────────

// export { default as ExampleScreen } from './components/ExampleScreen';
// export type { ExampleProps } from './components/ExampleScreen';

export {};
