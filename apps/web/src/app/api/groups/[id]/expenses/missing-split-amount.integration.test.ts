/**
 * HTTP tests for an Expense saved or edited with a share left out of an exact split (#497),
 * against a real, isolated MongoDB database (`splitbook-test-missing-split-amount`), with a real
 * session (`signed-in-route.ts`).
 *
 * The share nobody entered is refused as a missing amount that points at that row of the split,
 * not at the Expense total, and nothing changes. A new Expense is refused by the save schema (422
 * VALIDATION_ERROR with the issue at the row); an edit by the money rules (422
 * MISSING_SPLIT_AMOUNT with the row as its field).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

const db = integrationTestDb('missing-split-amount');
const { alex, sam } = DEMO_PERSONA_IDS;

let expenses: typeof import('./route');
let expense: typeof import('./[expenseId]/route');

beforeAll(async () => {
  await connectSignedIn(db);
  expenses = await import('./route');
  expense = await import('./[expenseId]/route');
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
});
afterAll(() => disconnectSignedIn(db));

/** Alex's and Sam's trip, with nothing in its ledger yet. */
async function coorgWeekend() {
  const created = await groupService.create(
    { name: 'Coorg Weekend', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    alex,
  );
  const groupId = String(created._id);
  await groupService.addMember(groupId, sam);
  return groupId;
}

function saveExpense(groupId: string, cookie: string, body: object) {
  return callRoute(expenses.POST, {
    method: 'POST',
    path: `/api/groups/${groupId}/expenses`,
    params: { id: groupId },
    cookie,
    body,
  });
}

async function expenseCount(groupId: string, cookie: string) {
  const listed = await callRoute(expenses.GET, {
    method: 'GET',
    path: `/api/groups/${groupId}/expenses`,
    params: { id: groupId },
    cookie,
  });
  expect(listed.status).toBe(200);
  return listed.body.data.pagination.total;
}

/** A ₹1,000.00 dinner Alex paid for, split exactly: Alex ₹600.00, Sam's share never entered. */
const dinnerWithSamsShareLeftOut = {
  description: 'Dinner',
  amount: 1000,
  currency: 'INR',
  category: 'food',
  tag: 'Food',
  date: '2026-10-10',
  paidBy: [{ user: alex, amount: 1000 }],
  splitMethod: 'exact',
  splitBetween: [{ user: alex, amount: 600 }, { user: sam }],
};

describe('POST /api/groups/[id]/expenses with a share left out', () => {
  it('refuses the missing share at its row of the split and saves nothing', async () => {
    const groupId = await coorgWeekend();
    const alexCookie = await signIn('alex');

    const refused = await saveExpense(groupId, alexCookie, dinnerWithSamsShareLeftOut);

    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    // Each problem as { path, message }, the Draft APIs' shape (#538).
    expect(refused.body.details).toEqual([
      {
        path: ['splitBetween', 1, 'amount'],
        message: 'Enter an amount for each person in the split',
      },
    ]);
    expect(await expenseCount(groupId, alexCookie)).toBe(0);
  });

  it('refuses an edit that leaves Sam’s share out, at that row, and keeps the Expense', async () => {
    const groupId = await coorgWeekend();
    const dinner = await expenseService.create(
      groupId,
      {
        ...dinnerWithSamsShareLeftOut,
        splitMethod: 'exact',
        date: new Date('2026-10-10T12:00:00.000Z'),
        splitBetween: [
          { user: alex, amount: 600 },
          { user: sam, amount: 400 },
        ],
      },
      alex,
    );
    const expenseId = String(dinner._id);
    const alexCookie = await signIn('alex');

    const refused = await callRoute(expense.PATCH, {
      method: 'PATCH',
      path: `/api/groups/${groupId}/expenses/${expenseId}`,
      params: { id: groupId, expenseId },
      cookie: alexCookie,
      body: { splitMethod: 'exact', splitBetween: [{ user: alex, amount: 600 }, { user: sam }] },
      headers: { 'X-Splitbook-Revision': '0' },
    });

    expect(refused).toEqual({
      status: 422,
      body: {
        error: 'Enter an amount for each person in the split',
        status: 422,
        code: 'MISSING_SPLIT_AMOUNT',
        field: ['splitBetween', 1, 'amount'],
      },
    });
    const kept = await callRoute(expense.GET, {
      method: 'GET',
      path: `/api/groups/${groupId}/expenses/${expenseId}`,
      params: { id: groupId, expenseId },
      cookie: alexCookie,
    });
    expect(kept.body.data.splitBetween.map((row: { amount: number }) => row.amount)).toEqual([
      600, 400,
    ]);
  });
});
