import { expect, it } from 'vitest';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import ts from 'typescript';
import { entryExceptions, entryTranslationPlugin } from '../eslint/expense-entry.mjs';

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
    function major(minor: number, currency: string) {return currency === 'JPY' ? minor : minor / 100;}
    function save(rows: {user: string | null; amount: number; percentage?: number; shares?: number}[]) {
      const paidBy = rows.map((row, index) => ({...row, user: row.user ?? 'former-' + index}));
      return {paidBy, splitBetween: rows.map(row => ({user: row.user, amount: major(row.amount, 'INR')}))};
    }
  `),
  ).toEqual([]);
});
// Every documented exception must have a public diagnostic contract. Adding an exception
// without its representative fails here, so the scope and its explanation cannot drift silently.
const exceptionFiles: Record<string, string> = {
  '**/*.{test,spec}.{ts,tsx}': 'apps/web/src/components/Form.test.ts',
  '**/{test-utils,test-support,fixtures,__fixtures__,__mocks__}/**':
    'apps/mobile/src/test-utils/world.ts',
  '**/scripts/**': 'apps/web/scripts/seed.ts',
  'packages/shared/src/expense-entry.ts': 'packages/shared/src/expense-entry.ts',
  'packages/shared/src/expense-entry-draft.ts': 'packages/shared/src/expense-entry-draft.ts',
  'packages/shared/src/exact-money.ts': 'packages/shared/src/exact-money.ts',
  'packages/shared/src/expense-money-edit.ts': 'packages/shared/src/expense-money-edit.ts',
  'packages/shared/src/validators/**': 'packages/shared/src/validators/expense.ts',
};
it.each(entryExceptions)('permits the documented owner or fixture: $path', ({ path }) => {
  const filename = exceptionFiles[path];
  expect(filename).toBeDefined();
  expect(
    check(
      `function save(amount: string) {return {paidBy: [{user: 'a', amount: Number(amount)}]};}`,
      filename,
    ),
  ).toEqual([]);
});

it('refuses conversion hidden in a scalar helper', () => {
  expect(
    check(`
    function amount(entry: {amount: string}) {return Number(entry.amount);}
    function save(entry: {amount: string}) {return {paidBy: [{user: 'a', amount: amount(entry)}]};}
  `),
  ).toMatchObject([{ messageId: 'useReading' }]);
});
it.each([
  `rows.push({user: 'a', amount: Number(entry.amount)});`,
  `rows[0] = {user: 'a', amount: Number(entry.amount)};`,
])('refuses a typed row added after initializing the collection: %s', (mutation) => {
  expect(
    check(`
    function save(entry: {amount: string}) {
      const rows: {user: string; amount: number}[] = [];
      ${mutation}
      return {paidBy: rows};
    }
  `),
  ).toMatchObject([{ messageId: 'useReading' }]);
});

it.each([
  `(entry: {amount: string}) => Number(entry.amount)`,
  `function(entry: {amount: string}) {return Number(entry.amount);}`,
])('refuses conversion hidden in a scalar function value: %s', (helper) => {
  expect(
    check(
      `const amount = ${helper}; function save(entry: {amount: string}) {return {paidBy: [{user: 'a', amount: amount(entry)}]};}`,
    ),
  ).toMatchObject([{ messageId: 'useReading' }]);
});
it('follows a mutated collection through a shorthand command property', () => {
  expect(
    check(`function save(entry: {amount: string}) {
    const paidBy: {user: string; amount: number}[] = [];
    paidBy.push({user: 'a', amount: Number(entry.amount)});
    return {paidBy};
  }`),
  ).toMatchObject([{ messageId: 'useReading' }]);
});
