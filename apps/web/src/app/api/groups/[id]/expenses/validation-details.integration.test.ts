/**
 * HTTP tests for the details of an Expense refused by its schema (#538), against a real, isolated
 * MongoDB database (`splitbook-test-expense-validation-details`), with a real session
 * (`signed-in-route.ts`).
 *
 * A 422 VALIDATION_ERROR lists each problem as `{ path, message }`, the same shape as the Draft
 * APIs, never a serialized Zod error. A Category outside the list is one such problem, on a new
 * Expense and on an edit, and nothing is saved.
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

const db = integrationTestDb('expense-validation-details');
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

/** A ₹1,000.00 dinner Alex paid for, split equally with Sam. */
const dinner = {
  description: 'Dinner',
  amount: 1000,
  currency: 'INR',
  category: 'food',
  tag: 'Food',
  date: '2026-10-10',
  paidBy: [{ user: alex, amount: 1000 }],
  splitMethod: 'equal',
  splitBetween: [{ user: alex }, { user: sam }],
};

const unknownCategory = {
  status: 422,
  body: {
    error: 'Validation error',
    code: 'VALIDATION_ERROR',
    status: 422,
    details: [{ path: ['category'], message: 'Invalid category' }],
  },
};

describe('an Expense refused by its schema (#538)', () => {
  it('lists the problem as { path, message } on a new Expense, and saves nothing', async () => {
    const groupId = await coorgWeekend();
    const alexCookie = await signIn('alex');

    const refused = await callRoute(expenses.POST, {
      method: 'POST',
      path: `/api/groups/${groupId}/expenses`,
      params: { id: groupId },
      cookie: alexCookie,
      body: { ...dinner, category: 'treasure' },
    });

    expect(refused).toEqual(unknownCategory);
    const listed = await callRoute(expenses.GET, {
      method: 'GET',
      path: `/api/groups/${groupId}/expenses`,
      params: { id: groupId },
      cookie: alexCookie,
    });
    expect(listed.body.data.pagination.total).toBe(0);
  });

  it('lists the problem as { path, message } on an edit, and keeps the Expense', async () => {
    const groupId = await coorgWeekend();
    const saved = await expenseService.create(
      groupId,
      { ...dinner, splitMethod: 'equal', date: new Date('2026-10-10T00:00:00.000Z') },
      alex,
    );
    const expenseId = String(saved._id);

    const refused = await callRoute(expense.PATCH, {
      method: 'PATCH',
      path: `/api/groups/${groupId}/expenses/${expenseId}`,
      params: { id: groupId, expenseId },
      cookie: await signIn('alex'),
      headers: { 'X-Splitbook-Revision': '0' },
      body: { category: 'treasure' },
    });

    expect(refused).toEqual(unknownCategory);
    expect((await Expense.findById(expenseId).lean())?.category).toBe('food');
  });
});
