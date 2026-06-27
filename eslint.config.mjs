import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.next', 'scripts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
