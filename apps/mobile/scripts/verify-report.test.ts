import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { failureReport, observe, present, verifierCommand } from './verify-report';

/** The error a check throws, caught as a verifier's last handler catches it. */
function caught(check: () => void): unknown {
  try {
    check();
  } catch (error) {
    return error;
  }
  throw new Error('The check passed');
}

const COMMAND = 'pnpm --filter @splitbook/mobile run verify:financial';

describe('a failing verifier’s report (#478)', () => {
  it('names the command, then what was expected and what it saw', () => {
    expect(
      failureReport(
        caught(() => assert.equal(500, 200, 'Home balances did not load.')),
        COMMAND,
      ),
    ).toBe(
      [
        'FAIL: Home balances did not load.',
        '  command: pnpm --filter @splitbook/mobile run verify:financial',
        '  expected: 200',
        '  observed: 500',
      ].join('\n'),
    );
  });

  it('shows a snapshot of what it saw when the check is more than one value', () => {
    expect(
      failureReport(
        caught(() =>
          observe(false, 'The Month summary did not describe the full expense window.', {
            count: 22,
            totalAmount: 27,
          }),
        ),
        COMMAND,
      ),
    ).toBe(
      [
        'FAIL: The Month summary did not describe the full expense window.',
        '  command: pnpm --filter @splitbook/mobile run verify:financial',
        '  observed: { count: 22, totalAmount: 27 }',
      ].join('\n'),
    );
  });

  it('compares whole values, such as a list, on one line each', () => {
    expect(
      failureReport(
        caught(() => assert.deepEqual(['Dinner'], ['Dinner', 'Cab'], 'The list lost an Expense.')),
        COMMAND,
      ),
    ).toBe(
      [
        'FAIL: The list lost an Expense.',
        '  command: pnpm --filter @splitbook/mobile run verify:financial',
        "  expected: [ 'Dinner', 'Cab' ]",
        "  observed: [ 'Dinner' ]",
      ].join('\n'),
    );
  });

  it('never prints a cookie, token, secret or password it saw', () => {
    expect(
      failureReport(
        caught(() =>
          observe(false, 'Sign-in did not keep a session.', {
            status: 401,
            cookie: 'better-auth.session_token=fictional',
            headers: { authorization: 'Bearer fictional', 'set-cookie': 'a=b' },
            password: 'fictional',
          }),
        ),
        COMMAND,
      ),
    ).toBe(
      [
        'FAIL: Sign-in did not keep a session.',
        '  command: pnpm --filter @splitbook/mobile run verify:financial',
        "  observed: { status: 401, cookie: '[redacted]', headers: { authorization: '[redacted]', 'set-cookie': '[redacted]' }, password: '[redacted]' }",
      ].join('\n'),
    );
  });

  it('names the command for an error that isn’t a check', () => {
    expect(failureReport(new Error('connect ECONNREFUSED 127.0.0.1:4138'), COMMAND)).toBe(
      [
        'FAIL: connect ECONNREFUSED 127.0.0.1:4138',
        '  command: pnpm --filter @splitbook/mobile run verify:financial',
      ].join('\n'),
    );
  });

  it('can say a fixed summary instead of an unexpected error’s own text, which could hold a URL', () => {
    expect(
      failureReport(
        new Error('request to https://user:secret@example.test failed'),
        COMMAND,
        'Financial verification could not complete. Check the isolated backend.',
      ),
    ).toBe(
      [
        'FAIL: Financial verification could not complete. Check the isolated backend.',
        '  command: pnpm --filter @splitbook/mobile run verify:financial',
      ].join('\n'),
    );
    // A check still says its own message.
    expect(
      failureReport(
        caught(() => assert.equal(1, 2, 'Counts differ.')),
        COMMAND,
        'Never shown.',
      ),
    ).toMatch(/^FAIL: Counts differ\./);
  });

  it('shows the missing value when something that should be there isn’t', () => {
    expect(
      failureReport(
        caught(() => present(null, 'Finish later kept no pending request.')),
        COMMAND,
      ),
    ).toBe(
      [
        'FAIL: Finish later kept no pending request.',
        '  command: pnpm --filter @splitbook/mobile run verify:financial',
        '  observed: null',
      ].join('\n'),
    );
    expect(() => present({ kind: 'create' }, 'Never shown.')).not.toThrow();
  });

  it('passes a check that holds', () => {
    expect(() => observe(true, 'Never shown.', { count: 22 })).not.toThrow();
  });
});

describe('the command a verifier was run with (#478)', () => {
  it('is the package script pnpm ran', () => {
    expect(
      verifierCommand({ npm_lifecycle_event: 'verify:financial' }, [
        'node',
        '/repo/apps/mobile/scripts/verify-financial-views.ts',
      ]),
    ).toBe('pnpm --filter @splitbook/mobile run verify:financial');
  });

  it('is the script itself when it was run directly', () => {
    expect(
      verifierCommand({}, ['node', '/repo/apps/mobile/scripts/verify-financial-views.ts']),
    ).toBe('node --import tsx apps/mobile/scripts/verify-financial-views.ts');
  });
});
