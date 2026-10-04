import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

// ADR 0002: this package loads unchanged in the web app, in Node tests and on
// Android, so it imports no framework and touches no DOM.
const noFrameworks =
  '@splitbook/shared stays framework-free so the web app, Node tests and Android load it ' +
  'unchanged (ADR 0002). Keep React, Next, Auth.js, SWR, TanStack, MUI, Emotion, the database ' +
  'drivers, Better Auth, React Native and Expo in the app that needs them.';
const noDom =
  '@splitbook/shared has no DOM (ADR 0002). Pass the value in from the app that reads it.';

// Banned module names, as regex sources. Both the import rule and the
// dynamic import() rule below use them.
const frameworkModules = [
  // These packages and their subpaths, such as react/jsx-runtime, next/navigation,
  // next-auth/react, swr/immutable and better-auth/react.
  '^(?:react|react-dom|next|next-auth|server-only|swr|mongoose|mongodb|bson|better-auth)(?:/.*)?$',
  '^@(?:next|auth|tanstack|mui|emotion|better-auth)/',
  // React Native and its family, scoped or not: react-native, react-native-*,
  // @react-native-community/*.
  '^@?react-native(?:$|[-/])',
  // Every name that starts with expo or @expo (expo, expo-sqlite, expokit,
  // @expo/vector-icons), except exponential-backoff, which is not an Expo package.
  '^@?expo(?!nential-backoff(?:$|/))',
];

export default defineConfig([
  globalIgnores(['node_modules/**']),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: frameworkModules.map((regex) => ({ regex, message: noFrameworks })) },
      ],
      // no-restricted-imports does not see import(), so the same names are
      // banned there through the AST.
      'no-restricted-syntax': [
        'error',
        ...frameworkModules.map((regex) => ({
          selector: `ImportExpression[source.value=/${regex.replaceAll('/', '\\/')}/]`,
          message: noFrameworks,
        })),
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
