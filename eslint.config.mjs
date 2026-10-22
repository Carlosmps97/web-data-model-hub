import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Globales reales del runtime de Node que ejecuta este config, el mismo que
// corre `server.mjs` (solo `node:*`, sin bundler): process, Buffer, console,
// URL, fetch, timers, etc. Los `.mjs` de la raíz no pasan por typescript-eslint
// (que apaga `no-undef` en TS), así que sin esto `js.configs.recommended`
// marcaría cada global de Node como «not defined». Se toma de `globalThis` en
// vez del paquete `globals`, que solo llega como dependencia transitiva de
// eslint → @eslint/eslintrc (no es dependencia declarada del proyecto).
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
    // Guarda de límites de feature: una feature se importa por su barrel
    // (`@/features/<name>`), nunca por su ruta interna. Ver
    // docs/03-estructura-del-proyecto.md.
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['@/features/*/**'],
              message:
                "Una feature se importa por su barrel '@/features/<name>', no por su ruta interna. Ver docs/03-estructura-del-proyecto.md.",
            },
          ],
        },
      ],
    },
  },
);
