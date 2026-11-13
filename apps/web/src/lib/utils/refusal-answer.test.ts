import { describe, expect, it, vi } from 'vitest';
import { Refusal } from '@splitbook/shared/refusals';
import { serverError } from './api-response';
vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));

describe('serverError answers typed refusals', () => {
  it('answers the payment authorization refusal with its words', async () => {
    const answer = serverError(new Refusal('FORBIDDEN_SETTLEMENT'));
    expect(answer.status).toBe(422);
    expect(await answer.text()).toBe(
      '{"error":"Only the payer or recipient can record this payment","status":422,"code":"FORBIDDEN_SETTLEMENT"}',
    );
  });
  it('codes the last-admin removal answer', async () => {
    const answer = serverError(new Refusal('LAST_ADMIN', { variant: 'removal' }));
    expect(answer.status).toBe(409);
    expect(await answer.text()).toBe(
      '{"error":"Cannot remove the last admin.","status":409,"code":"LAST_ADMIN"}',
    );
  });
  it('answers data carried by a currency refusal', async () => {
    const answer = serverError(
      new Refusal('CURRENCY_IN_USE', {
        currency: 'EUR',
        groupName: 'Maple House',
        use: {
          expenses: { count: 2, items: [] },
          settlements: 1,
          toReview: { yours: 1, others: 0 },
        },
      }),
    );
    expect(answer.status).toBe(409);
    expect(await answer.text()).toBe(
      '{"error":"EUR can’t be removed while Maple House uses it.","status":409,"code":"CURRENCY_IN_USE","use":{"expenses":{"count":2,"items":[]},"settlements":1,"toReview":{"yours":1,"others":0}}}',
    );
  });
  it('keeps the plain-error fallback while new callers can use the vocabulary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(serverError(new Error('LAST_ADMIN')).status).toBe(500);
    expect(serverError(new Refusal('LAST_ADMIN')).status).toBe(409);
  });
});

// Original census answers with the approved #1086 corrections. Every wording is covered.
import cases from './refusal-vocabulary-answers.json';
import { refusalVocabulary } from '@splitbook/shared/refusals';

it.each([...cases, ...draftAnswers])(
  'keeps $code / $variant byte for byte',
  async ({ code, data, status, body }) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const answer = serverError(
      new Refusal(code as ConstructorParameters<typeof Refusal>[0], data as never),
    );
    expect(answer.status).toBe(status);
    expect(await answer.text()).toBe(body);
  },
);
it('has exactly the census codes and a recorded answer for every named variant', () => {
  expect(
    [
      ...new Set([...cases.map(({ code }) => code), ...inputs.moneyCases.map(({ code }) => code)]),
    ].sort(),
  ).toEqual(Object.keys(refusalVocabulary).sort());
  for (const [code, entry] of Object.entries(refusalVocabulary)) {
    const covered = [...cases, ...draftAnswers]
      .filter((row) => row.code === code)
      .map((row) => row.variant);
    if ('words' in entry) expect(covered).toContain('default');
    else expect(entry.moneyWords).toBe('from-rule');
    for (const variant of Object.keys(entry.variants)) expect(covered, code).toContain(variant);
  }
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import inputs from '../refusal-census-inputs.json';
it('uses only answers and codes recorded by the corrected census', () => {
  const baseline = ['refusal-census.test.ts.snap', 'refusal-census-other.test.ts.snap']
    .map((file) => readFileSync(resolve('src/lib/__snapshots__', file), 'utf8'))
    .join('\n');
  for (const { body } of cases) expect(baseline).toContain(`"body": "${body}",`);
  const recordedCodes = new Set([
    ...inputs.plainCodes,
    ...inputs.moneyCases.map(({ code }) => code),
    'TAG_PRECONDITION_REQUIRED',
    'INVALID_TAG_COMMAND',
    'TAG_ADMIN_REQUIRED',
    'TAG_TRANSACTIONS_REQUIRED',
    'TAG_CHANGED',
    'TAG_EXISTS',
    'LAST_ACTIVE_TAG',
    'REQUEST_KEY_REUSED',
    'TAG_IN_USE',
    'AMBIGUOUS_TAG',
    'CURRENCY_IN_USE',
    'CURRENCY_NOT_LISTED',
    'CURRENCY_IS_MAIN',
    'OPEN_BALANCE',
    'RECURRING_EXPENSE_PROBLEM',
    'EXPORT_TOO_LARGE',
    'DATABASE_UNAVAILABLE',
  ]);
  for (const code of ['BACKUP_ALL_TIME', 'INVALID_REQUEST_FINGERPRINT', 'GROUP_NOT_FOUND'])
    recordedCodes.delete(code);
  for (const code of [
    'DRAFT_UNCONFIRMED',
    'UNAUTHORIZED',
    'NOT_FOUND',
    'NOTIFICATION_SETTINGS_CHANGED',
    'NOTIFICATION_TOKEN_REQUIRED',
    'NOTIFICATIONS_UNAVAILABLE',
    'INVALID_MONTH',
    'INVALID_COMPARE',
    'INVALID_MONTHS',
    'INVALID_TIME_ZONE',
    'QUERY_TOO_LONG',
    'NOT_A_TRIP',
    'HEADER_SCENES_DISABLED',
  ])
    recordedCodes.add(code);
  expect([...recordedCodes].sort()).toEqual(Object.keys(refusalVocabulary).sort());
});

import draftAnswers from '../refusal-census-draft-answers.json';
it('treats an untyped code message as a fault after migration closes', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const answer = serverError(new Error('FORBIDDEN'));
  expect(answer.status).toBe(500);
  expect(await answer.text()).toBe('{"error":"Internal server error","status":500}');
  log.mockRestore();
});
