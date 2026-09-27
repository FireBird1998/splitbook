import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['node_modules/**', '.expo/**', 'android/**', 'ios/**', 'dist/**']),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['metro.config.js'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  {
    languageOptions: {
      globals: {
        __DEV__: 'readonly',
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        AbortController: 'readonly',
        fetch: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        __dirname: 'readonly',
        module: 'readonly',
        require: 'readonly',
      },
    },
  },
]);
