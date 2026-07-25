import { describe, expect, it } from 'vitest';
import {
  buildDemoSeedPlan,
  daysAgoDate,
  DEMO_TAGS,
  shouldInsertTripTransactions,
} from '@/lib/demo/seed-plan';
import { DEMO_GROUP_ID, DEMO_PERSONA_IDS } from '@/lib/demo-personas';

describe('demo seed plan', () => {
  it('builds a trip with three members, tags, varied expenses, and a settlement', () => {
    const plan = buildDemoSeedPlan();

    expect(plan.groupId).toBe(DEMO_GROUP_ID);
    expect(plan.adminId).toBe(DEMO_PERSONA_IDS.alex);
    expect(plan.memberIds).toEqual([
      DEMO_PERSONA_IDS.alex,
      DEMO_PERSONA_IDS.sam,
      DEMO_PERSONA_IDS.priya,
    ]);
    expect(plan.tags).toEqual([...DEMO_TAGS]);
    expect(plan.expenses.length).toBeGreaterThanOrEqual(5);

    const methods = new Set(plan.expenses.map((e) => e.splitMethod));
    expect(methods.has('equal')).toBe(true);
    expect(methods.size).toBeGreaterThanOrEqual(3);

    expect(plan.settlement.paidBy).toBe(DEMO_PERSONA_IDS.sam);
    expect(plan.settlement.paidTo).toBe(DEMO_PERSONA_IDS.alex);
    expect(plan.settlement.amount).toBeGreaterThan(0);
  });

  it('is idempotent for trip transactions when data already exists', () => {
    expect(
      shouldInsertTripTransactions({
        groupExists: false,
        expenseCount: 0,
        settlementCount: 0,
      }),
    ).toBe(true);

    expect(
      shouldInsertTripTransactions({
        groupExists: true,
        expenseCount: 0,
        settlementCount: 0,
      }),
    ).toBe(true);

    expect(
      shouldInsertTripTransactions({
        groupExists: true,
        expenseCount: 7,
        settlementCount: 1,
      }),
    ).toBe(false);

    expect(
      shouldInsertTripTransactions({
        groupExists: true,
        expenseCount: 3,
        settlementCount: 0,
      }),
    ).toBe(false);
  });

  it('computes stable UTC noon dates for seed chronology', () => {
    const now = new Date('2026-07-25T18:00:00.000Z');
    const date = daysAgoDate(5, now);
    expect(date.toISOString()).toBe('2026-07-20T12:00:00.000Z');
  });
});
