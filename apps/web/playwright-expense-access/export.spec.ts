import type { APIRequestContext } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect, dataOf, generatedExpense, observeLedger } from './fixtures';

/**
 * The export read (`GET /api/export`, #317) in the access matrix: who may export a Group's
 * Expenses, manual and recurring, and that a refused export answers the Group reads' refusal,
 * names nothing from the Group and changes nothing.
 */

const exportOf = (...groups: string[]) =>
  `/api/export?groups=${groups.join(',')}&include=payments,shares,deleted,history&format=csv&tz=UTC`;

/** An export that comes as a zip: the Group's Expenses and payments together. */
async function zipOf(actor: APIRequestContext, path: string) {
  const response = await actor.get(path, { maxRedirects: 0 });
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/zip');
  expect(response.headers()['content-disposition']).toMatch(
    /^attachment; filename="[a-z0-9.-]+\.zip"$/,
  );
  return response.body();
}

for (const origin of ['manual', 'recurring'] as const) {
  test(`export: a member exports a Group’s ${origin} Expense, by name and never by email`, async ({
    ledger,
  }) => {
    const expense = origin === 'recurring' ? await generatedExpense(ledger) : ledger.expenseB;
    const description = origin === 'recurring' ? 'Generated rent' : 'Private rent';
    // A single Expenses CSV, so its text can be read as it is.
    const response = await ledger.sam.get(
      `/api/export?groups=${ledger.groupB}&include=shares,history&format=csv&tz=UTC`,
    );
    expect(response.status(), await response.text()).toBe(200);
    expect(response.headers()['content-type']).toBe('text/csv; charset=utf-8');
    const text = await response.text();
    expect(text).toContain(description);
    expect(text).toContain(expense);
    expect(text).toContain('Priya Shah');
    expect(text).not.toMatch(/@|splitbook\.local/);
    // With payments too, the Group's files come as one zip.
    const zipped = await zipOf(ledger.sam, exportOf(ledger.groupB));
    expect(zipped.subarray(0, 2).toString()).toBe('PK');
  });

  for (const scenario of ['outsider', 'removed', 'mixed', 'missing', 'anonymous'] as const) {
    test(`export: ${origin} Expense denies ${scenario} access without side effects`, async ({
      ledger,
    }) => {
      const expense = origin === 'recurring' ? await generatedExpense(ledger) : ledger.expenseB;
      let actor = ledger.alex;
      let groups = [ledger.groupB];
      if (scenario === 'removed') {
        // Establish access, then revoke it while keeping the same session.
        await dataOf(await ledger.sam.get(`/api/groups/${ledger.groupB}`));
        await dataOf(
          await ledger.priya.delete(`/api/groups/${ledger.groupB}/members/${DEMO_PERSONA_IDS.sam}`),
        );
        actor = ledger.sam;
      } else if (scenario === 'mixed') {
        // Alex's own Group beside one he isn't in: nothing from either.
        groups = [ledger.groupA, ledger.groupB];
      } else if (scenario === 'missing') {
        groups = ['f00000000000000000000000'];
      } else if (scenario === 'anonymous') {
        actor = ledger.anonymous;
      }

      const before = await observeLedger(ledger, expense);
      const response = await actor.get(exportOf(...groups), { maxRedirects: 0 });
      if (scenario === 'anonymous') {
        expect.soft(response.status()).toBe(401);
        expect.soft(await response.json()).toEqual({ error: 'Unauthorized', status: 401 });
        expect.soft(response.headers().location, 'API 401s carry no redirect').toBeUndefined();
      } else {
        expect.soft(response.status()).toBe(403);
        expect.soft(await response.json()).toEqual({ error: 'Forbidden', status: 403 });
        expect.soft(response.headers()['content-disposition']).toBeUndefined();
      }
      expect(await observeLedger(ledger, expense)).toEqual(before);
    });
  }
}
