import { describe, expect, it } from 'vitest';
import {
  buildDemoGroupsPlan,
  calendarDayInMonth,
  calendarDaysAgo,
  demoGroupTags,
  shouldInsertDemoLedger,
  type DemoGroupPlan,
} from '@/lib/demo/groups-plan';
import { buildDemoSeedPlan } from '@/lib/demo/seed-plan';
import {
  DEMO_GROUP_ID,
  DEMO_PERSONAS,
  DEMO_PERSONA_IDS,
  DEMO_SEEDED_GROUP_IDS,
} from '@/lib/demo-personas';
import { CATEGORY_IDS } from '@splitbook/shared/categories';
import { defaultTagsForCategory } from '@splitbook/shared/default-tags';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import { normalizeExpenseMoney, toMajorAmount } from '@splitbook/shared/exact-money';
import { calculateNetBalancesMinor, simplifyDebts } from '@splitbook/shared/debt-simplifier';
import { nextPeriod, toPeriod } from '@splitbook/shared/recurring-due-periods';

const { alex, sam, priya } = DEMO_PERSONA_IDS;
const NOW = new Date('2026-10-06T09:30:00.000Z');

/** Run dates that cross month ends, a leap day, the turn of a year and UTC midnight. */
const RUN_DATES = [
  '2026-10-06T09:30:00.000Z',
  '2026-10-01T00:00:00.000Z',
  '2026-10-31T23:59:59.999Z',
  '2027-01-01T00:00:01.000Z',
  '2027-12-31T23:59:59.000Z',
  '2028-02-29T12:00:00.000Z',
  '2028-03-01T00:00:00.000Z',
  '2028-03-31T23:00:00.000Z',
  '2030-07-15T18:45:00.000Z',
].map((iso) => new Date(iso));

function groupOf(plans: DemoGroupPlan[], key: DemoGroupPlan['key']): DemoGroupPlan {
  const plan = plans.find((candidate) => candidate.key === key);
  if (!plan) throw new Error(`No demo Group ${key}`);
  return plan;
}

/** Every Expense the Group ends up with: planned, edited, not deleted, plus recurring Months. */
function ledgerExpenses(plan: DemoGroupPlan) {
  const deleted = new Set(plan.deletions.map((deletion) => deletion.expenseKey));
  const planned = plan.expenses
    .filter((expense) => !deleted.has(expense.key))
    .map((expense) => ({
      ...expense,
      ...plan.edits.find((edit) => edit.expenseKey === expense.key)?.change,
    }));
  const recurring = plan.recurring.flatMap((template) =>
    template.periods.map((period) => ({
      ...template,
      key: `${template.key}-${period}`,
      date: `${period}-${String(template.dayOfMonth).padStart(2, '0')}`,
    })),
  );
  return [...planned, ...recurring];
}

/** Each member's balance in the Group, in major units, as the server calculates it. */
function balancesOf(plan: {
  currency: string;
  expenses: Array<Omit<Parameters<typeof normalizeExpenseMoney>[0], 'currency'>>;
  settlements: Array<{ paidBy: string; paidTo: string; amount: number }>;
}) {
  const expenses = plan.expenses.map((expense) => {
    const money = normalizeExpenseMoney({ ...expense, currency: plan.currency });
    return {
      currency: plan.currency,
      moneyVersion: 1,
      paidBy: money.paidBy.map((row) => ({ ...row, user: String(row.user) })),
      splitBetween: money.splitBetween.map((row) => ({ ...row, user: String(row.user) })),
    };
  });
  const net = calculateNetBalancesMinor(
    expenses,
    plan.settlements.map((settlement) => ({ ...settlement, currency: plan.currency })),
    plan.currency,
  );
  return new Map(net.map((row) => [row.userId, toMajorAmount(row.amountMinor, plan.currency)]));
}

function demoGroupBalances(plan: DemoGroupPlan) {
  return balancesOf({
    currency: plan.currency,
    expenses: ledgerExpenses(plan),
    settlements: plan.settlements,
  });
}

function goaBalances() {
  const goa = buildDemoSeedPlan();
  return balancesOf({
    currency: goa.currency,
    expenses: goa.expenses,
    settlements: [goa.settlement],
  });
}

const month = (day: string) => day.slice(0, 7);

function monthsBefore(now: Date, count: number): string[] {
  const months: string[] = [];
  for (let monthsAgo = count; monthsAgo >= 1; monthsAgo -= 1) {
    months.push(month(calendarDayInMonth(monthsAgo, 1, now)));
  }
  return months;
}

describe('demo Groups beside the Goa trip', () => {
  it('adds a Household, a Trip and a Work Group with fixed ids clear of other fixtures', () => {
    const plans = buildDemoGroupsPlan(NOW);

    expect(plans.map((plan) => plan.category).sort()).toEqual(['home', 'trip', 'work']);
    expect(DEMO_SEEDED_GROUP_IDS).toEqual(
      [DEMO_GROUP_ID, ...plans.map((plan) => plan.groupId)].sort(),
    );
    expect(new Set(DEMO_SEEDED_GROUP_IDS).size).toBe(DEMO_SEEDED_GROUP_IDS.length);
    // The mobile backend adds Maple House (…020) and Alex's private Group (…030), and its
    // verifiers use …099 as an id that matches nothing.
    for (const reserved of [
      'a00000000000000000000020',
      'a00000000000000000000030',
      'a00000000000000000000099',
    ]) {
      expect(DEMO_SEEDED_GROUP_IDS).not.toContain(reserved);
    }
    for (const plan of plans) {
      expect(plan.groupId).toMatch(/^[0-9a-f]{24}$/);
      expect(plan.memberIds[0]).toBe(plan.adminId);
      expect(new Set(plan.memberIds).size).toBe(plan.memberIds.length);
    }
  });

  it('gives each demo Group its default Tags, with fixed ids no other record uses', () => {
    const ids = buildDemoGroupsPlan(NOW).flatMap((plan) => {
      const tags = demoGroupTags(plan);
      expect(tags.map((tag) => tag.name)).toEqual([...defaultTagsForCategory(plan.category)]);
      return tags.map((tag) => tag.id);
    });
    for (const id of ids) expect(id).toMatch(/^b[0-9a-f]{23}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only the fictional personas and keeps each Group in one currency', () => {
    const personaIds = new Set(DEMO_PERSONAS.map((persona) => persona.id));
    const personaEmails = new Set(DEMO_PERSONAS.map((persona) => persona.email));

    for (const plan of buildDemoGroupsPlan(NOW)) {
      expect(plan.currency).toBe('INR');
      for (const memberId of plan.memberIds) expect(personaIds.has(memberId)).toBe(true);
      for (const invitation of plan.invitations) {
        expect(personaEmails.has(invitation.email)).toBe(true);
      }
      // Seeded amounts carry no currency of their own: every write uses the Group's.
      for (const expense of [...plan.expenses, ...plan.recurring]) {
        expect(expense).not.toHaveProperty('currency');
      }
    }
  });

  it('keeps every Expense valid for its Group: members, Tags, Categories and exact splits', () => {
    for (const plan of buildDemoGroupsPlan(NOW)) {
      const members = new Set(plan.memberIds);
      const tags = new Set(defaultTagsForCategory(plan.category));
      const keys = new Set(plan.expenses.map((expense) => expense.key));
      expect(keys.size, `${plan.key} keys`).toBe(plan.expenses.length);

      for (const expense of [...plan.expenses, ...plan.recurring]) {
        const label = `${plan.key}/${expense.key}`;
        expect(tags.has(expense.tag), `${label} tag`).toBe(true);
        expect(CATEGORY_IDS, `${label} category`).toContain(expense.category);
        for (const row of [...expense.paidBy, ...expense.splitBetween]) {
          expect(members.has(row.user), `${label} member`).toBe(true);
        }
        // Throws on an allocation that does not add up to the amount, to the paisa.
        expect(() => normalizeExpenseMoney({ ...expense, currency: plan.currency })).not.toThrow();
      }
      for (const edit of plan.edits) {
        expect(keys.has(edit.expenseKey), `${plan.key} edit target`).toBe(true);
        if (edit.change.tag) expect(tags.has(edit.change.tag)).toBe(true);
      }
      for (const deletion of plan.deletions) {
        expect(keys.has(deletion.expenseKey), `${plan.key} deletion target`).toBe(true);
        expect(plan.edits.some((edit) => edit.expenseKey === deletion.expenseKey)).toBe(false);
      }
      for (const settlement of plan.settlements) {
        expect(members.has(settlement.paidBy) && members.has(settlement.paidTo)).toBe(true);
        expect(settlement.paidBy).not.toBe(settlement.paidTo);
      }
    }
  });

  it('gives the Household six-plus months of Expenses across Tags, Categories and payers', () => {
    for (const now of RUN_DATES) {
      const household = groupOf(buildDemoGroupsPlan(now), 'household');
      const expenses = ledgerExpenses(household);
      const byMonth = new Map<string, number>();
      for (const expense of expenses) {
        byMonth.set(month(expense.date), (byMonth.get(month(expense.date)) ?? 0) + 1);
      }

      // Every one of the six Months before the run date's has several Expenses, and so does
      // the run date's own Month (its recurring bills).
      for (const past of monthsBefore(now, 6)) {
        expect(byMonth.get(past) ?? 0, `${now.toISOString()} ${past}`).toBeGreaterThanOrEqual(4);
      }
      expect(byMonth.get(toPeriod(now)) ?? 0).toBeGreaterThanOrEqual(2);

      expect(new Set(expenses.map((expense) => expense.tag)).size).toBeGreaterThanOrEqual(5);
      expect(new Set(expenses.map((expense) => expense.category)).size).toBeGreaterThanOrEqual(5);
      expect(
        new Set(expenses.flatMap((expense) => expense.paidBy.map((payer) => payer.user))),
      ).toEqual(new Set([alex, sam, priya]));
      expect(new Set(household.expenses.map((expense) => expense.splitMethod)).size).toBe(4);
    }
  });

  it('dates nothing after the run date, and keeps monthly bills off the edges of a month', () => {
    for (const now of RUN_DATES) {
      const twoDaysAgo = calendarDaysAgo(2, now);
      for (const plan of buildDemoGroupsPlan(now)) {
        for (const expense of plan.expenses) {
          expect(expense.date <= twoDaysAgo, `${plan.key}/${expense.key}`).toBe(true);
          expect(expense.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
      // A bill on day 2–28 at UTC midnight is in the same Month from UTC−12 to UTC+14.
      const household = groupOf(buildDemoGroupsPlan(now), 'household');
      const monthlyBills = household.expenses.filter((expense) =>
        /^(cook|electricity|gas)-/.test(expense.key),
      );
      expect(monthlyBills.length).toBe(15);
      for (const bill of monthlyBills) {
        const day = Number(bill.date.slice(8, 10));
        expect(day).toBeGreaterThanOrEqual(2);
        expect(day).toBeLessThanOrEqual(28);
      }
    }
  });

  it('records edits and a deletion in the Household so its history shows', () => {
    const household = groupOf(buildDemoGroupsPlan(NOW), 'household');

    expect(household.edits.some((edit) => edit.change.amount !== undefined)).toBe(true);
    expect(household.edits.some((edit) => edit.change.description !== undefined)).toBe(true);
    expect(household.edits.some((edit) => edit.change.tag !== undefined)).toBe(true);
    expect(household.deletions.length).toBeGreaterThanOrEqual(1);
    expect(new Set(household.edits.map((edit) => edit.editedBy)).size).toBeGreaterThan(1);
  });

  it('gives the Household monthly recurring templates due in every Month since they started', () => {
    for (const now of RUN_DATES) {
      const household = groupOf(buildDemoGroupsPlan(now), 'household');
      expect(getGroupTheme(household.category).recurringExpenses).toBe(true);
      expect(household.recurring.length).toBeGreaterThanOrEqual(2);

      for (const template of household.recurring) {
        expect(template.createdBy).toBe(household.adminId);
        expect(template.dayOfMonth).toBeGreaterThanOrEqual(2);
        expect(template.dayOfMonth).toBeLessThanOrEqual(28);
        expect(template.startsOn).toBe(calendarDayInMonth(6, 1, now));
        // Seven consecutive Months, from six Months back to the run date's own.
        expect(template.periods).toHaveLength(7);
        expect(template.periods.at(-1)).toBe(toPeriod(now));
        template.periods.slice(1).forEach((period, index) => {
          expect(period).toBe(nextPeriod(template.periods[index]));
        });
      }
    }
  });

  it('gives the Kerala trip six days, Expenses on most of them and payments left to settle', () => {
    for (const now of RUN_DATES) {
      const trip = groupOf(buildDemoGroupsPlan(now), 'weekTrip');
      const start = Date.parse(`${trip.startDate}T00:00:00Z`);
      const end = Date.parse(`${trip.endDate}T00:00:00Z`);
      const tripDays = (end - start) / 86_400_000 + 1;
      expect(tripDays).toBe(6);

      const spendingDays = new Set(trip.expenses.map((expense) => expense.date));
      for (const day of spendingDays) {
        expect(day >= trip.startDate! && day <= trip.endDate!).toBe(true);
      }
      expect(spendingDays.size).toBeGreaterThan(tripDays / 2);
      expect(trip.memberIds).toHaveLength(3);

      const balances = demoGroupBalances(trip);
      const debts = simplifyDebts(
        [...balances].map(([userId, amount]) => ({ userId, amount })),
        trip.currency,
      );
      expect(debts.length).toBeGreaterThan(0);
    }
  });

  it('gives the Work Group a different member mix, settled, with an invitation out', () => {
    const work = groupOf(buildDemoGroupsPlan(NOW), 'work');
    const priyaEmail = DEMO_PERSONAS.find((persona) => persona.id === priya)!.email;

    expect(work.memberIds).toEqual([alex, sam]);
    expect(work.invitations).toEqual([{ email: priyaEmail, invitedBy: alex }]);
    expect([...demoGroupBalances(work).values()].every((amount) => amount === 0)).toBe(true);
  });

  it('settles on the same balances whatever the run date', () => {
    for (const now of RUN_DATES) {
      const plans = buildDemoGroupsPlan(now);
      expect(Object.fromEntries(demoGroupBalances(groupOf(plans, 'household')))).toEqual({
        [priya]: 5972.46,
        [alex]: -2726.77,
        [sam]: -3245.69,
      });
      expect(Object.fromEntries(demoGroupBalances(groupOf(plans, 'weekTrip')))).toEqual({
        [sam]: 2812,
        [alex]: -8661,
        [priya]: 5849,
      });
    }
  });

  it('gives every persona a sensible Home without changing the Goa figures', () => {
    const goa = goaBalances();
    const groups = [goa, ...buildDemoGroupsPlan(NOW).map(demoGroupBalances)];

    for (const persona of [alex, sam, priya]) {
      const own = groups.map((balances) => balances.get(persona) ?? 0);
      expect(
        own.some((amount) => amount < 0),
        `${persona} owes somewhere`,
      ).toBe(true);
      expect(
        own.some((amount) => amount > 0),
        `${persona} is owed somewhere`,
      ).toBe(true);
    }

    // The demo journeys check Alex's ₹6,160 owed and Priya's ₹4,680 owing on Home: both
    // still come from Goa alone.
    const owedTo = (persona: string) =>
      groups.reduce((sum, balances) => sum + Math.max(0, balances.get(persona) ?? 0), 0);
    const owedBy = (persona: string) =>
      groups.reduce((sum, balances) => sum + Math.max(0, -(balances.get(persona) ?? 0)), 0);
    expect(goa.get(alex)).toBe(6160);
    expect(owedTo(alex)).toBe(6160);
    expect(owedBy(alex)).not.toBe(6160);
    expect(goa.get(priya)).toBe(-4680);
    expect(owedBy(priya)).toBe(4680);
    expect(owedTo(priya)).not.toBe(4680);

    // Alex and Sam share a settled Group; Priya has an invitation.
    const work = groupOf(buildDemoGroupsPlan(NOW), 'work');
    expect(work.memberIds).toEqual(expect.arrayContaining([alex, sam]));
    expect(work.memberIds).not.toContain(priya);
  });

  it('is deterministic: the same run date always gives the same plan', () => {
    expect(buildDemoGroupsPlan(NOW)).toEqual(buildDemoGroupsPlan(new Date(NOW)));
    // Any time on the same UTC day gives the same plan.
    expect(buildDemoGroupsPlan(new Date('2026-10-06T00:00:00.000Z'))).toEqual(
      buildDemoGroupsPlan(new Date('2026-10-06T23:59:59.999Z')),
    );
  });

  it('counts calendar days and Months in UTC', () => {
    const now = new Date('2026-03-31T23:30:00.000Z');
    expect(calendarDaysAgo(0, now)).toBe('2026-03-31');
    expect(calendarDaysAgo(31, now)).toBe('2026-02-28');
    expect(calendarDayInMonth(1, 28, now)).toBe('2026-02-28');
    expect(calendarDayInMonth(3, 2, now)).toBe('2025-12-02');
    expect(() => calendarDayInMonth(1, 29, now)).toThrow();
  });

  it('writes a Group’s ledger only while it has none', () => {
    expect(shouldInsertDemoLedger({ expenseCount: 0, settlementCount: 0, recurringCount: 0 })).toBe(
      true,
    );
    expect(shouldInsertDemoLedger({ expenseCount: 1, settlementCount: 0, recurringCount: 0 })).toBe(
      false,
    );
    expect(shouldInsertDemoLedger({ expenseCount: 0, settlementCount: 1, recurringCount: 0 })).toBe(
      false,
    );
    expect(shouldInsertDemoLedger({ expenseCount: 0, settlementCount: 0, recurringCount: 1 })).toBe(
      false,
    );
  });
});
