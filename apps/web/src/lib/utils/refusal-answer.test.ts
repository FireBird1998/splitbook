import { describe, expect, it, vi } from 'vitest';
import { Refusal } from '@splitbook/shared/refusals';
import { serverError } from './api-response';
vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));

describe('serverError answers typed refusals', () => {
  it('answers the named payment caller with its original words', async () => {
    const answer = serverError(new Refusal('FORBIDDEN_SETTLEMENT', { variant: 'settlementBatch' }));
    expect(answer.status).toBe(422);
    expect(await answer.text()).toBe(
      '{"error":"Only the payer or recipient can record this payment","status":422,"code":"FORBIDDEN_SETTLEMENT"}',
    );
  });
  it('preserves legacy route answers with no code', async () => {
    const answer = serverError(new Refusal('LAST_ADMIN', { variant: 'membersRemove' }));
    expect(answer.status).toBe(409);
    expect(await answer.text()).toBe('{"error":"Cannot remove the last admin.","status":409}');
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

// Literal answers captured on main. This matrix covers every default and named wording.
import cases from './refusal-vocabulary-answers.json';
import { refusalVocabulary, type RefusalCode } from '@splitbook/shared/refusals';

it.each(cases)('keeps $code / $variant byte for byte', async ({ code, data, status, body }) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const answer = serverError(new Refusal(code as RefusalCode, data as never));
  expect(answer.status).toBe(status);
  expect(await answer.text()).toBe(body);
});
it('has exactly the census codes and a recorded answer for every named variant', () => {
  expect([...new Set(cases.map(({ code }) => code))].sort()).toEqual(
    Object.keys(refusalVocabulary).sort(),
  );
  for (const [code, entry] of Object.entries(refusalVocabulary)) {
    const covered = cases.filter((row) => row.code === code).map((row) => row.variant);
    expect(covered).toContain('default');
    for (const variant of Object.keys(entry.variants)) expect(covered, code).toContain(variant);
  }
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import inputs from '../refusal-census-inputs.json';
it('uses only answers and codes recorded by the unchanged-main census', () => {
  const baseline = readFileSync(
    resolve('src/lib/__snapshots__/refusal-census.test.ts.snap'),
    'utf8',
  );
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
  expect([...recordedCodes].sort()).toEqual(Object.keys(refusalVocabulary).sort());
});
