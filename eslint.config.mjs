import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Feature-boundary guard: code must import a feature through its public
  // barrel (`@/features/<name>`), never reach into its internals
  // (`@/features/<name>/components/...`). A feature imports its OWN files via
  // relative paths. See doc/feature-architecture.md. Warning-only for now.
  {
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              group: ["@/features/*/**"],
              message:
                "Import a feature via its barrel '@/features/<name>', not its internal path. Use relative paths inside the same feature. See doc/feature-architecture.md.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
