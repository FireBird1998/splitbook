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
  host.getSourceFile = (name, version) => name === filename
    ? ts.createSourceFile(name, source, version, true) : getSourceFile(name, version);
  const program = ts.createProgram([filename], options, host);
  return new Linter({cwd: '/virtual'}).verify(source, [{
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: {programs: [program]} },
    plugins: { 'expense-entry': entryTranslationPlugin },
    rules: {'expense-entry/no-local-reading': 'error'},
  }], {filename});
}

it('refuses a form that turns typed payer text into command rows', () => {
  const messages = check(`
    function save(entry: {payerId: string; amount: string}) {
      return {paidBy: [{user: entry.payerId, amount: Number(entry.amount)}]};
    }
  `);
  expect(messages).toMatchObject([{ruleId: 'expense-entry/no-local-reading', messageId: 'useReading'}]);
});
