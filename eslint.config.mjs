import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Globales REALES del runtime de Node que ejecuta este config — el mismo que
// corre `server.mjs` (solo `node:*`, sin bundler): process, Buffer, console,
// URL, fetch, timers, etc. Los `.mjs` de la raíz no pasan por typescript-eslint
// (que apaga `no-undef` en TS), así que sin esto `js.configs.recommended`
// marcaba cada global de Node como «not defined». Se toma de `globalThis` en
// vez del paquete `globals`, que hoy solo llega transitivo vía eslint →
// @eslint/eslintrc (no es dependencia declarada del proyecto).
const nodeGlobals = Object.fromEntries(Object.getOwnPropertyNames(globalThis).map((name) => [name, 'readonly']));

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.next', 'scripts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // `server.mjs` / `server.test.mjs` (y este config): módulos ESM de Node puro.
    files: ['*.mjs'],
    languageOptions: { globals: nodeGlobals },
  },
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Guard de límites de feature: importá una feature por su barrel
    // (`@/features/<name>`), nunca su interior. Ver doc/feature-architecture.md.
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['@/features/*/**'],
              message:
                "Importá una feature por su barrel '@/features/<name>', no su ruta interna. Ver doc/feature-architecture.md.",
            },
          ],
        },
      ],
    },
  },
);
