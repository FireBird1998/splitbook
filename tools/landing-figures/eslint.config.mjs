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
    // A figure's live tour runs in the page after the kit is inlined, with its data spliced in for
    // __DATA__ (see the preview command; the web app's client component takes the same data).
    files: ['src/figures/*.tour.js'],
    languageOptions: {
      globals: {
        __DATA__: 'readonly',
        document: 'readonly',
        matchMedia: 'readonly',
        requestAnimationFrame: 'readonly',
        IntersectionObserver: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        translateAlong: 'readonly',
        lineOnTop: 'readonly',
        axisVector: 'readonly',
        holdStill: 'readonly',
      },
    },
  },
]);
