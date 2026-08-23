/**
 * Integration tests for the demo seed/reset lifecycle against a real,
 * isolated MongoDB database (`splitbook-test-seed-lifecycle`). Proves the seed
 * is idempotent end-to-end and that seeded persona balances are exactly
 * the numbers the private-beta UI promises.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import User from '@/lib/models/User';
import Group from '@/lib/models/Group';
import Expense from '@/lib/models/Expense';
import Settlement from '@/lib/models/Settlement';
import Activity from '@/lib/models/Activity';
import { seedDemoData, resetDemoData } from '@/lib/demo/seed';
import { buildDemoSeedPlan } from '@/lib/demo/seed-plan';
import { DEMO_GROUP_ID, DEMO_PERSONA_IDS, DEMO_PERSONAS } from '@/lib/demo-personas';
import { balanceService } from '@/lib/services/balance.service';
import { integrationTestDb } from '@/lib/test-utils/integration-db';

const db = integrationTestDb('seed-lifecycle');
const plan = buildDemoSeedPlan();

beforeAll(db.connect);
beforeEach(db.reset);
afterAll(db.teardown);

type LeanBalance = { user: { _id: string }; balance: number };

describe('demo seed integration', () => {
  it('seeds personas, one trip, expenses, and a settlement from scratch', async () => {
    const result = await seedDemoData();

    expect(result).toMatchObject({
      usersUpserted: 3,
      groupCreated: true,
      membersEnsured: 2, // alex is embedded at creation; sam + priya are ensured
      tagsEnsured: plan.tags.length,
      expensesCreated: plan.expenses.length,
      settlementsCreated: 1,
      skippedTransactions: false,
    });

    expect(await User.countDocuments({})).toBe(3);
    expect(await Expense.countDocuments({ group: DEMO_GROUP_ID })).toBe(plan.expenses.length);
    expect(await Settlement.countDocuments({ group: DEMO_GROUP_ID })).toBe(1);
    expect(await Activity.countDocuments({ group: DEMO_GROUP_ID })).toBeGreaterThan(0);

    const group = await Group.findById(DEMO_GROUP_ID);
    expect(group!.members.map((m) => m.user.toString()).sort()).toEqual(
      DEMO_PERSONAS.map((persona) => persona.id).sort(),
    );
    expect(group!.tags.map((tag) => tag.name)).toEqual([...plan.tags]);
  });

  it('is idempotent: a second run creates no duplicates', async () => {
    await seedDemoData();

    const expensesBefore = await Expense.countDocuments({ group: DEMO_GROUP_ID });
    const settlementsBefore = await Settlement.countDocuments({ group: DEMO_GROUP_ID });

    const second = await seedDemoData();

    expect(second).toMatchObject({
      usersUpserted: 3,
      groupCreated: false,
      membersEnsured: 0,
      tagsEnsured: 0,
      expensesCreated: 0,
      settlementsCreated: 0,
      skippedTransactions: true,
    });

    expect(await User.countDocuments({})).toBe(3);
    expect(await Expense.countDocuments({ group: DEMO_GROUP_ID })).toBe(expensesBefore);
    expect(await Settlement.countDocuments({ group: DEMO_GROUP_ID })).toBe(settlementsBefore);
  });

  it('reset wipes the trip and reseeds it fresh', async () => {
    await seedDemoData();
    const reset = await resetDemoData();

    expect(reset).toMatchObject({
      groupCreated: true,
      expensesCreated: plan.expenses.length,
      settlementsCreated: 1,
      skippedTransactions: false,
    });

    expect(await Expense.countDocuments({ group: DEMO_GROUP_ID })).toBe(plan.expenses.length);
    expect(await Settlement.countDocuments({ group: DEMO_GROUP_ID })).toBe(1);
    // Persona users survive the reset (upserted, not recreated)
    expect(await User.countDocuments({})).toBe(3);
  });

  it('produces the exact persona balances shown on the private-beta dashboard', async () => {
    await seedDemoData();

    const balances = await balanceService.getGroupBalances(DEMO_GROUP_ID);
    expect(balances).not.toBeNull();

    const lean = balances!.balances as LeanBalance[];
    const byUser = new Map(lean.map((b) => [b.user._id, b.balance]));

    // Derived from the seed plan: villa/taxi/dinner/scooter/watersports/groceries/SIM
    // plus the sam → alex ₹2,500 settlement.
    expect(byUser.get(DEMO_PERSONA_IDS.alex)).toBe(6160);
    expect(byUser.get(DEMO_PERSONA_IDS.sam)).toBe(-1480);
    expect(byUser.get(DEMO_PERSONA_IDS.priya)).toBe(-4680);

    // Zero-sum invariant across the trip
    const total = lean.reduce((sum, b) => sum + b.balance, 0);
    expect(total).toBeCloseTo(0, 10);

    // Simplified debts: priya and sam both settle up with alex
    expect(balances!.debts).toEqual([
      {
        from: expect.objectContaining({ _id: DEMO_PERSONA_IDS.priya }),
        to: expect.objectContaining({ _id: DEMO_PERSONA_IDS.alex }),
        amount: 4680,
      },
      {
        from: expect.objectContaining({ _id: DEMO_PERSONA_IDS.sam }),
        to: expect.objectContaining({ _id: DEMO_PERSONA_IDS.alex }),
        amount: 1480,
      },
    ]);

    expect(balances!.currency).toBe('INR');
    expect(balances!.hasMixedCurrencies).toBe(false);
  });

  it('keeps each persona’s dashboard in a single INR bucket', async () => {
    await seedDemoData();

    const samBalances = await balanceService.getUserBalances(DEMO_PERSONA_IDS.sam);
    expect(samBalances.buckets).toEqual([
      { currency: 'INR', youOwe: 1480, youAreOwed: 0, net: -1480 },
    ]);

    const alexBalances = await balanceService.getUserBalances(DEMO_PERSONA_IDS.alex);
    expect(alexBalances.buckets).toEqual([
      { currency: 'INR', youOwe: 0, youAreOwed: 6160, net: 6160 },
    ]);
  });
});
