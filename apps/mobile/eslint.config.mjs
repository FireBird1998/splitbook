import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

// ADR 0006: TanStack Query owns display reads only. Its mutations resume paused
// work on their own when the app returns to the foreground or reconnects, and
// the stock persisters' default dehydration saves paused mutations.
const noMutations =
  "TanStack mutations are banned in apps/mobile: financial writes stay in the controller's " +
  'ledgerWrite and its stored attempts, online and explicitly started, and a retry reuses the ' +
  'same idempotency key and revision, so nothing is queued, resumed or replayed (ADR 0006). ' +
  'Use TanStack for display reads and invalidation only.';
const noStockPersister =
  "TanStack's stock persisters are banned in apps/mobile: their default dehydration saves " +
  'paused mutations. Saved copies use the custom persister (ADR 0006).';

export default defineConfig([
  globalIgnores(['node_modules/**', '.expo/**', 'android/**', 'ios/**', 'dist/**']),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['metro.config.js'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // By name, as a namespace import (`import * as`) or as a re-export,
              // from any TanStack package or subpath. QueryClient, QueryObserver,
              // InfiniteQueryObserver, QueriesObserver and the managers stay allowed.
              group: ['@tanstack/*'],
              importNames: [
                'useMutation',
                'useMutationState',
                'useIsMutating',
                'mutationOptions',
                'MutationObserver',
                'MutationCache',
                'Mutation',
              ],
              message: noMutations,
            },
            { group: ['@tanstack/*persist*'], message: noStockPersister },
          ],
        },
      ],
      // QueryClient and MutationCache methods are not exports, so only a property
      // rule can see them.
      'no-restricted-properties': [
        'error',
        { property: 'getMutationCache', message: noMutations },
        { property: 'setMutationDefaults', message: noMutations },
        { property: 'resumePausedMutations', message: noMutations },
      ],
    },
  },
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
