/**
 * HTTP tests for an Expense edit whose payer or share has more decimals than the currency (#546),
 * against a real, isolated MongoDB database (`splitbook-test-expense-row-decimals`), with a real
 * session (`signed-in-route.ts`).
 *
 * The refusal names that row in `field`, as a new Expense's does (#506), so a client can point at
 * the amount to correct; the total's own decimals stay at the amount. Nothing changes.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Expense from '@/lib/models/Expense';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { expenseService } from '@/lib/services/expense.service';
import { groupService } from '@/lib/services/group.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  callRoute,
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  signIn,
} from '@/lib/test-utils/signed-in-route';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);

const db = integrationTestDb('expense-row-decimals');
const { alex, sam } = DEMO_PERSONA_IDS;

let expense: typeof import('./route');

beforeAll(async () => {
  await connectSignedIn(db);
  expense = await import('./route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** A ₹1,000.00 dinner on Alex and Sam's trip, Alex paying, split exactly ₹600.00 and ₹400.00. */
async function dinner() {
  const group = await groupService.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(group._id);
  await groupService.addMember(groupId, sam);
  const saved = await expenseService.create(
    groupId,
    {
      description: 'Dinner',
      amount: 1000,
      currency: 'INR',
      category: 'food',
      tag: 'Food',
      date: new Date('2026-10-10T00:00:00.000Z'),
      paidBy: [{ user: alex, amount: 1000 }],
      splitMethod: 'exact',
      splitBetween: [
        { user: alex, amount: 600 },
        { user: sam, amount: 400 },
      ],
    },
    alex,
  );
  const expenseId = String(saved._id);
  const edit = async (change: object) =>
    callRoute(expense.PATCH, {
      method: 'PATCH',
      path: `/api/groups/${groupId}/expenses/${expenseId}`,
      params: { id: groupId, expenseId },
      cookie: await signIn('alex'),
      headers: { 'X-Splitbook-Revision': '0' },
      body: change,
    });
  const stored = async () => {
    const row = await Expense.findById(expenseId).lean();
    return (
      row && {
        revision: row.revision,
        paidBy: row.paidBy.map((payer) => payer.amount),
        splitBetween: row.splitBetween.map((share) => share.amount),
      }
    );
  };
  return { edit, stored };
}

const precision = (field?: Array<string | number>) => ({
  status: 422,
  body: {
    error: 'Amount supports at most 2 decimal places',
    status: 422,
    code: 'INVALID_MONEY_PRECISION',
    ...(field ? { field } : {}),
  },
});

describe('an Expense edit with more decimals than the currency has (#546)', () => {
  it('names the payer’s row and changes nothing', async () => {
    const { edit, stored } = await dinner();
    expect(await edit({ paidBy: [{ user: alex, amount: 1000.001 }] })).toEqual(
      precision(['paidBy', 0, 'amount']),
    );
    expect(await stored()).toEqual({ revision: 0, paidBy: [1000], splitBetween: [600, 400] });
  });

  it('names the share’s row and changes nothing', async () => {
    const { edit, stored } = await dinner();
    expect(
      await edit({
        splitMethod: 'exact',
        splitBetween: [
          { user: alex, amount: 600 },
          { user: sam, amount: 399.999 },
        ],
      }),
    ).toEqual(precision(['splitBetween', 1, 'amount']));
    expect(await stored()).toEqual({ revision: 0, paidBy: [1000], splitBetween: [600, 400] });
  });

  it('keeps the total’s own decimals at the amount, with no row', async () => {
    const { edit } = await dinner();
    expect(await edit({ amount: 1000.001 })).toEqual(precision());
  });
});
