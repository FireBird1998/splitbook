import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Pages must say which account they were rendered for on every API call (#199).
    files: ['src/components/**/*.{ts,tsx}', 'src/app/**/*.tsx'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'Call the app API through apiFetch (@/lib/utils/api-fetch) or fetcher, so the request carries the expected account.',
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Test artifacts
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'playwright*/results/**',
    'playwright*/report/**',
    'output/playwright/**',
  ]),
]);

export default eslintConfig;
