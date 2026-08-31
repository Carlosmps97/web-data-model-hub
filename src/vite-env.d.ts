/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Doc 59: assets `?inline` (fuentes embebidas del export) tipados como data URL.
declare module '*.woff2?inline' {
  const dataUrl: string;
  export default dataUrl;
}
