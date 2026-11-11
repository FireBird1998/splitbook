import { expect, it } from 'vitest';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import ts from 'typescript';
import { entryTranslationPlugin } from '../eslint/expense-entry.mjs';

/** The public lint diagnostic, with the same typed parser used by the workspace. */
function check(source: string, path = 'apps/web/src/components/ExpenseForm.ts') {
  const filename = '/virtual/' + path;
  const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ES2022 };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version) =>
    name === filename
      ? ts.createSourceFile(name, source, version, true)
      : getSourceFile(name, version);
  const program = ts.createProgram([filename], options, host);
  return new Linter({ cwd: '/virtual' }).verify(
    source,
    [
      {
        files: ['**/*.{ts,tsx}'],
        languageOptions: { parser: tseslint.parser, parserOptions: { programs: [program] } },
        plugins: { 'expense-entry': entryTranslationPlugin },
        rules: { 'expense-entry/no-local-reading': 'error' },
      },
    ],
    { filename },
  );
}

it('refuses a form that turns typed payer text into command rows', () => {
  const messages = check(`
    function save(entry: {payerId: string; amount: string}) {
      return {paidBy: [{user: entry.payerId, amount: Number(entry.amount)}]};
    }
  `);
  expect(messages).toMatchObject([
    { ruleId: 'expense-entry/no-local-reading', messageId: 'useReading' },
  ]);
});

it('follows a locally named amount and row list instead of depending on variable names', () => {
  expect(
    check(`
    function save(amount: string) {
      const entered = Number(amount);
      const rows = [{user: 'a', amount: entered}];
      return {paidBy: rows};
    }
  `),
  ).toMatchObject([{ messageId: 'useReading' }]);
});
it('follows a map callback that builds percentage rows', () => {
  expect(
    check(`
    function row(person: {user: string; value: string}) {return {user: person.user, percentage: Number(person.value)};}
    function save(people: {user: string; value: string}[]) {return {splitBetween: people.map(row)};}
  `),
  ).toMatchObject([{ messageId: 'useReading' }]);
});

it.each(['paidBy', 'splitBetween'])(
  'refuses assigning typed rows to %s after creating a command',
  (field) => {
    expect(
      check(`
    function save(rows: {user: string; amount: string}[]) {
      const command: Record<string, unknown> = {};
      command.${field} = rows;
      return command;
    }
  `),
    ).toMatchObject([{ messageId: 'useReading' }]);
  },
);
it('refuses shorthand typed rows', () => {
  expect(
    check(`function save(paidBy: {user: string; amount: string}[]) {return {paidBy};}`),
  ).toMatchObject([{ messageId: 'useReading' }]);
});
it('permits forwarding and projecting already-read numeric money, including optional weights', () => {
  expect(
    check(`
    function save(rows: {user: string | null; amount: number; percentage?: number; shares?: number}[]) {
      const paidBy = rows.map((row, index) => ({...row, user: row.user ?? 'former-' + index}));
      return {paidBy, splitBetween: rows.map(row => ({user: row.user, amount: row.amount}))};
    }
  `),
  ).toEqual([]);
});
it.each([
  'packages/shared/src/expense-entry.ts',
  'packages/shared/src/expense-entry-draft.ts',
  'packages/shared/src/validators/expense.ts',
  'apps/web/scripts/seed.ts',
  'apps/mobile/src/test-utils/world.ts',
  'apps/web/src/components/Form.test.ts',
])('permits the reviewed owner or fixture at %s', (path) => {
  expect(
    check(
      `function save(amount: string) {return {paidBy: [{user: 'a', amount: Number(amount)}]};}`,
      path,
    ),
  ).toEqual([]);
});

it('is enabled for a production form by each package lint command', async () => {
  const { ESLint } = await import('eslint');
  const { fileURLToPath } = await import('node:url');
  for (const [directory, form] of [
    ['../../../apps/mobile/', 'src/data/expense-draft.ts'],
    ['../../../apps/web/', 'src/components/expenses/ExpenseFields.tsx'],
    ['../', 'src/expense-draft.ts'],
  ]) {
    const eslint = new ESLint({ cwd: fileURLToPath(new URL(directory, import.meta.url)) });
    const config = await eslint.calculateConfigForFile(form);
    expect(config.rules['expense-entry/no-local-reading']).toEqual([2]);
  }
});
