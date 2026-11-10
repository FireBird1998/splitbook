import { describe, expect, it } from 'vitest';
import { checkRefusalSources } from './refusal-contract.ts';

const file = (source: string, path = 'apps/web/src/lib/services/example.ts') => ({ path, source });
describe('the refusal source contract', () => {
  it('rejects a plain code and explains the replacement', () => {
    expect(checkRefusalSources([file("throw new Error('SOME_CODE');")])).toMatchObject([
      {
        path: 'apps/web/src/lib/services/example.ts',
        code: 'SOME_CODE',
        message: expect.stringContaining('new Refusal(code)'),
      },
    ]);
  });
  it('allows ordinary fault words and excludes tests and fixtures', () => {
    expect(
      checkRefusalSources([
        file("throw new Error('Database connection failed');"),
        file("throw new Error('SOME_CODE');", 'apps/web/src/lib/example.test.ts'),
        file("throw new Error('SOME_CODE');", 'apps/web/src/lib/test-utils/legacy.ts'),
        file("throw new Error('SOME_CODE');", 'packages/shared/src/fixtures/legacy.ts'),
      ]),
    ).toEqual([]);
  });
  it('permits only the reviewed guard and detects a stale exception', () => {
    const allowed = [
      {
        path: 'apps/web/src/lib/services/example.ts',
        code: 'SOME_CODE',
        when: '!valid',
        reason: 'Trusted state must already be valid.',
      },
    ];
    expect(
      checkRefusalSources([file("if (!valid) throw new Error('SOME_CODE');")], allowed),
    ).toEqual([]);
    expect(
      checkRefusalSources([file("if (!other) throw new Error('SOME_CODE');")], allowed),
    ).toHaveLength(2);
  });
});

it.each([
  "const CODE = 'SOME_CODE'; const alias = CODE; throw new Error(alias);",
  "const NativeError = Error; const CODE = enabled ? 'FIRST_CODE' : 'SECOND_CODE'; throw new NativeError(CODE);",
  'throw Error(`SOME_CODE`);',
])('finds code and constructor aliases (%s)', (source) => {
  expect(
    checkRefusalSources([file(source)]).some(
      (finding) => finding.code === 'SOME_CODE' || finding.code === 'FIRST_CODE',
    ),
  ).toBe(true);
});
it('follows imported aliases and ignores shadowed Error constructors', () => {
  expect(
    checkRefusalSources([
      file(
        "export const DENIED = 'SOME_CODE'; export const Native = Error;",
        'packages/shared/src/codes.ts',
      ),
      file(
        "import {DENIED as code, Native as Fault} from '@splitbook/shared/codes'; throw new Fault(code);",
      ),
    ]),
  ).toHaveLength(1);
  expect(checkRefusalSources([file("class Error {} ; throw new Error('SOME_CODE');")])).toEqual([]);
});
it.each([
  "try {} catch (caught) { const alias = caught; const {message: text} = alias; if (text === 'SOME_CODE') return; }",
  "try {} catch (caught) { if (['SOME_CODE'].includes(caught.message)) return; }",
  "try {} catch (caught) { const words = {SOME_CODE: 'words'}; if (caught.message in words) return; }",
  "try {} catch (caught) { const words = {SOME_CODE: 'words'}; if (words[caught.message]) return; }",
  "try {} catch (caught) { switch(caught.message) { case 'SOME_CODE': return; } }",
])('rejects caught message dispatch (%s)', (source) => {
  expect(
    checkRefusalSources([file(source, 'apps/web/src/app/api/example/route.ts')]),
  ).toMatchObject([{ message: expect.stringContaining('serverError(cause)') }]);
});
it('follows a caught value into a route helper but leaves schema issues alone', () => {
  expect(
    checkRefusalSources([
      file(
        "import { reply } from '@/lib/reply'; try {} catch (caught) { reply(caught); }",
        'apps/web/src/app/api/example/route.ts',
      ),
      file(
        "export function reply(cause: unknown) { if ((cause as Error).message === 'SOME_CODE') return; }",
        'apps/web/src/lib/reply.ts',
      ),
    ]),
  ).toHaveLength(1);
  expect(
    checkRefusalSources([
      file(
        "const issue = {message:'SOME_CODE'}; if (issue.message === 'SOME_CODE') return;",
        'apps/web/src/app/api/example/route.ts',
      ),
    ]),
  ).toEqual([]);
});
it.each([
  "let Fault; Fault = Error; let code; code = 'SOME_CODE'; throw new Fault(code);",
  "function fail(code: 'FIRST_CODE' | 'SECOND_CODE') { throw new Error(code); }",
])('finds assigned aliases and literal parameter types (%s)', (source) => {
  expect(checkRefusalSources([file(source)])).not.toEqual([]);
});
it('finds a destructured Promise rejection message', () => {
  expect(
    checkRefusalSources([
      file(
        "promise.catch(({message: text}) => text === 'SOME_CODE');",
        'apps/web/src/app/api/example/route.ts',
      ),
    ]),
  ).toHaveLength(1);
});
it.each([
  "const codes = {denied: 'SOME_CODE'}; throw new Error(codes.denied);",
  "const {denied} = {denied: 'SOME_CODE'}; throw new Error(denied);",
  "const {Fault} = {Fault: Error}; throw new Fault('SOME_CODE');",
])('finds property and destructured aliases (%s)', (source) => {
  expect(checkRefusalSources([file(source)])).toHaveLength(1);
});
it('follows conditional caught-value and message aliases', () => {
  expect(
    checkRefusalSources([
      file(
        "try {} catch (cause) { const err = flag ? cause : cause; const text = flag ? err.message : err.message; if (text === 'SOME_CODE') return; }",
        'apps/web/src/app/api/example/route.ts',
      ),
    ]),
  ).toHaveLength(1);
});
it('enforces the contract inside the central answering function too', () => {
  expect(
    checkRefusalSources([
      file(
        "export function serverError(cause: Error) { if(cause.message === 'SOME_CODE') return; }",
        'apps/web/src/lib/utils/api-response.ts',
      ),
      file(
        "import {serverError} from '@/lib/utils/api-response';",
        'apps/web/src/app/api/example/route.ts',
      ),
    ]),
  ).toHaveLength(1);
});
