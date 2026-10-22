// Fuentes del export SVG/HTML embebidas como data URLs (subset latin de
// Geist/Geist Mono variable, ~30KB c/u): el archivo exportado se ve igual sin
// conexión ni fuentes instaladas. Vive en un módulo aparte (imports `?inline`
// de Vite) para no ensuciar la pureza testeable de sceneSvg. El PDF no las usa:
// va con fuentes core (scenePdf.ts).
import geist from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline';
import geistMono from '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?inline';

export const EXPORT_FONT_CSS = [
  `@font-face { font-family: 'Geist Variable'; font-style: normal; font-weight: 100 900; src: url(${geist}) format('woff2-variations'); }`,
  `@font-face { font-family: 'Geist Mono Variable'; font-style: normal; font-weight: 100 900; src: url(${geistMono}) format('woff2-variations'); }`,
].join('\n');
