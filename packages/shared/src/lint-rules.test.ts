import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// Drives packages/shared's own flat config through ESLint's Node API, so each
// sample gets exactly what `pnpm lint` does to a file in this package. Vitest
// runs from packages/shared, which is where ESLint looks up its config.
let eslint: ESLint;

beforeAll(async () => {
  eslint = new ESLint();
  expect(await eslint.findConfigFile()).toMatch(/packages[\\/]shared[\\/]eslint\.config\.mjs$/);
});

async function lint(code: string, filePath = 'src/lint-sample.ts') {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages;
}

const ruleIds = (messages: Awaited<ReturnType<typeof lint>>) =>
  messages.map((message) => message.ruleId);

const FRAMEWORK_IMPORTS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'next',
  'next/navigation',
  'next/server',
  '@next/env',
  'server-only',
  'next-auth',
  'next-auth/react',
  '@auth/core',
  '@auth/mongodb-adapter',
  'swr',
  'swr/immutable',
  '@tanstack/react-query',
  '@tanstack/query-core',
  '@mui/material',
  '@mui/material/Box',
  '@emotion/react',
  '@emotion/styled',
  'mongoose',
  'mongodb',
  'bson',
  'better-auth',
  'better-auth/react',
  '@better-auth/expo',
  'react-native',
  'react-native-safe-area-context',
  '@react-native-community/netinfo',
  'expo',
  'expo/fetch',
  'expo-sqlite',
  'expo-secure-store',
  'expokit',
  '@expo/vector-icons',
];

const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
];

function expectBoundary(messages: Awaited<ReturnType<typeof lint>>, ruleId: string) {
  expect(ruleIds(messages)).toEqual([ruleId]);
  expect(messages[0].message).toContain('ADR 0002');
}

describe('no framework imports in @splitbook/shared', () => {
  it.each(FRAMEWORK_IMPORTS)('rejects importing %s', async (source) => {
    expectBoundary(await lint(`import '${source}';\n`), 'no-restricted-imports');
  });

  it.each([
    ['a named import', `import { useState } from 'react';\nexport const hook = useState;\n`],
    [
      'a type-only import',
      `import type { NextRequest } from 'next/server';\nexport type Incoming = NextRequest;\n`,
    ],
    ['a re-export', `export { default as useSWR } from 'swr';\n`],
    ['a star re-export', `export * from '@mui/material';\n`],
  ])('rejects %s', async (_form, code) => {
    expectBoundary(await lint(code), 'no-restricted-imports');
  });

  it('rejects a framework import in a test file', async () => {
    expectBoundary(
      await lint(`import 'react';\n`, 'src/lint-sample.test.ts'),
      'no-restricted-imports',
    );
  });

  it.each(FRAMEWORK_IMPORTS)('rejects a dynamic import of %s', async (source) => {
    expectBoundary(
      await lint(`export const load = () => import('${source}');\n`),
      'no-restricted-syntax',
    );
  });

  it('rejects an awaited dynamic import read for one export', async () => {
    expectBoundary(
      await lint(`export const load = async () => (await import('next/navigation')).useRouter;\n`),
      'no-restricted-syntax',
    );
  });
});

describe('no DOM globals in @splitbook/shared', () => {
  it.each(DOM_GLOBALS)('rejects %s', async (name) => {
    expectBoundary(await lint(`export const read = () => ${name};\n`), 'no-restricted-globals');
  });

  it('rejects a typeof check on a DOM global', async () => {
    expectBoundary(
      await lint(`export const inBrowser = typeof window !== 'undefined';\n`),
      'no-restricted-globals',
    );
  });
});

describe('the domain package keeps its own imports', () => {
  it.each([
    ['zod', `import { z } from 'zod';\nexport const name = z.string();\n`],
    ['zod/v4', `import { z } from 'zod/v4';\nexport const name = z.string();\n`],
    [
      'date-fns',
      `import { addDays } from 'date-fns';\nexport const later = addDays(new Date(0), 1);\n`,
    ],
    [
      'relative imports',
      `import { formatMoney } from './money';\nimport type { Expense } from './types';\nexport const format = formatMoney;\nexport type Row = Expense;\n`,
    ],
    ['exponential-backoff, which only shares the expo prefix', `import 'exponential-backoff';\n`],
    ['a subpath of exponential-backoff', `import 'exponential-backoff/dist/backoff';\n`],
    [
      'dynamic imports of zod and of local modules',
      `export const loadZod = () => import('zod');\nexport const loadMoney = () => import('./money');\nexport const loadBackoff = () => import('exponential-backoff');\n`,
    ],
    [
      'a local binding named like a DOM global',
      `export const describeStop = (location: string) => location.trim();\n`,
    ],
  ])('allows %s', async (_surface, code) => {
    expect(await lint(code)).toEqual([]);
  });

  it('allows vitest in a test file', async () => {
    const messages = await lint(
      `import { describe, expect, it } from 'vitest';
describe('sum', () => {
  it('adds', () => {
    expect(1 + 1).toBe(2);
  });
});
`,
      'src/lint-sample.test.ts',
    );
    expect(messages).toEqual([]);
  });
});
