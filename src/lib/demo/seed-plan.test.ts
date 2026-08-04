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

  it('keeps every payer and split participant inside the trip membership', () => {
    const plan = buildDemoSeedPlan();
    const members = new Set(plan.memberIds);

    for (const expense of plan.expenses) {
      for (const payer of expense.paidBy) {
        expect(members.has(payer.user), `${expense.key} payer`).toBe(true);
      }
      for (const participant of expense.splitBetween) {
        expect(members.has(participant.user), `${expense.key} participant`).toBe(true);
      }
    }

    expect(members.has(plan.settlement.paidBy)).toBe(true);
    expect(members.has(plan.settlement.paidTo)).toBe(true);
    expect(plan.settlement.paidBy).not.toBe(plan.settlement.paidTo);
  });

  it('uses one currency and active trip tags for every seeded transaction', () => {
    const plan = buildDemoSeedPlan();
    const tags = new Set(plan.tags.map((tag) => tag.toLowerCase()));

    for (const expense of plan.expenses) {
      expect(expense.currency).toBe(plan.currency);
      expect(tags.has(expense.tag.toLowerCase()), `${expense.key} tag`).toBe(true);
    }
    expect(plan.settlement.currency).toBe(plan.currency);
  });

  it('keeps caller-provided split inputs internally consistent', () => {
    const plan = buildDemoSeedPlan();

    for (const expense of plan.expenses) {
      if (expense.splitMethod === 'unequal' || expense.splitMethod === 'exact') {
        const total = expense.splitBetween.reduce((sum, s) => sum + (s.amount ?? 0), 0);
        expect(total, `${expense.key} split total`).toBeCloseTo(expense.amount, 10);
      }

      if (expense.splitMethod === 'percentage') {
        const total = expense.splitBetween.reduce((sum, s) => sum + (s.percentage ?? 0), 0);
        expect(total, `${expense.key} percentage total`).toBe(100);
      }

      if (expense.splitMethod === 'equal' || expense.splitMethod === 'shares') {
        // Equal/shares splits cover every traveller so no one is left out of a shared cost.
        expect(
          expense.splitBetween.map((s) => s.user).sort(),
          `${expense.key} participants`,
        ).toEqual([...plan.memberIds].sort());
      }

      if (expense.splitMethod === 'shares') {
        for (const participant of expense.splitBetween) {
          expect(participant.shares, `${expense.key} shares`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('orders expenses chronologically so the activity feed reads like a trip', () => {
    const plan = buildDemoSeedPlan();
    const days = plan.expenses.map((expense) => expense.daysAgo);

    expect(days).toEqual([...days].sort((a, b) => b - a));
  });
});
