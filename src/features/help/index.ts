// Public API of the `help` feature (in-app Help Center + the "?" drawer).
// Import from `@/features/help`; never reach into its subdirectories.
export { default as HelpDrawer } from './components/HelpDrawer';
export { default as HelpCenterScreen } from './components/HelpCenterScreen';
export { ARTICLES, ArticleBody, CATS, catOf, useHelpSearch } from './components/HelpContent';
export type { Article, Block, Cat } from './components/HelpContent';
