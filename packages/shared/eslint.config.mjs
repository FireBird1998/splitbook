import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

// ADR 0002: this package loads unchanged in the web app, in Node tests and on
// Android, so it imports no framework and touches no DOM.
const noFrameworks =
  '@splitbook/shared stays framework-free so the web app, Node tests and Android load it ' +
  'unchanged (ADR 0002). Keep React, Next, SWR, TanStack, MUI, the database drivers, Better ' +
  'Auth, React Native and Expo in the app that needs them.';
const noDom =
  '@splitbook/shared has no DOM (ADR 0002). Pass the value in from the app that reads it.';

export default defineConfig([
  globalIgnores(['node_modules/**']),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            // These packages and their subpaths, such as react/jsx-runtime,
            // next/navigation, swr/immutable and better-auth/react.
            {
              regex: '^(?:react|react-dom|next|swr|mongoose|mongodb|better-auth)(?:/.*)?$',
              message: noFrameworks,
            },
            { regex: '^@(?:tanstack|mui|better-auth)/', message: noFrameworks },
            // Every React Native and Expo package, scoped or not: react-native,
            // react-native-*, @react-native-community/*, expo, expo-sqlite,
            // @expo/vector-icons.
            { regex: '^@?(?:react-native|expo)(?:$|[-/])', message: noFrameworks },
          ],
        },
      ],
      // Typecheck stays the main DOM guard (tsconfig.json has no DOM lib): a DOM
      // name reached through globalThis gets past this rule but not past tsc.
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage'].map(
          (name) => ({ name, message: noDom }),
        ),
      ],
    },
  },
]);
