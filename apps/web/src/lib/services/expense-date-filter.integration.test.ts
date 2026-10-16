/**
 * Integration tests for the inclusive `dateTo` boundary in
 * `expenseService.getGroupExpenses`. A date-only `dateTo` must cover the
 * whole final day (end-of-day UTC); previously it resolved to UTC midnight
 * and silently dropped expenses recorded later that day.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { groupService } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import { expenseMonthRange } from '@splitbook/shared/expense-day';

const db = integrationTestDb('expense-date-filter');
const { alice, bob } = TEST_USER_IDS;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob');
});
afterAll(db.teardown);

async function createGroup(): Promise<string> {
  const group = await groupService.create(
    {
      name: 'Date Filter Group',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: [],
    },
    alice,
  );
  return group._id.toString();
}

async function addExpense(groupId: string, date: string, description: string) {
  return expenseService.create(
    groupId,
    {
      description,
      amount: 100,
      currency: 'INR',
      category: 'other',
      date: new Date(date),
      paidBy: [{ user: alice, amount: 100 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alice }, { user: bob }],
      tag: 'General',
    },
    alice,
  );
}

describe('expense date-range filter', () => {
  it('includes expenses recorded at any time on the final day of a date-only range', async () => {
    const groupId = await createGroup();
    await groupService.addMember(groupId, bob);

    await addExpense(groupId, '2026-08-31T00:30:00.000Z', 'Early final day');
    await addExpense(groupId, '2026-08-31T14:00:00.000Z', 'Afternoon final day');
    await addExpense(groupId, '2026-08-31T23:30:00.000Z', 'Late final day');
    await addExpense(groupId, '2026-09-01T00:15:00.000Z', 'Just after range');

    const result = await expenseService.getGroupExpenses(
      groupId,
      { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
      alice,
    );

    const descriptions = result.expenses.map((expense) => expense.description);
    expect(descriptions).toContain('Early final day');
    expect(descriptions).toContain('Afternoon final day');
    expect(descriptions).toContain('Late final day');
    expect(descriptions).not.toContain('Just after range');
    expect(result.summary.count).toBe(3);
    expect(result.summary.totalAmount).toBe(300);
  });

  it('holds a Month’s Expenses, dated from its first to its last day (#437)', async () => {
    const groupId = await createGroup();
    await groupService.addMember(groupId, bob);

    await addExpense(groupId, '2026-08-31T00:00:00.000Z', 'Last of August');
    await addExpense(groupId, '2026-09-01T00:00:00.000Z', 'First of September');
    await addExpense(groupId, '2026-09-30T00:00:00.000Z', 'Last of September');
    await addExpense(groupId, '2026-10-01T00:00:00.000Z', 'First of October');

    const result = await expenseService.getGroupExpenses(
      groupId,
      expenseMonthRange('2026-09'),
      alice,
    );

    expect(result.expenses.map((expense) => expense.description).sort()).toEqual([
      'First of September',
      'Last of September',
    ]);
  });

  it('lists a day’s Expenses newest added first (#437)', async () => {
    const groupId = await createGroup();
    await groupService.addMember(groupId, bob);

    await addExpense(groupId, '2026-09-10T00:00:00.000Z', 'Added first');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await addExpense(groupId, '2026-09-10T00:00:00.000Z', 'Added second');
    await addExpense(groupId, '2026-09-09T00:00:00.000Z', 'The day before, added last');

    const result = await expenseService.getGroupExpenses(groupId, {}, alice);

    expect(result.expenses.map((expense) => expense.description)).toEqual([
      'Added second',
      'Added first',
      'The day before, added last',
    ]);
  });

  it('does not widen a full ISO timestamp dateTo', async () => {
    const groupId = await createGroup();
    await groupService.addMember(groupId, bob);

    await addExpense(groupId, '2026-08-31T11:00:00.000Z', 'Before cutoff');
    await addExpense(groupId, '2026-08-31T14:00:00.000Z', 'After cutoff');

    const result = await expenseService.getGroupExpenses(
      groupId,
      { dateTo: '2026-08-31T12:00:00.000Z' },
      alice,
    );

    const descriptions = result.expenses.map((expense) => expense.description);
    expect(descriptions).toContain('Before cutoff');
    expect(descriptions).not.toContain('After cutoff');
  });
});
