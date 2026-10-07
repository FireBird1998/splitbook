import { describe, expect, it } from 'vitest';
import type { GroupInsightsRead } from '@splitbook/shared/group-insights-read';
import {
  insightsHref,
  insightsStats,
  monthSteps,
  monthlySpending,
  monthsSpan,
  otherCurrenciesNote,
  payersLine,
  readInsightsAddress,
  signedPercent,
} from './group-insights';

/*
 * The Insights tab's words and figures (#314), from a fictional Household's read. Month names
 * come from `YYYY-MM` keys, never from a clock, so these hold in every time zone.
 */

const GROUP = 'c00000000000000000000001';
const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';

const month = (
  key: string,
  spentMinor: number,
  extra: Partial<GroupInsightsRead['months'][0]> = {},
) => ({
  month: key,
  spentMinor,
  expenseCount: 10,
  yourShareMinor: Math.round(spentMinor / 3),
  youPaidMinor: 0,
  recurringCount: 2,
  ...extra,
});

/** September against April–August (PR #242's example). */
const READ: GroupInsightsRead = {
  timeZone: 'Asia/Kolkata',
  month: '2026-09',
  compare: 5,
  firstMonth: '2026-03',
  currency: 'INR',
  window: { from: '2026-04-01', to: '2026-09-30' },
  months: [
    month('2026-04', 1698000),
    month('2026-05', 1764000),
    month('2026-06', 1921000),
    month('2026-07', 1805000),
    month('2026-08', 1738500),
    month('2026-09', 1842000, {
      expenseCount: 14,
      yourShareMinor: 614000,
      youPaidMinor: 521000,
      recurringCount: 3,
    }),
  ],
  average: { monthCount: 5, spentMinor: 1785300, yourShareMinor: 595100, youPaidMinor: 0 },
  change: { direction: 'up', differenceMinor: 56700, changePercent: 3.2 },
  biggestExpense: {
    id: 'd00000000000000000000001',
    description: 'Cook (September)',
    amountMinor: 300000,
    date: '2026-09-05T00:00:00.000Z',
    paidBy: [{ id: PRIYA, name: 'Priya Shah' }],
  },
  otherCurrencies: [],
  recurringExpenses: true,
  hasExpenses: true,
};

/** A Month as the read gives it while recurring Expenses are off: no recurring count. */
const withoutRecurringCount = (entry: GroupInsightsRead['months'][number]) => ({
  month: entry.month,
  spentMinor: entry.spentMinor,
  expenseCount: entry.expenseCount,
  yourShareMinor: entry.yourShareMinor,
  youPaidMinor: entry.youPaidMinor,
});

describe('the address', () => {
  const params = (query: string) => new URLSearchParams(query);

  it('opens the current Month against the six before it when it names neither', () => {
    expect(readInsightsAddress(params(''), '2026-10')).toEqual({ month: '2026-10', compare: 6 });
  });

  it('keeps a past Month and a count it offers', () => {
    expect(readInsightsAddress(params('month=2025-12&compare=12'), '2026-10')).toEqual({
      month: '2025-12',
      compare: 12,
    });
    expect(readInsightsAddress(params('compare=1'), '2026-10').compare).toBe(1);
  });

  it('shows the current Month instead of a later or malformed one', () => {
    for (const month of ['2026-11', '2030-01', '2026-13', 'soon', '2026-9'])
      expect(readInsightsAddress(params(`month=${month}`), '2026-10').month, month).toBe('2026-10');
  });

  it('compares with six months for a count it doesn’t offer', () => {
    for (const compare of ['0', '3', '13', 'six', '6.5'])
      expect(readInsightsAddress(params(`compare=${compare}`), '2026-10').compare, compare).toBe(6);
  });

  it('names only what isn’t the default, so the bare address is the current Month', () => {
    const at = (month: string, compare: 1 | 6 | 12) =>
      insightsHref(GROUP, { month, compare }, '2026-10');
    expect(at('2026-10', 6)).toBe(`/groups/${GROUP}/insights`);
    expect(at('2026-09', 6)).toBe(`/groups/${GROUP}/insights?month=2026-09`);
    expect(at('2026-10', 12)).toBe(`/groups/${GROUP}/insights?compare=12`);
    expect(at('2025-12', 1)).toBe(`/groups/${GROUP}/insights?month=2025-12&compare=1`);
  });
});

describe('Month navigation', () => {
  it('goes back and forward a Month, across the year', () => {
    expect(monthSteps('2026-01', { currentMonth: '2026-10', firstMonth: null })).toEqual({
      previous: { month: '2025-12', label: 'December 2025', reason: null },
      next: { month: '2026-02', label: 'February 2026', reason: null },
    });
  });

  it('stops at the current Month, and says why', () => {
    expect(monthSteps('2026-10', { currentMonth: '2026-10', firstMonth: null }).next.reason).toBe(
      'October is the current month',
    );
  });

  it('stops at the Group’s first Month once the read says which it is', () => {
    expect(
      monthSteps('2026-03', { currentMonth: '2026-10', firstMonth: '2026-03' }).previous.reason,
    ).toBe('this Group has nothing before March 2026');
    expect(
      monthSteps('2026-04', { currentMonth: '2026-10', firstMonth: '2026-03' }).previous.reason,
    ).toBeNull();
  });
});

describe('the stat cards', () => {
  const stats = (read: GroupInsightsRead = READ, recurringTheme = true) =>
    insightsStats(read, { userId: ALEX, recurringTheme });

  it('show Spent with its change against the average of the earlier months', () => {
    expect(stats()).toMatchObject({
      monthLong: 'September 2026',
      spent: {
        text: '₹18,420.00',
        change: {
          direction: 'up',
          headline: '+3.2%',
          against: 'vs 5-month average',
          averageText: '₹17,853.00',
        },
        noComparison: null,
      },
      share: { text: '₹6,140.00', paidText: '₹5,210.00' },
      expenses: { count: 14, recurringLine: '3 added by recurring Expenses' },
      biggest: { text: '₹3,000.00', line: 'Cook (September) · Priya Shah paid' },
    });
  });

  it('name a one-month average by its Month, and a fall with a minus sign', () => {
    const read: GroupInsightsRead = {
      ...READ,
      compare: 1,
      months: READ.months.slice(-2),
      average: { monthCount: 1, spentMinor: 1900000, yourShareMinor: 0, youPaidMinor: 0 },
      change: { direction: 'down', differenceMinor: -58000, changePercent: -3.1 },
    };
    expect(stats(read).spent.change).toEqual({
      direction: 'down',
      headline: '−3.1%',
      against: 'vs August',
      averageText: '₹19,000.00',
    });
  });

  it('give the difference when the average is zero, where a percentage means nothing', () => {
    const read: GroupInsightsRead = {
      ...READ,
      average: { ...READ.average!, spentMinor: 0 },
      change: { direction: 'up', differenceMinor: 1842000, changePercent: null },
    };
    expect(stats(read).spent.change?.headline).toBe('+₹18,420.00');
  });

  it('say there is nothing to compare in the Group’s first Month', () => {
    const first: GroupInsightsRead = {
      ...READ,
      firstMonth: '2026-09',
      months: READ.months.slice(-1),
      average: null,
      change: null,
    };
    expect(stats(first).spent).toEqual({
      text: '₹18,420.00',
      change: null,
      noComparison: 'The Group’s first month: nothing earlier to compare',
    });
  });

  it('hide the recurring count while recurring Expenses are off', () => {
    const off: GroupInsightsRead = {
      ...READ,
      recurringExpenses: false,
      months: READ.months.map(withoutRecurringCount),
    };
    expect(stats(off).expenses).toEqual({ count: 14, recurringLine: null });
  });

  it('say none were added where the Theme has recurring Expenses, and nothing where it doesn’t', () => {
    const none: GroupInsightsRead = {
      ...READ,
      months: READ.months.map((entry) => ({ ...entry, recurringCount: 0 })),
    };
    expect(stats(none, true).expenses.recurringLine).toBe('None added by recurring Expenses');
    expect(stats(none, false).expenses.recurringLine).toBeNull();
  });

  it('have no biggest Expense in a Month without Expenses', () => {
    expect(stats({ ...READ, biggestExpense: null }).biggest).toBeNull();
  });
});

describe('who paid the biggest Expense', () => {
  it('reads "You" for the viewer, and stays short with several payers', () => {
    const payer = (id: string, name: string) => ({ id, name });
    expect(payersLine([payer(ALEX, 'Alex Rivera')], ALEX)).toBe('You paid');
    expect(payersLine([payer(SAM, 'Sam Chen'), payer(PRIYA, 'Priya Shah')], ALEX)).toBe(
      'Sam Chen and Priya Shah paid',
    );
    expect(
      payersLine(
        [payer(ALEX, 'Alex Rivera'), payer(SAM, 'Sam Chen'), payer(PRIYA, 'Priya Shah')],
        ALEX,
      ),
    ).toBe('You and 2 others paid');
  });
});

describe('monthly spending', () => {
  it('has a row per Month, the Month last, and the average of the earlier ones', () => {
    const model = monthlySpending(READ, { currentMonth: '2026-10' });
    expect(model.rows.map((row) => [row.long, row.spentText, row.focus])).toEqual([
      ['April 2026', '₹16,980.00', false],
      ['May 2026', '₹17,640.00', false],
      ['June 2026', '₹19,210.00', false],
      ['July 2026', '₹18,050.00', false],
      ['August 2026', '₹17,385.00', false],
      ['September 2026', '₹18,420.00', true],
    ]);
    expect(model.average).toEqual({
      spent: 17853,
      spentText: '₹17,853.00',
      shareText: '₹5,951.00',
      name: '5-month average',
      shortName: '5-month avg',
      rowLabel: '5-month average',
    });
    expect(model.subtitle).toBe('INR · April to September 2026 · whole Group');
    expect(model.explanation).toBe('September is ₹567.00 above the 5-month average.');
    expect(model.focusComparison).toBe('₹567.00 above the 5-month average');
  });

  it('says "so far" of the current Month, and says when it matches', () => {
    const level: GroupInsightsRead = {
      ...READ,
      change: { direction: 'level', differenceMinor: 0, changePercent: 0 },
    };
    expect(monthlySpending(level, { currentMonth: '2026-09' }).explanation).toBe(
      'So far, September matches the 5-month average.',
    );
  });

  it('says why the average covers fewer months than asked for', () => {
    const young: GroupInsightsRead = { ...READ, compare: 12 };
    expect(monthlySpending(young, { currentMonth: '2026-10' }).explanation).toBe(
      'September is ₹567.00 above the 5-month average. This Group started in March 2026, so the average covers 5 months.',
    );
  });

  it('compares a one-month average with that Month by name', () => {
    const read: GroupInsightsRead = {
      ...READ,
      compare: 1,
      months: READ.months.slice(-2),
      average: { monthCount: 1, spentMinor: 1738500, yourShareMinor: 0, youPaidMinor: 0 },
      change: { direction: 'up', differenceMinor: 103500, changePercent: 6 },
    };
    const model = monthlySpending(read, { currentMonth: '2026-10' });
    expect(model.average).toMatchObject({
      name: 'August',
      shortName: 'August',
      rowLabel: 'Month before',
    });
    expect(model.explanation).toBe('September is ₹1,035.00 above August.');
  });

  it('has no average in the Group’s first Month', () => {
    const first: GroupInsightsRead = {
      ...READ,
      firstMonth: '2026-09',
      months: READ.months.slice(-1),
      window: { from: '2026-09-01', to: '2026-09-30' },
      average: null,
      change: null,
    };
    const model = monthlySpending(first, { currentMonth: '2026-10' });
    expect(model.average).toBeNull();
    expect(model.subtitle).toBe('INR · September 2026 · whole Group');
    expect(model.explanation).toBe(
      'September is this Group’s first month, so there is nothing earlier to compare it with yet.',
    );
  });

  it('spans a window across the year with both years', () => {
    expect(monthsSpan(['2025-10', '2025-11', '2026-09'])).toBe('October 2025 to September 2026');
  });
});

describe('a legacy Group with Expenses in other currencies', () => {
  it('says they are left out, never converted', () => {
    expect(
      otherCurrenciesNote({
        ...READ,
        otherCurrencies: [
          { currency: 'EUR', spentMinor: 2550, expenseCount: 2 },
          { currency: 'USD', spentMinor: 500, expenseCount: 1 },
        ],
      }),
    ).toBe(
      'Only INR Expenses are counted here. 3 Expenses in these months are in another currency and left out, never converted: 2 in EUR (€25.50), 1 in USD ($5.00).',
    );
    expect(otherCurrenciesNote(READ)).toBeNull();
  });
});

describe('percentages', () => {
  it('have one decimal and a real minus sign', () => {
    expect(signedPercent(2.6)).toBe('+2.6%');
    expect(signedPercent(-5.4)).toBe('−5.4%');
    expect(signedPercent(25)).toBe('+25.0%');
    expect(signedPercent(0)).toBe('0.0%');
    expect(signedPercent(33233.3)).toBe('+33,233.3%');
  });
});
