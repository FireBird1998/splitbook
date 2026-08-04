/**
 * Integration tests for balance integrity against a real, isolated MongoDB
 * database (`splitwise-test-balance-integrity`). Verifies that balances
 * derived from stored expenses/settlements stay zero-sum, respect soft
 * deletes, and never mix currencies into one number.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import Expense from '@/lib/models/Expense';
import { groupService } from '@/lib/services/group.service';
import { expenseService } from '@/lib/services/expense.service';
import { settlementService } from '@/lib/services/settlement.service';
import { balanceService } from '@/lib/services/balance.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';

const db = integrationTestDb('balance-integrity');
const { alice, bob, carol } = TEST_USER_IDS;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol');
});
afterAll(db.teardown);

async function createTrip(
  currency: string = 'INR',
  creatorId: string = alice,
  name = 'Balance Trip',
): Promise<string> {
  const group = await groupService.create(
    { name, category: 'trip', defaultCurrency: currency, alternateCurrencies: [] },
    creatorId,
  );
  return group._id.toString();
}

async function addEqualExpense(
  groupId: string,
  paidBy: string,
  amount: number,
  between: string[],
  description = 'Shared cost',
) {
  return expenseService.create(
    groupId,
    {
      description,
      amount,
      currency: 'INR',
      category: 'other',
      date: new Date('2026-07-20T12:00:00.000Z'),
      paidBy: [{ user: paidBy, amount }],
      splitMethod: 'equal',
      splitBetween: between.map((user) => ({ user })),
      tag: 'General',
    },
    paidBy,
  );
}

type LeanBalance = { user: { _id: string }; balance: number };

function balanceOf(balances: LeanBalance[], userId: string): number {
  return balances.find((b) => b.user._id === userId)?.balance ?? 0;
}

describe('balance integrity integration', () => {
  it('derives zero-sum balances and a single debt for a two-person expense', async () => {
    const groupId = await createTrip();
    await groupService.addMember(groupId, bob);

    await addEqualExpense(groupId, alice, 100, [alice, bob]);

    const result = await balanceService.getGroupBalances(groupId);
    expect(result).not.toBeNull();

    const balances = result!.balances as LeanBalance[];
    expect(balanceOf(balances, alice)).toBe(50);
    expect(balanceOf(balances, bob)).toBe(-50);
    expect(balances.reduce((sum, b) => sum + b.balance, 0)).toBeCloseTo(0, 10);

    expect(result!.debts).toHaveLength(1);
    expect(result!.debts[0]).toMatchObject({
      from: { _id: bob },
      to: { _id: alice },
      amount: 50,
    });
    expect(result!.currency).toBe('INR');
    expect(result!.hasMixedCurrencies).toBe(false);
  });

  it('shrinks and then clears debts as settlements are recorded', async () => {
    const groupId = await createTrip();
    await groupService.addMember(groupId, bob);

    await addEqualExpense(groupId, alice, 100, [alice, bob]);

    await settlementService.create(groupId, { paidTo: alice, amount: 20, currency: 'INR' }, bob);

    let result = await balanceService.getGroupBalances(groupId);
    let balances = result!.balances as LeanBalance[];
    expect(balanceOf(balances, alice)).toBe(30);
    expect(balanceOf(balances, bob)).toBe(-30);
    expect(result!.debts[0]).toMatchObject({ amount: 30 });

    await settlementService.create(groupId, { paidTo: alice, amount: 30, currency: 'INR' }, bob);

    result = await balanceService.getGroupBalances(groupId);
    balances = result!.balances as LeanBalance[];
    expect(balanceOf(balances, alice)).toBe(0);
    expect(balanceOf(balances, bob)).toBe(0);
    expect(result!.debts).toHaveLength(0);
  });

  it('keeps three-person pools zero-sum across mixed split methods', async () => {
    const groupId = await createTrip();
    await groupService.addMember(groupId, bob);
    await groupService.addMember(groupId, carol);

    // alice pays 300 equally
    await addEqualExpense(groupId, alice, 300, [alice, bob, carol], 'Villa night');

    // bob pays 120 with percentage split 50/25/25
    await expenseService.create(
      groupId,
      {
        description: 'Taxi',
        amount: 120,
        currency: 'INR',
        category: 'transport',
        date: new Date('2026-07-21T12:00:00.000Z'),
        paidBy: [{ user: bob, amount: 120 }],
        splitMethod: 'percentage',
        splitBetween: [
          { user: alice, percentage: 50 },
          { user: bob, percentage: 25 },
          { user: carol, percentage: 25 },
        ],
        tag: 'Transport',
      },
      bob,
    );

    const result = await balanceService.getGroupBalances(groupId);
    const balances = result!.balances as LeanBalance[];

    // alice: +200 from villa, -60 taxi share → +140
    expect(balanceOf(balances, alice)).toBe(140);
    // bob: -100 villa, +90 taxi (120-30) → -10
    expect(balanceOf(balances, bob)).toBe(-10);
    // carol: -100 villa, -30 taxi → -130
    expect(balanceOf(balances, carol)).toBe(-130);
    expect(balances.reduce((sum, b) => sum + b.balance, 0)).toBeCloseTo(0, 10);

    const transferred = result!.debts.reduce((sum, d) => sum + d.amount, 0);
    expect(transferred).toBe(140);
  });

  it('restores balances when an expense is soft deleted', async () => {
    const groupId = await createTrip();
    await groupService.addMember(groupId, bob);

    const expense = await addEqualExpense(groupId, alice, 100, [alice, bob]);
    await expenseService.delete(expense._id.toString(), alice);

    const result = await balanceService.getGroupBalances(groupId);
    const balances = result!.balances as LeanBalance[];
    expect(balanceOf(balances, alice)).toBe(0);
    expect(balanceOf(balances, bob)).toBe(0);
    expect(result!.debts).toHaveLength(0);
  });

  it('aggregates dashboard balances in separate currency buckets across trips', async () => {
    const inrTrip = await createTrip('INR', alice, 'Goa');
    await groupService.addMember(inrTrip, bob);
    await addEqualExpense(inrTrip, alice, 100, [alice, bob]);

    const usdTrip = await createTrip('USD', alice, 'NYC');
    await groupService.addMember(usdTrip, bob);
    await expenseService.create(
      usdTrip,
      {
        description: 'Metro card',
        amount: 40,
        currency: 'USD',
        category: 'transport',
        date: new Date('2026-07-20T12:00:00.000Z'),
        paidBy: [{ user: bob, amount: 40 }],
        splitMethod: 'equal',
        splitBetween: [{ user: alice }, { user: bob }],
        tag: 'General',
      },
      bob,
    );

    const result = await balanceService.getUserBalances(alice);

    expect(result.buckets).toEqual([
      { currency: 'INR', youOwe: 0, youAreOwed: 50, net: 50 },
      { currency: 'USD', youOwe: 20, youAreOwed: 0, net: -20 },
    ]);
    expect(result.hasMixedCurrencies).toBe(false);

    const goa = result.groups.find((g) => g.name === 'Goa');
    const nyc = result.groups.find((g) => g.name === 'NYC');
    expect(goa?.balances).toMatchObject([{ currency: 'INR', balance: 50 }]);
    expect(nyc?.balances).toMatchObject([{ currency: 'USD', balance: -20 }]);
  });

  it('flags legacy mixed-currency data but still buckets it separately', async () => {
    const groupId = await createTrip();
    await groupService.addMember(groupId, bob);

    await addEqualExpense(groupId, alice, 100, [alice, bob]);

    // Legacy EUR expense written directly, bypassing single-currency validation
    await Expense.create({
      group: new mongoose.Types.ObjectId(groupId),
      description: 'Legacy euro dinner',
      amount: 60,
      currency: 'EUR',
      category: 'food',
      date: new Date('2026-07-19T12:00:00.000Z'),
      paidBy: [{ user: new mongoose.Types.ObjectId(bob), amount: 60 }],
      splitMethod: 'equal',
      splitBetween: [
        { user: new mongoose.Types.ObjectId(alice), amount: 30 },
        { user: new mongoose.Types.ObjectId(bob), amount: 30 },
      ],
      tag: 'Food',
      createdBy: new mongoose.Types.ObjectId(bob),
    });

    const groupBalances = await balanceService.getGroupBalances(groupId);
    expect(groupBalances!.hasMixedCurrencies).toBe(true);

    const userBalances = await balanceService.getUserBalances(alice);
    expect(userBalances.hasMixedCurrencies).toBe(true);
    expect(userBalances.buckets).toEqual([
      { currency: 'EUR', youOwe: 30, youAreOwed: 0, net: -30 },
      { currency: 'INR', youOwe: 0, youAreOwed: 50, net: 50 },
    ]);
  });

  it('excludes archived trips from dashboard balances', async () => {
    const groupId = await createTrip();
    await groupService.addMember(groupId, bob);
    await addEqualExpense(groupId, alice, 100, [alice, bob]);

    await groupService.archive(groupId, alice);

    const result = await balanceService.getUserBalances(alice);
    expect(result.groups).toHaveLength(0);
    expect(result.buckets).toHaveLength(0);
  });
});
