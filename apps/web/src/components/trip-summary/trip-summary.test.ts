import { describe, expect, it } from 'vitest';
import { tripSummary, type TripExpense } from '@splitbook/shared/trip-summary';
import {
  parseTripSummaryResponse,
  type TripSummaryRead,
} from '@splitbook/shared/trip-summary-read';
import { tripDayLabel, tripDayName, tripDayNumber, tripDayShort } from './trip-days';
import {
  otherCurrenciesNote,
  tagExpensesHref,
  tripCardState,
  tripDayChart,
  tripFigures,
  tripTags,
  wrapUp,
} from './trip-summary';

/*
 * What a Trip's Insights tab says (#316), from a Trip summary read built by the shared Trip
 * summary itself. Days are calendar days, so their labels are the same in any zone these tests
 * run in. Fictional people, Tags and figures.
 */

const GROUP = 'c00000000000000000000001';
const ALEX = { id: 'a00000000000000000000001', name: 'Alex Rivera' };
const SAM = { id: 'a00000000000000000000002', name: 'Sam Chen' };
const PRIYA = { id: 'a00000000000000000000003', name: 'Priya Shah' };
const PEOPLE = [ALEX, SAM, PRIYA];
const TRANSPORT = { id: 'e00000000000000000000001', name: 'Transport' };
const STAY = { id: 'e00000000000000000000002', name: 'Stay' };

let sequence = 0;
function expense(
  day: string,
  description: string,
  payer: { id: string },
  shares: number[],
  tag: TripExpense['tag'] = TRANSPORT,
): TripExpense {
  sequence += 1;
  const total = shares.reduce((sum, share) => sum + share, 0);
  return {
    id: `d${String(sequence).padStart(23, '0')}`,
    description,
    currency: 'INR',
    date: `${day}T00:00:00Z`,
    moneyVersion: 1,
    amount: total / 100,
    amountMinor: total,
    paidBy: [{ user: payer.id, amount: total / 100, amountMinor: total }],
    splitBetween: shares.map((share, index) => ({
      user: PEOPLE[index].id,
      amount: share / 100,
      amountMinor: share,
    })),
    tag,
  };
}

const EXPENSES = [
  expense('2026-09-17', 'Airport cab', SAM, [21333, 21334, 21333]),
  expense('2026-09-18', 'Villa stay', SAM, [93333, 93334, 93333], STAY),
  expense('2026-09-18', 'Breakfast café', PRIYA, [12667, 12667, 12666], { id: null, name: 'Café' }),
  expense('2026-09-20', 'Scooter rental', ALEX, [80000, 80000, 80000]),
];

function read(overrides: Partial<Parameters<typeof tripSummary>[0]> = {}): TripSummaryRead {
  const summary = tripSummary({
    memberId: ALEX.id,
    timeZone: 'Asia/Kolkata',
    currency: 'INR',
    startDate: '2026-09-17T00:00:00Z',
    endDate: '2026-09-20T00:00:00Z',
    expenses: EXPENSES,
    ...overrides,
  });
  const named = (id: string) => PEOPLE.find((person) => person.id === id)!;
  // As the route sends it, through the read's own decoder.
  return parseTripSummaryResponse({
    status: 200,
    data: {
      ...summary,
      suggestedPayments: summary.suggestedPayments.map((payment) => ({
        from: named(payment.from),
        to: named(payment.to),
        amountMinor: payment.amountMinor,
      })),
      hasExpenses: true,
    },
  });
}

describe('trip days', () => {
  it('read like the Expenses table’s dates, the year only when it isn’t this one', () => {
    expect(tripDayLabel('2026-09-18', 2026)).toBe('Fri 18 Sep');
    expect(tripDayLabel('2025-09-18', 2026)).toBe('Thu 18 Sep 2025');
    expect(tripDayShort('2026-09-18')).toBe('Fri 18');
  });

  it('are numbered from the Trip’s first day, and named outside its dates', () => {
    const dates = { start: '2026-09-17', end: '2026-09-20', thisYear: 2026 };
    expect(tripDayNumber('2026-09-18', '2026-09-17')).toBe(2);
    expect(tripDayName('2026-09-18', dates)).toBe('Day 2 · Fri 18 Sep');
    expect(tripDayName('2026-09-16', dates)).toBe('Before the trip · Wed 16 Sep');
    expect(tripDayName('2026-09-21', dates)).toBe('After the trip · Mon 21 Sep');
    expect(tripDayName('2026-09-18', { ...dates, start: null })).toBe('Fri 18 Sep');
  });
});

describe('the card state', () => {
  it('is loading, failed, empty or ready', () => {
    expect(tripCardState(undefined, false)).toBe('loading');
    expect(tripCardState(undefined, true)).toBe('failed');
    expect(tripCardState({ ...read(), hasExpenses: false }, false)).toBe('empty');
    expect(tripCardState(read(), true)).toBe('ready');
  });
});

describe('the whole trip', () => {
  it('says what was spent, the member’s share, what they paid, and per person per day', () => {
    expect(tripFigures(read())).toEqual({
      heading: 'Whole trip · INR',
      spent: { text: '₹6,220.00', line: '4 Expenses over 4 days' },
      share: { text: '₹2,073.33', line: 'In all 4 of its Expenses' },
      paid: {
        text: '₹2,400.00',
        line: '₹326.67 more than your share',
        tone: 'positive',
      },
      // ₹6,220.00 ÷ (3 people × 4 days), rounded half up.
      perPersonPerDay: { text: '₹518.33', line: '3 people · 4 days' },
    });
    expect(tripFigures(read({ memberId: PRIYA.id })).paid).toEqual({
      text: '₹380.00',
      line: '₹1,693.32 less than your share',
      tone: 'neutral',
    });
    expect(
      tripFigures(
        read({
          expenses: [...EXPENSES, expense('2026-09-19', 'Tip', SAM, [0, 500])],
        }),
      ).share.line,
    ).toBe('In 4 of its 5 Expenses');
    expect(tripFigures(read({ expenses: [EXPENSES[0]] })).share.line).toBe('In its one Expense');
    expect(
      tripFigures(read({ expenses: [expense('2026-09-19', 'Tip', SAM, [0, 500])] })).share.line,
    ).toBe('Not in its one Expense');
  });

  it('notes a legacy Trip’s other currencies, never converted', () => {
    expect(otherCurrenciesNote(read())).toBeNull();
    const lounge = {
      ...expense('2026-09-17', 'Lounge', ALEX, [2500]),
      currency: 'EUR',
    };
    expect(otherCurrenciesNote(read({ expenses: [...EXPENSES, lounge] }))).toBe(
      'Only INR Expenses are counted here. One Expense is in another currency and left out, never converted: 1 in EUR (€25.00).',
    );
  });
});

describe('day by day', () => {
  it('names each day, its two biggest Expenses and the member’s share, and the biggest day', () => {
    const chart = tripDayChart(read(), { thisYear: 2026 });
    expect(chart.subtitle).toBe('INR spent each day · Thu 17 Sep to Sun 20 Sep');
    expect(chart.rows.map((row) => [row.name, row.axis, row.spentText, row.focus])).toEqual([
      ['Day 1 · Thu 17 Sep', 'Thu 17', '₹640.00', false],
      ['Day 2 · Fri 18 Sep', 'Fri 18', '₹3,180.00', true],
      ['Day 3 · Sat 19 Sep', 'Sat 19', '₹0.00', false],
      ['Day 4 · Sun 20 Sep', 'Sun 20', '₹2,400.00', false],
    ]);
    expect(chart.rows[1].biggest).toEqual([
      { description: 'Villa stay', amountText: '₹2,800.00' },
      { description: 'Breakfast café', amountText: '₹380.00' },
    ]);
    expect(chart.rows[1].shareText).toBe('₹1,060.00');
    expect(chart.average).toEqual({ spent: 1555, text: '₹1,555.00' });
    expect(chart.whole).toEqual({
      expenseCount: 4,
      spentText: '₹6,220.00',
      shareText: '₹2,073.33',
    });
    expect(chart.explanation).toBe(
      'Fri 18 Sep was the biggest day: Villa stay was ₹2,800.00 of its ₹3,180.00.',
    );
    expect(chart.outside).toEqual([]);
    expect(chart.outsideNote).toBeNull();
  });

  it('names Expenses outside the Trip’s dates under the chart, as rows of the table', () => {
    const booking = expense('2026-08-30', 'Train tickets', SAM, [20000, 20000, 20000]);
    const laundry = expense('2026-09-22', 'Laundry', PRIYA, [1000, 1000, 1000]);
    const chart = tripDayChart(read({ expenses: [...EXPENSES, booking, laundry] }), {
      thisYear: 2026,
    });
    expect(chart.rows).toHaveLength(4);
    expect(chart.outside).toEqual([
      {
        name: 'Before the trip',
        span: 'Sun 30 Aug',
        expenseCount: 1,
        spentText: '₹600.00',
        shareText: '₹200.00',
      },
      {
        name: 'After the trip',
        span: 'Tue 22 Sep',
        expenseCount: 1,
        spentText: '₹30.00',
        shareText: '₹10.00',
      },
    ]);
    expect(chart.outsideNote).toBe(
      'Expenses dated outside the trip’s days count in the whole trip, but aren’t drawn here: ₹600.00 before it (1 Expense) and ₹30.00 after it (1 Expense).',
    );
  });

  it('labels a long trip’s columns with the date alone, and says when it is too long to draw', () => {
    const tenDays = tripDayChart(read({ endDate: '2026-09-26T00:00:00Z' }), {
      thisYear: 2026,
    });
    expect(tenDays.rows.map((row) => row.axis).slice(0, 3)).toEqual(['17', '18', '19']);
    const long = tripDayChart(read({ endDate: '2027-03-01T00:00:00Z' }), {
      thisYear: 2026,
    });
    expect(long.rows).toEqual([]);
    expect(long.average).toBeNull();
    expect(long.explanation).toBe(
      'This trip runs over 166 days, too many to draw one by one. It spent ₹37.47 a day on average.',
    );
  });

  it('names the only Expense of a biggest day without "of its"', () => {
    const chart = tripDayChart(read({ expenses: [EXPENSES[3]] }), {
      thisYear: 2026,
    });
    expect(chart.explanation).toBe('Sun 20 Sep was the biggest day: Scooter rental, ₹2,400.00.');
  });
});

describe('By Tag', () => {
  it('links each Tag to the Expenses tab filtered by it, with its share of spend and count', () => {
    const rows = tripTags(read(), GROUP);
    expect(rows.map((row) => row.name)).toEqual(['Transport', 'Stay', 'Café']);
    expect(rows[0]).toEqual({
      key: TRANSPORT.id,
      name: 'Transport',
      spentText: '₹3,040.00',
      percentText: '49%',
      countText: '2 Expenses',
      width: 100,
      href: `/groups/${GROUP}/expenses?tag=${TRANSPORT.id}`,
      label: 'Transport: ₹3,040.00, 49% of INR spend, 2 Expenses. Show these Expenses',
    });
    expect(rows[1]).toMatchObject({
      name: 'Stay',
      percentText: '45%',
      countText: '1 Expense',
      width: 92.1,
      href: `/groups/${GROUP}/expenses?tag=${STAY.id}`,
    });
    // A legacy name no Tag matches can't filter the Expenses tab.
    expect(rows[2]).toMatchObject({
      name: 'Café',
      href: null,
      percentText: '6%',
      width: 12.5,
    });
    expect(rows[2].label).toBe('Café: ₹380.00, 6% of INR spend, 1 Expense');
  });

  it('uses the Expenses tab’s own Tag filter in the address', () => {
    expect(tagExpensesHref(GROUP, STAY.id)).toBe(`/groups/${GROUP}/expenses?tag=${STAY.id}`);
  });
});

describe('the wrap-up', () => {
  it('offers Record only on payments the member makes or receives', () => {
    // Priya owes Sam and Alex; Alex is a party only to the second.
    const model = wrapUp(read(), {
      groupId: GROUP,
      userId: ALEX.id,
      today: '2026-09-25',
    });
    expect(model.subtitle).toBe('The trip ended on Sun 20 Sep. Settle while it’s fresh.');
    expect(
      model.rows.map(({ title, amountText, record, note }) => ({
        title,
        amountText,
        record,
        note,
      })),
    ).toEqual([
      {
        title: 'Priya Shah pays Sam Chen',
        amountText: '₹1,366.65',
        record: null,
        note: 'Priya or Sam records it',
      },
      {
        title: 'Priya Shah pays you',
        amountText: '₹326.67',
        record: {
          href: `/groups/${GROUP}/balances?paidBy=${PRIYA.id}`,
          label: 'Record payment: Priya Shah pays you, ₹326.67',
        },
        note: null,
      },
    ]);
    expect(model.otherCurrencies).toBeNull();
  });

  it('links the payer’s own payments with the person they pay, never naming the viewer', () => {
    const model = wrapUp(read(), {
      groupId: GROUP,
      userId: PRIYA.id,
      today: '2026-09-19',
    });
    expect(model.subtitle).toBe('The trip runs until Sun 20 Sep. Here’s who would pay whom today.');
    expect(model.rows.map((row) => [row.title, row.record?.href ?? null])).toEqual([
      ['You pay Sam Chen', `/groups/${GROUP}/balances?paidTo=${SAM.id}`],
      ['You pay Alex Rivera', `/groups/${GROUP}/balances?paidTo=${ALEX.id}`],
    ]);
    for (const row of model.rows) expect(row.record!.href).not.toContain(PRIYA.id);
  });

  it('is empty once everyone has settled, and says so for a Trip without an end date', () => {
    const settled = read({
      endDate: null,
      settlements: [
        {
          currency: 'INR',
          amount: 1366.65,
          amountMinor: 136665,
          moneyVersion: 1,
          paidBy: PRIYA.id,
          paidTo: SAM.id,
        },
        {
          currency: 'INR',
          amount: 326.67,
          amountMinor: 32667,
          moneyVersion: 1,
          paidBy: PRIYA.id,
          paidTo: ALEX.id,
        },
      ],
    });
    const model = wrapUp(settled, {
      groupId: GROUP,
      userId: ALEX.id,
      today: '2026-09-25',
    });
    expect(model.rows).toEqual([]);
    expect(model.subtitle).toBe('Who pays whom to settle the trip.');
  });
});
