import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  // The vendored anatomy kit is third-party code kept as published.
  globalIgnores(['node_modules/**', 'vendor/**']),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    // A figure's live tour runs in the browser: the generator bundles it for the web app and the
    // preview pages.
    files: ['src/figures/*.tour.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        IntersectionObserver: 'readonly',
      },
    },
  },
]);
