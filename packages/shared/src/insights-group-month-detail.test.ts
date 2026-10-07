import { describe, expect, it } from 'vitest';
import {
  groupMonthPaidAndShares,
  groupRecurringMonth,
  groupSpendingByTag,
  type GroupMonthDetailExpense,
  type InsightRecurringTemplate,
} from './insights';
import { MoneyValidationError } from './exact-money';
import { TimeZoneError } from './zoned-calendar';

/*
 * A Group's Month in detail on the Insights tab (#315): spending by Tag against each Tag's own
 * average (the Month never in it), each person's Paid against their Share, and the recurring
 * Expenses card. Every instant is written in UTC and every Month is bucketed in a named zone,
 * so the results are the same whatever zone the tests run in (CI also runs them in Tongatapu,
 * Kiritimati and Pago Pago). Fictional people, Tags and figures.
 */

const alex = 'a00000000000000000000001';
const sam = 'a00000000000000000000002';
const priya = 'a00000000000000000000003';
const jordan = 'a00000000000000000000004';

const tagId = (n: number) => `d${String(n).padStart(23, '0')}`;
const groceries = { _id: tagId(1), name: 'Groceries', isArchived: false };
const utilities = { _id: tagId(2), name: 'Utilities', isArchived: false };
const dining = { _id: tagId(3), name: 'Dining', isArchived: false };
const household = { _id: tagId(4), name: 'Household', isArchived: true };
const TAGS = [groceries, utilities, dining, household];

const id = (n: number) => `c${String(n).padStart(23, '0')}`;
let sequence = 0;

/** An exact Expense: `shares` maps each person to their share; `paid` to what they paid. */
function expense(
  date: string,
  shares: Record<string, number>,
  {
    paid,
    currency = 'INR',
    tag,
    tagName,
    recurringExpenseId = null,
  }: {
    paid?: Record<string, number>;
    currency?: string;
    tag?: { _id: string; name: string };
    /** Name only, as an older Expense stores it. */
    tagName?: string;
    recurringExpenseId?: string | null;
  } = {},
): GroupMonthDetailExpense {
  sequence += 1;
  const totalMinor = Object.values(shares).reduce((sum, share) => sum + share, 0);
  const payers = paid ?? { [Object.keys(shares)[0]]: totalMinor };
  const row = ([user, amountMinor]: [string, number]) => ({
    user,
    amountMinor,
    amount: amountMinor / 100,
  });
  return {
    id: id(sequence),
    description: 'Synthetic expense',
    currency,
    date,
    moneyVersion: 1,
    amountMinor: totalMinor,
    amount: totalMinor / 100,
    paidBy: Object.entries(payers).map(row),
    splitBetween: Object.entries(shares).map(row),
    recurring: recurringExpenseId !== null,
    recurringExpenseId,
    tagId: tag ? tag._id : null,
    tag: tag ? tag.name : (tagName ?? 'General'),
  };
}

function byTag(
  expenses: GroupMonthDetailExpense[],
  options: Partial<Parameters<typeof groupSpendingByTag>[0]> = {},
) {
  return groupSpendingByTag({
    timeZone: 'Asia/Kolkata',
    month: '2026-09',
    compare: 6,
    currency: 'INR',
    tags: TAGS,
    expenses,
    ...options,
  });
}

/** Each row as [name, spent, count, average, percent]. */
const table = (result: ReturnType<typeof groupSpendingByTag>) =>
  result.tags.map((row) => [
    row.name,
    row.spentMinor,
    row.expenseCount,
    row.averageMinor,
    row.changePercent,
  ]);

describe('spending by Tag', () => {
  it('compares each Tag’s Month with its own average, never including the Month', () => {
    const result = byTag(
      [
        expense('2026-07-10T06:00:00Z', { [alex]: 400000 }, { tag: groceries }),
        expense('2026-08-10T06:00:00Z', { [alex]: 443000 }, { tag: groceries }),
        expense('2026-09-03T06:00:00Z', { [alex]: 200000 }, { tag: groceries }),
        expense('2026-09-04T06:00:00Z', { [sam]: 198800 }, { tag: groceries }),
        expense('2026-08-28T06:00:00Z', { [alex]: 454000 }, { tag: utilities }),
        expense('2026-09-28T06:00:00Z', { [alex]: 496200 }, { tag: utilities }),
        // A very big September never lifts its own average.
        expense('2026-09-12T06:00:00Z', { [alex]: 9999900 }, { tag: dining }),
        expense('2026-08-12T06:00:00Z', { [alex]: 100 }, { tag: dining }),
      ],
      { compare: 2 },
    );
    expect(result.month).toBe('2026-09');
    expect(result.earlierMonths).toEqual(['2026-07', '2026-08']);
    expect(result.tags).toEqual([
      {
        tagId: dining._id,
        name: 'Dining',
        spentMinor: 9999900,
        expenseCount: 1,
        averageMinor: 50,
        differenceMinor: 9999850,
        direction: 'up',
        changePercent: 19999700,
      },
      {
        tagId: utilities._id,
        name: 'Utilities',
        spentMinor: 496200,
        expenseCount: 1,
        // ₹4,540.00 over two months (July had none): ₹2,270.00.
        averageMinor: 227000,
        differenceMinor: 269200,
        direction: 'up',
        changePercent: 118.6,
      },
      {
        tagId: groceries._id,
        name: 'Groceries',
        spentMinor: 398800,
        expenseCount: 2,
        // ₹8,430.00 over two months: ₹4,215.00, so September is 5.4% down.
        averageMinor: 421500,
        differenceMinor: -22700,
        direction: 'down',
        changePercent: -5.4,
      },
    ]);
  });

  it('rounds a half-unit average up and compares with the average as shown', () => {
    const result = byTag(
      [
        expense('2026-07-10T06:00:00Z', { [alex]: 100 }, { tag: groceries }),
        expense('2026-08-10T06:00:00Z', { [alex]: 101 }, { tag: groceries }),
        expense('2026-09-10T06:00:00Z', { [alex]: 101 }, { tag: groceries }),
      ],
      { compare: 2 },
    );
    expect(result.tags[0]).toMatchObject({
      averageMinor: 101,
      differenceMinor: 0,
      direction: 'level',
      changePercent: 0,
    });
  });

  it('averages fewer earlier Months when the Group started more recently', () => {
    const result = byTag(
      [
        expense('2026-08-10T06:00:00Z', { [alex]: 3000 }, { tag: groceries }),
        expense('2026-09-10T06:00:00Z', { [alex]: 1500 }, { tag: groceries }),
        // Before the Group's first Month: never averaged.
        expense('2026-06-10T06:00:00Z', { [alex]: 999900 }, { tag: groceries }),
      ],
      { compare: 12, firstMonth: '2026-08' },
    );
    expect(result.earlierMonths).toEqual(['2026-08']);
    expect(table(result)).toEqual([['Groceries', 1500, 1, 3000, -50]]);
  });

  it('has no average in a Month with no earlier Months to compare', () => {
    for (const firstMonth of ['2026-09', '2026-11']) {
      const result = byTag(
        [
          expense('2026-09-10T06:00:00Z', { [alex]: 1500 }, { tag: groceries }),
          expense('2026-08-10T06:00:00Z', { [alex]: 999 }, { tag: utilities }),
        ],
        { firstMonth },
      );
      expect(result.earlierMonths).toEqual([]);
      expect(result.tags).toEqual([
        {
          tagId: groceries._id,
          name: 'Groceries',
          spentMinor: 1500,
          expenseCount: 1,
          averageMinor: null,
          differenceMinor: null,
          direction: null,
          changePercent: null,
        },
      ]);
    }
  });

  it('counts an earlier Month without the Tag as zero, and keeps a Tag missing this Month', () => {
    const result = byTag(
      [
        expense('2026-06-10T06:00:00Z', { [alex]: 900 }, { tag: utilities }),
        expense('2026-08-10T06:00:00Z', { [alex]: 300 }, { tag: utilities }),
        expense('2026-09-10T06:00:00Z', { [alex]: 700 }, { tag: groceries }),
      ],
      { compare: 3 },
    );
    expect(result.earlierMonths).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(result.tags.find((row) => row.name === 'Utilities')).toEqual({
      tagId: utilities._id,
      name: 'Utilities',
      spentMinor: 0,
      expenseCount: 0,
      averageMinor: 400,
      differenceMinor: -400,
      direction: 'down',
      changePercent: -100,
    });
  });

  it('marks a Tag new this Month as up against an average of zero, with no percentage', () => {
    const result = byTag([
      expense('2026-08-10T06:00:00Z', { [alex]: 5000 }, { tag: groceries }),
      expense('2026-09-10T06:00:00Z', { [alex]: 4200 }, { tag: dining }),
    ]);
    expect(result.tags.find((row) => row.name === 'Dining')).toEqual({
      tagId: dining._id,
      name: 'Dining',
      spentMinor: 4200,
      expenseCount: 1,
      averageMinor: 0,
      differenceMinor: 4200,
      direction: 'up',
      changePercent: null,
    });
  });

  it('puts Expenses without one of the Group’s Tags in Untagged, always last', () => {
    const twin = { _id: tagId(9), name: 'Groceries', isArchived: false };
    const result = byTag(
      [
        // A stored id that is not one of the Group's Tags.
        expense('2026-09-01T06:00:00Z', { [alex]: 100 }, { tag: { _id: tagId(99), name: 'Old' } }),
        // An older Expense naming a Tag the Group doesn't have.
        expense('2026-09-02T06:00:00Z', { [alex]: 200 }, { tagName: 'Fuel' }),
        // An older Expense whose name matches two Tags: never guessed.
        expense('2026-09-03T06:00:00Z', { [alex]: 300 }, { tagName: 'Groceries' }),
        expense('2026-08-03T06:00:00Z', { [alex]: 1000 }, { tagName: 'Fuel' }),
        expense('2026-09-04T06:00:00Z', { [alex]: 50 }, { tag: utilities }),
      ],
      { compare: 1, tags: [...TAGS, twin] },
    );
    expect(table(result)).toEqual([
      ['Utilities', 50, 1, 0, null],
      [null, 600, 3, 1000, -40],
    ]);
    expect(result.tags.at(-1)?.tagId).toBeNull();
  });

  it('finds an older Expense’s Tag by its name, and an archived Tag by its id', () => {
    const result = byTag(
      [
        expense('2026-09-01T06:00:00Z', { [alex]: 100 }, { tagName: 'Groceries' }),
        expense('2026-09-02T06:00:00Z', { [alex]: 200 }, { tag: groceries }),
        // Archived since, and renamed: it keeps its Expenses, under its name now.
        expense('2026-09-03T06:00:00Z', { [alex]: 700 }, { tag: { ...household, name: 'Home' } }),
      ],
      { compare: 1 },
    );
    expect(table(result)).toEqual([
      ['Household', 700, 1, 0, null],
      ['Groceries', 300, 2, 0, null],
    ]);
  });

  it('orders equal spending by the higher average, then by name', () => {
    const result = byTag(
      [
        expense('2026-09-01T06:00:00Z', { [alex]: 500 }, { tag: utilities }),
        expense('2026-09-01T06:00:00Z', { [alex]: 500 }, { tag: groceries }),
        expense('2026-09-01T06:00:00Z', { [alex]: 500 }, { tag: dining }),
        expense('2026-08-01T06:00:00Z', { [alex]: 900 }, { tag: utilities }),
      ],
      { compare: 1 },
    );
    expect(result.tags.map((row) => row.name)).toEqual(['Utilities', 'Dining', 'Groceries']);
  });

  it('buckets Months in the viewer’s zone, and counts only the Group’s currency', () => {
    // 20:00 UTC on 31 August: September in Kolkata and Kiritimati, August in Pago Pago.
    const expenses = [
      expense('2026-08-31T20:00:00Z', { [alex]: 4200 }, { tag: groceries }),
      expense('2026-09-10T06:00:00Z', { [alex]: 999 }, { tag: groceries, currency: 'EUR' }),
      // Outside the Months compared.
      expense('2026-10-02T06:00:00Z', { [alex]: 777 }, { tag: groceries }),
    ];
    const spent = (timeZone: string) =>
      table(byTag(expenses, { timeZone, compare: 1 })).map((row) => row.slice(1, 4));
    expect(spent('Asia/Kolkata')).toEqual([[4200, 1, 0]]);
    expect(spent('Pacific/Kiritimati')).toEqual([[4200, 1, 0]]);
    expect(spent('Pacific/Pago_Pago')).toEqual([[0, 0, 4200]]);
  });

  it('is empty with nothing spent in these Months', () => {
    expect(byTag([]).tags).toEqual([]);
  });

  it('adds large values exactly', () => {
    const big = Math.floor(Number.MAX_SAFE_INTEGER / 4);
    const result = byTag(
      [
        expense('2026-07-10T06:00:00Z', { [alex]: big }, { tag: groceries }),
        expense('2026-08-10T06:00:00Z', { [alex]: big + 2 }, { tag: groceries }),
        expense('2026-09-10T06:00:00Z', { [alex]: big + 1 }, { tag: groceries }),
      ],
      { compare: 2 },
    );
    expect(result.tags[0]).toMatchObject({ averageMinor: big + 1, direction: 'level' });
  });

  it('refuses a zone that is not a named IANA zone', () => {
    expect(() => byTag([], { timeZone: '+05:30' })).toThrow(TimeZoneError);
  });
});

function paidAndShares(
  expenses: GroupMonthDetailExpense[],
  options: Partial<Parameters<typeof groupMonthPaidAndShares>[0]> = {},
) {
  return groupMonthPaidAndShares({
    timeZone: 'Asia/Kolkata',
    month: '2026-09',
    currency: 'INR',
    memberIds: [alex, sam, priya],
    expenses,
    ...options,
  });
}

describe('who paid in a Month', () => {
  it('gives each member their Paid against their Share, exact, adding up to the Month', () => {
    const month = [
      // A third of ₹1,000.00 each: the shares only add up exactly in minor units.
      expense('2026-09-02T06:00:00Z', { [alex]: 33334, [sam]: 33333, [priya]: 33333 }),
      // Uneven, paid by two.
      expense(
        '2026-09-05T06:00:00Z',
        { [alex]: 100000, [sam]: 50000, [priya]: 150000 },
        { paid: { [priya]: 200000, [sam]: 100000 } },
      ),
      // One cent, paid by the person who doesn't share it.
      expense('2026-09-06T06:00:00Z', { [sam]: 1 }, { paid: { [alex]: 1 } }),
    ];
    const rows = paidAndShares(month);
    // Most paid first: Alex's extra paisa puts Alex ahead of Sam.
    expect(rows).toEqual([
      { memberId: priya, isMember: true, paidMinor: 200000, shareMinor: 183333, netMinor: 16667 },
      { memberId: alex, isMember: true, paidMinor: 100001, shareMinor: 133334, netMinor: -33333 },
      { memberId: sam, isMember: true, paidMinor: 100000, shareMinor: 83334, netMinor: 16666 },
    ]);
    const spent = 100000 + 300000 + 1;
    expect(rows.reduce((sum, row) => sum + row.paidMinor, 0)).toBe(spent);
    expect(rows.reduce((sum, row) => sum + row.shareMinor, 0)).toBe(spent);
    expect(rows.reduce((sum, row) => sum + row.netMinor, 0)).toBe(0);
  });

  it('lists every member, even with nothing in the Month', () => {
    const rows = paidAndShares([expense('2026-09-02T06:00:00Z', { [alex]: 500 })]);
    expect(rows).toEqual([
      { memberId: alex, isMember: true, paidMinor: 500, shareMinor: 500, netMinor: 0 },
      { memberId: sam, isMember: true, paidMinor: 0, shareMinor: 0, netMinor: 0 },
      { memberId: priya, isMember: true, paidMinor: 0, shareMinor: 0, netMinor: 0 },
    ]);
    expect(paidAndShares([]).map((row) => row.paidMinor)).toEqual([0, 0, 0]);
  });

  it('keeps someone who left while the Month holds their Expenses, so the sums still add up', () => {
    const rows = paidAndShares([
      expense('2026-09-02T06:00:00Z', { [alex]: 300, [jordan]: 300 }, { paid: { [jordan]: 600 } }),
      // Named with a share of nothing: no row for someone who left.
      expense('2026-09-03T06:00:00Z', { [sam]: 100, a00000000000000000000009: 0 }),
    ]);
    expect(rows.find((row) => row.memberId === jordan)).toEqual({
      memberId: jordan,
      isMember: false,
      paidMinor: 600,
      shareMinor: 300,
      netMinor: 300,
    });
    expect(rows.map((row) => row.memberId)).not.toContain('a00000000000000000000009');
    expect(rows.reduce((sum, row) => sum + row.paidMinor, 0)).toBe(700);
    expect(rows.reduce((sum, row) => sum + row.shareMinor, 0)).toBe(700);
  });

  it('counts only the Month in the viewer’s zone, and only the Group’s currency', () => {
    const expenses = [
      expense('2026-08-31T20:00:00Z', { [alex]: 4200 }),
      expense('2026-09-10T06:00:00Z', { [sam]: 999 }, { currency: 'EUR' }),
    ];
    expect(paidAndShares(expenses)[0]).toMatchObject({ memberId: alex, paidMinor: 4200 });
    expect(paidAndShares(expenses, { timeZone: 'Pacific/Pago_Pago' })[0]).toMatchObject({
      paidMinor: 0,
    });
  });

  it('reads legacy amounts exactly, and refuses one more precise than its currency', () => {
    const legacy: GroupMonthDetailExpense = {
      id: id(500),
      description: 'Written before minor units',
      currency: 'INR',
      date: '2026-09-02T06:00:00Z',
      amount: 1000,
      paidBy: [{ user: sam, amount: 1000 }],
      splitBetween: [
        { user: alex, amount: 333.34 },
        { user: sam, amount: 666.66 },
      ],
      recurring: false,
    };
    expect(paidAndShares([legacy]).slice(0, 2)).toEqual([
      { memberId: sam, isMember: true, paidMinor: 100000, shareMinor: 66666, netMinor: 33334 },
      { memberId: alex, isMember: true, paidMinor: 0, shareMinor: 33334, netMinor: -33334 },
    ]);
    const tooPrecise = { ...legacy, paidBy: [{ user: sam, amount: 1000.001 }] };
    expect(() => paidAndShares([tooPrecise])).toThrow(MoneyValidationError);
  });

  it('orders equal Paids by the larger share, then by id', () => {
    const rows = paidAndShares([
      expense('2026-09-02T06:00:00Z', { [sam]: 100, [priya]: 300 }, { paid: { [priya]: 400 } }),
      expense('2026-09-03T06:00:00Z', { [alex]: 400 }, { paid: { [alex]: 400 } }),
    ]);
    expect(rows.map((row) => row.memberId)).toEqual([alex, priya, sam]);
  });
});

const rentId = 'e00000000000000000000001';
const wifiId = 'e00000000000000000000002';

function template(overrides: Partial<InsightRecurringTemplate> = {}): InsightRecurringTemplate {
  return {
    id: rentId,
    description: 'Rent',
    currency: 'INR',
    amount: 540,
    amountMinor: 54000,
    moneyVersion: 1,
    dayOfMonth: 5,
    startsOn: '2026-03-05T00:00:00.000Z',
    endsOn: null,
    isPaused: false,
    paidBy: [{ user: priya, amount: 540, amountMinor: 54000 }],
    ...overrides,
  };
}

function recurring(
  templates: InsightRecurringTemplate[],
  expenses: GroupMonthDetailExpense[] = [],
  options: Partial<Parameters<typeof groupRecurringMonth>[0]> = {},
) {
  return groupRecurringMonth({
    timeZone: 'Asia/Kolkata',
    month: '2026-09',
    currency: 'INR',
    now: '2026-09-15T06:00:00.000Z',
    templates,
    expenses,
    ...options,
  });
}

describe('the recurring Expenses of a Month', () => {
  it('gives each template’s amount, payers, the day it added this Month, and its next day', () => {
    const result = recurring(
      [
        template({ lastGeneratedFor: '2026-09' }),
        template({
          id: wifiId,
          description: 'Wi-Fi',
          amount: 9.99,
          amountMinor: 999,
          dayOfMonth: 28,
          lastGeneratedFor: '2026-09',
          paidBy: [
            { user: sam, amount: 3.33, amountMinor: 333 },
            { user: alex, amount: 6.66, amountMinor: 666 },
          ],
        }),
      ],
      [
        expense('2026-09-05T00:00:00.000Z', { [priya]: 54000 }, { recurringExpenseId: rentId }),
        // Added on 1 September, dated the 28th: its next is October's.
        expense('2026-09-28T00:00:00.000Z', { [sam]: 999 }, { recurringExpenseId: wifiId }),
        expense('2026-08-05T00:00:00.000Z', { [priya]: 54000 }, { recurringExpenseId: rentId }),
        // Not recurring.
        expense('2026-09-09T06:00:00.000Z', { [priya]: 1234 }),
      ],
    );
    expect(result).toEqual({
      addedInMonth: { count: 2, spentMinor: 54999 },
      templates: [
        {
          id: rentId,
          description: 'Rent',
          amountMinor: 54000,
          dayOfMonth: 5,
          paused: false,
          nextDate: '2026-10-05',
          addedOn: '2026-09-05',
          paidBy: [priya],
        },
        {
          id: wifiId,
          description: 'Wi-Fi',
          amountMinor: 999,
          dayOfMonth: 28,
          paused: false,
          nextDate: '2026-10-28',
          addedOn: '2026-09-28',
          paidBy: [alex, sam],
        },
      ],
    });
  });

  it('gives the day of an Expense not yet added as the next', () => {
    // Nothing added for September yet: its 28th is still to come.
    const wifi = template({ id: wifiId, dayOfMonth: 28, lastGeneratedFor: '2026-08' });
    expect(recurring([wifi]).templates[0]).toMatchObject({ nextDate: '2026-09-28', addedOn: null });
  });

  it('finds today in the viewer’s zone', () => {
    // 20:00 UTC on 5 October: the 6th in Kolkata, still the 5th in New York.
    const now = '2026-10-05T20:00:00.000Z';
    const next = (timeZone: string) =>
      recurring([template()], [], { now, timeZone, month: '2026-10' }).templates[0].nextDate;
    expect(next('Asia/Kolkata')).toBe('2026-11-05');
    expect(next('America/New_York')).toBe('2026-10-05');
  });

  it('lists paused and ended templates last, with no next day', () => {
    const result = recurring([
      template({ id: 'e00000000000000000000003', description: 'Cleaner', isPaused: true }),
      template({ id: 'e00000000000000000000004', description: 'Old lease', endsOn: '2026-08-31' }),
      template(),
    ]);
    expect(result.templates.map((row) => [row.description, row.paused, row.nextDate])).toEqual([
      ['Rent', false, '2026-10-05'],
      ['Cleaner', true, null],
      ['Old lease', false, null],
    ]);
  });

  it('counts only Expenses in the Month and the Group’s currency, and lists only its templates', () => {
    const result = recurring(
      [template(), template({ id: wifiId, currency: 'EUR' })],
      [
        expense('2026-09-05T00:00:00.000Z', { [priya]: 54000 }, { recurringExpenseId: rentId }),
        expense(
          '2026-09-06T00:00:00.000Z',
          { [priya]: 999 },
          { recurringExpenseId: wifiId, currency: 'EUR' },
        ),
      ],
    );
    expect(result.addedInMonth).toEqual({ count: 1, spentMinor: 54000 });
    expect(result.templates.map((row) => row.id)).toEqual([rentId]);
  });

  it('says a template added nothing this Month when it didn’t', () => {
    const result = recurring(
      [template({ startsOn: '2026-10-01T00:00:00.000Z' })],
      [expense('2026-08-05T00:00:00.000Z', { [priya]: 54000 }, { recurringExpenseId: rentId })],
    );
    expect(result.addedInMonth).toEqual({ count: 0, spentMinor: 0 });
    expect(result.templates[0]).toMatchObject({ addedOn: null, nextDate: '2026-10-05' });
  });

  it('leaves out a template whose stored amount can’t be read exactly', () => {
    const broken = template({
      id: wifiId,
      amount: 10.001,
      amountMinor: undefined,
      moneyVersion: undefined,
    });
    expect(recurring([broken, template()]).templates.map((row) => row.id)).toEqual([rentId]);
  });

  it('is empty without templates', () => {
    expect(recurring([])).toEqual({ addedInMonth: { count: 0, spentMinor: 0 }, templates: [] });
  });
});
