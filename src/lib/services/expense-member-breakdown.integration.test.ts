/**
 * Integration tests for the opt-in per-member expense summary breakdown
 * (`includeMemberBreakdown`) in `expenseService.getGroupExpenses`, against a
 * real, isolated MongoDB database (`splitwise-test-member-breakdown`).
 *
 * The breakdown powers the Household month view's member table: for the
 * filtered window, each member's fronted (`paid`), `share`, and `net` —
 * whose rows must sum to the window total and zero respectively.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { groupService } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';

const db = integrationTestDb('member-breakdown');
const { alice, bob, carol } = TEST_USER_IDS;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol');
});
afterAll(db.teardown);

async function createHousehold(): Promise<string> {
  const group = await groupService.create(
    { name: 'Breakdown Flat', category: 'home', defaultCurrency: 'INR', alternateCurrencies: [] },
    alice,
  );
  return group._id.toString();
}

async function addExpense(
  groupId: string,
  input: {
    description: string;
    amount: number;
    date: string;
    paidBy: Array<{ user: string; amount: number }>;
    splitBetween: Array<{ user: string; amount?: number }>;
  },
) {
  return expenseService.create(
    groupId,
    {
      description: input.description,
      amount: input.amount,
      currency: 'INR',
      category: 'other',
      date: new Date(input.date),
      paidBy: input.paidBy,
      splitMethod: input.splitBetween.some((s) => s.amount !== undefined) ? 'exact' : 'equal',
      splitBetween: input.splitBetween,
      tag: 'General',
    },
    input.paidBy[0].user,
  );
}

type ByMemberRow = {
  user: { _id: string; name: string; image?: string };
  paid: number;
  share: number;
  net: number;
};

describe('expense member breakdown integration', () => {
  it("sums a month's byMember nets to zero and totals to the window amount", async () => {
    const groupId = await createHousehold();
    await groupService.addMember(groupId, bob);
    await groupService.addMember(groupId, carol);

    // August: rent fronted by alice, utilities split unevenly, one July expense
    // that must NOT leak into the August window.
    await addExpense(groupId, {
      description: 'August rent',
      amount: 30000,
      date: '2026-08-01T06:00:00.000Z',
      paidBy: [{ user: alice, amount: 30000 }],
      splitBetween: [{ user: alice }, { user: bob }, { user: carol }],
    });
    await addExpense(groupId, {
      description: 'Electricity',
      amount: 2400,
      date: '2026-08-12T10:00:00.000Z',
      paidBy: [
        { user: bob, amount: 1400 },
        { user: carol, amount: 1000 },
      ],
      splitBetween: [
        { user: alice, amount: 1200 },
        { user: bob, amount: 800 },
        { user: carol, amount: 400 },
      ],
    });
    await addExpense(groupId, {
      description: 'July grocery',
      amount: 999,
      date: '2026-07-15T10:00:00.000Z',
      paidBy: [{ user: carol, amount: 999 }],
      splitBetween: [{ user: carol }],
    });

    const result = await expenseService.getGroupExpenses(
      groupId,
      {
        dateFrom: '2026-08-01',
        dateTo: '2026-08-31',
        includeMemberBreakdown: true,
      },
      alice,
    );

    const byMember = result.summary.byMember as ByMemberRow[];
    expect(byMember).toHaveLength(3);

    // Window total: 30000 + 2400 (July expense excluded by the range).
    expect(result.summary.totalAmount).toBe(32400);
    expect(result.summary.count).toBe(2);

    const rowFor = (userId: string) => byMember.find((row) => row.user._id === userId)!;

    // Alice fronted 30000 rent; her share is 10000 rent + 1200 electricity.
    expect(rowFor(alice).paid).toBe(30000);
    expect(rowFor(alice).share).toBe(11200);
    expect(rowFor(alice).net).toBe(-18800);

    // Bob fronted 1400 of the electricity; share is 10000 rent + 800.
    expect(rowFor(bob).paid).toBe(1400);
    expect(rowFor(bob).share).toBe(10800);
    expect(rowFor(bob).net).toBe(9400);

    // Carol fronted 1000; share is 10000 rent + 400.
    expect(rowFor(carol).paid).toBe(1000);
    expect(rowFor(carol).share).toBe(10400);
    expect(rowFor(carol).net).toBe(9400);

    const sum = (key: 'paid' | 'share' | 'net') =>
      Math.round(byMember.reduce((total, row) => total + row[key], 0) * 100) / 100;
    expect(sum('paid')).toBe(32400);
    expect(sum('share')).toBe(32400);
    expect(Math.abs(sum('net'))).toBeLessThanOrEqual(0.01);

    // Names are hydrated from the group's members.
    expect(rowFor(alice).user.name).toBe('Alice Tester');
  });

  it('includes zero rows for inactive members and omits byMember by default', async () => {
    const groupId = await createHousehold();
    await groupService.addMember(groupId, bob);
    await groupService.addMember(groupId, carol);

    await addExpense(groupId, {
      description: 'Groceries',
      amount: 600,
      date: '2026-08-05T10:00:00.000Z',
      paidBy: [{ user: alice, amount: 600 }],
      splitBetween: [{ user: alice }, { user: bob }],
    });

    const withBreakdown = await expenseService.getGroupExpenses(
      groupId,
      { includeMemberBreakdown: true },
      alice,
    );
    const byMember = withBreakdown.summary.byMember as ByMemberRow[];
    const carolRow = byMember.find((row) => row.user._id === carol)!;
    expect(carolRow).toMatchObject({ paid: 0, share: 0, net: 0 });

    const withoutBreakdown = await expenseService.getGroupExpenses(groupId, {}, alice);
    expect(withoutBreakdown.summary.byMember).toBeUndefined();
    // userOwes/userGetsBack still computed from the same pass.
    expect(withoutBreakdown.summary.userOwes).toBe(0);
    expect(withoutBreakdown.summary.userGetsBack).toBe(300);
  });
});
