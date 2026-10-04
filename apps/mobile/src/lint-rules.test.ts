import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// Drives apps/mobile's own flat config through ESLint's Node API, so each sample
// gets exactly what `pnpm lint` does to a file in this package. Vitest runs from
// apps/mobile, which is where ESLint looks up its config.
let eslint: ESLint;

beforeAll(async () => {
  eslint = new ESLint();
  expect(await eslint.findConfigFile()).toMatch(/apps[\\/]mobile[\\/]eslint\.config\.mjs$/);
});

async function lint(code: string, filePath = 'src/lint-sample.ts') {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages;
}

const ruleIds = (messages: Awaited<ReturnType<typeof lint>>) =>
  messages.map((message) => message.ruleId);

const MUTATION_NAMES = [
  'useMutation',
  'useMutationState',
  'useIsMutating',
  'mutationOptions',
  'MutationObserver',
  'MutationCache',
  'Mutation',
];
const TANSTACK_SOURCES = ['@tanstack/react-query', '@tanstack/query-core'];
const MUTATION_IMPORTS = TANSTACK_SOURCES.flatMap((source) =>
  MUTATION_NAMES.map((name) => [name, source] as const),
);

const PERSISTERS = [
  '@tanstack/query-persist-client-core',
  '@tanstack/react-query-persist-client',
  '@tanstack/query-async-storage-persister',
  '@tanstack/query-sync-storage-persister',
];

const READ_APIS = [
  'QueryClient',
  'QueryObserver',
  'InfiniteQueryObserver',
  'QueriesObserver',
  'focusManager',
  'onlineManager',
  'notifyManager',
];

const queryClientSource = `import { QueryClient } from '@tanstack/query-core';
const client = new QueryClient();
`;

function expectMutationBan(messages: Awaited<ReturnType<typeof lint>>, ruleId: string) {
  expect(ruleIds(messages)).toEqual([ruleId]);
  expect(messages[0].message).toContain('financial writes stay in the controller');
  expect(messages[0].message).toContain('ADR 0006');
}

describe('no TanStack mutations in apps/mobile', () => {
  it.each(MUTATION_IMPORTS)('rejects importing %s from %s by name', async (name, source) => {
    const messages = await lint(`import { ${name} } from '${source}';
export const surface = ${name};
`);
    expectMutationBan(messages, 'no-restricted-imports');
  });

  it.each(MUTATION_IMPORTS)('rejects re-exporting %s from %s', async (name, source) => {
    expectMutationBan(
      await lint(`export { ${name} } from '${source}';\n`),
      'no-restricted-imports',
    );
  });

  it.each(TANSTACK_SOURCES)('rejects a namespace import of %s', async (source) => {
    const messages = await lint(`import * as tanstack from '${source}';
export const surface = tanstack;
`);
    expectMutationBan(messages, 'no-restricted-imports');
  });

  it.each([
    [
      'an aliased import',
      `import { useMutation as useWrite } from '@tanstack/react-query';\nexport const surface = useWrite;\n`,
    ],
    [
      'a type-only import',
      `import type { MutationCache } from '@tanstack/query-core';\nexport type Cache = MutationCache;\n`,
    ],
    ['a star re-export', `export * from '@tanstack/query-core';\n`],
    ['a namespace re-export', `export * as tanstack from '@tanstack/react-query';\n`],
    [
      'a subpath import',
      `import { MutationObserver } from '@tanstack/query-core/build/modern/index.js';\nexport const surface = MutationObserver;\n`,
    ],
  ])('rejects %s', async (_form, code) => {
    expectMutationBan(await lint(code), 'no-restricted-imports');
  });

  it.each(['src/data/sample-controller.ts', 'src/ui/sample-screen.tsx', 'scripts/sample.ts'])(
    'applies to %s',
    async (filePath) => {
      const messages = await lint(
        `import { useMutation } from '@tanstack/react-query';\nexport const surface = useMutation;\n`,
        filePath,
      );
      expectMutationBan(messages, 'no-restricted-imports');
    },
  );

  it.each([
    [
      'a destructured dynamic import',
      `export const load = async () => {
  const { MutationObserver } = await import('@tanstack/query-core');
  return MutationObserver;
};
`,
    ],
    [
      'a dynamic import read in a then callback',
      `export const load = () => import('@tanstack/react-query').then((m) => m.useMutation);\n`,
    ],
    [
      'a dynamic import of a read API, since TanStack is imported statically',
      `export const load = () => import('@tanstack/query-core').then((m) => m.QueryClient);\n`,
    ],
    [
      'a dynamic import of a persister',
      `export const load = () => import('@tanstack/query-persist-client-core');\n`,
    ],
  ])('rejects %s', async (_form, code) => {
    expectMutationBan(await lint(code), 'no-restricted-syntax');
  });
});

describe('no stock TanStack persisters in apps/mobile', () => {
  it.each(PERSISTERS)('rejects importing %s', async (source) => {
    const messages = await lint(`import '${source}';\n`);
    expect(ruleIds(messages)).toEqual(['no-restricted-imports']);
    expect(messages[0].message).toContain('saves paused mutations');
    expect(messages[0].message).toContain("signed-out account's data back");
    expect(messages[0].message).toContain('custom persister');
    expect(messages[0].message).toContain('ADR 0006');
  });

  it.each(PERSISTERS)('rejects a subpath of %s', async (source) => {
    const messages = await lint(`import '${source}/build/modern/index.js';\n`);
    expect(ruleIds(messages)).toEqual(['no-restricted-imports']);
  });

  it('rejects a named import of a persister', async () => {
    const messages =
      await lint(`import { persistQueryClient } from '@tanstack/query-persist-client-core';
export const persist = persistQueryClient;
`);
    expect(ruleIds(messages)).toEqual(['no-restricted-imports']);
  });
});

describe('no QueryClient mutation methods in apps/mobile', () => {
  it.each([
    ['getMutationCache', `${queryClientSource}export const cache = client.getMutationCache();\n`],
    ['setMutationDefaults', `${queryClientSource}client.setMutationDefaults(['ledger'], {});\n`],
    [
      'resumePausedMutations',
      `${queryClientSource}export const resumed = client.resumePausedMutations();\n`,
    ],
    [
      'a destructured method',
      `${queryClientSource}export const { resumePausedMutations } = client;\n`,
    ],
    [
      'a computed optional call',
      `${queryClientSource}export const cache = client?.['getMutationCache']();\n`,
    ],
  ])('rejects %s', async (_surface, code) => {
    expectMutationBan(await lint(code), 'no-restricted-properties');
  });
});

describe('TanStack read APIs stay allowed in apps/mobile', () => {
  it.each(READ_APIS)('allows importing %s from @tanstack/query-core', async (name) => {
    const messages = await lint(`import { ${name} } from '@tanstack/query-core';
export const surface = ${name};
`);
    expect(messages).toEqual([]);
  });

  it('allows re-exporting every read API together', async () => {
    expect(await lint(`export { ${READ_APIS.join(', ')} } from '@tanstack/query-core';\n`)).toEqual(
      [],
    );
  });

  it('allows display reads and invalidation after a write', async () => {
    const messages =
      await lint(`${queryClientSource}export const refresh = () => client.invalidateQueries({ queryKey: ['groups'] });
export const cached = client.getQueryData(['groups']);
export const queries = client.getQueryCache();
`);
    expect(messages).toEqual([]);
  });
});
