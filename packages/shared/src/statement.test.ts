import { describe, expect, it } from 'vitest';
import { buildStatement } from './statement';
import { tripSummary, type TripExpense } from './trip-summary';
import type { BackupExpenseInput, BackupGroupInput } from './export-backup';
const group: BackupGroupInput = {
  id: 'g',
  name: 'Ferry Trip',
  theme: 'trip',
  currency: 'INR',
  tags: [],
  members: [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
  ],
  names: { a: 'Alice', b: 'Bob' },
  expenses: [
    {
      id: 'e',
      date: '2026-09-01',
      description: 'Lunch',
      category: 'food',
      tag: 'Meals',
      currency: 'INR',
      amountMinor: 101,
      splitMethod: 'equal',
      paidBy: [{ userId: 'a', amountMinor: 101 }],
      splitBetween: [
        { userId: 'a', amountMinor: 51 },
        { userId: 'b', amountMinor: 50 },
      ],
    },
  ],
  settlements: [
    {
      id: 'p',
      at: '2026-09-02T12:00:00Z',
      fromId: 'b',
      toId: 'a',
      currency: 'INR',
      amountMinor: 20,
      recordedById: 'b',
    },
  ],
};
describe('printable statement figures', () => {
  it('keeps Paid and Share equal to Spent, Nets zero, and suggestions identical to the ledger', () => {
    const bucket = buildStatement(group).currencies[0];
    expect(bucket.spentMinor).toBe(101);
    expect(bucket.expenseCount).toBe(1);
    expect(bucket.people).toEqual([
      { id: 'a', name: 'Alice', paidMinor: 101, shareMinor: 51, netMinor: 50, balanceMinor: 30 },
      { id: 'b', name: 'Bob', paidMinor: 0, shareMinor: 50, netMinor: -50, balanceMinor: -30 },
    ]);
    expect(bucket.suggestedPayments).toEqual([{ from: 'b', to: 'a', amountMinor: 30 }]);
    expect(bucket.people.reduce((total, row) => total + row.netMinor, 0)).toBe(0);
    expect(JSON.stringify(bucket)).not.toContain('You');
  });
  it('sorts Payments by instant, independently of server time zone', () => {
    const result = buildStatement({
      ...group,
      settlements: [
        group.settlements[0],
        { ...group.settlements[0], id: 'earlier', at: '2026-09-01T23:30:00Z' },
      ],
    });
    expect(result.currencies[0].payments.map((row) => row.id)).toEqual(['earlier', 'p']);
  });
  it('keeps legacy currencies separate and gives zero contributions for an empty period', () => {
    const legacy = {
      ...group,
      expenses: [...group.expenses, { ...group.expenses[0], id: 'euro', currency: 'EUR' }],
    };
    const result = buildStatement(legacy, { from: '2026-10-01', to: '2026-10-31' });
    expect(
      result.currencies.map((row) => [row.currency, row.spentMinor, row.expenseCount]),
    ).toEqual([
      ['EUR', 0, 0],
      ['INR', 0, 0],
    ]);
    expect(result.currencies[1].people.map((row) => row.balanceMinor)).toEqual([30, -30]);
    expect(buildStatement(legacy).currencies.map((row) => row.spentMinor)).toEqual([101, 101]);
  });
  it('includes before and after Trip Expenses only for whole-trip wrap-ups', () => {
    const trip = {
      ...group,
      expenses: [
        ...group.expenses,
        { ...group.expenses[0], id: 'before', date: '2026-08-31' },
        { ...group.expenses[0], id: 'after', date: '2026-09-03' },
      ],
    };
    const window = { from: '2026-09-01', to: '2026-09-02' };
    expect(buildStatement(trip, window).currencies[0].spentMinor).toBe(101);
    expect(buildStatement(trip, { ...window, wholeTrip: true }).currencies[0].spentMinor).toBe(303);
  });
});

describe('a whole trip, by #316’s rule for Expenses outside the Trip’s dates', () => {
  const expense = (id: string, date: string, amountMinor: number): BackupExpenseInput => ({
    ...group.expenses[0],
    id,
    description: id,
    date,
    amountMinor,
    paidBy: [{ userId: 'a', amountMinor }],
    splitBetween: [
      { userId: 'a', amountMinor: Math.ceil(amountMinor / 2) },
      { userId: 'b', amountMinor: Math.floor(amountMinor / 2) },
    ],
  });
  // 17 to 20 September: a booking weeks before, Expenses near midnight that change day with the
  // zone, and one after the Trip. Fictional figures.
  const ferry: BackupGroupInput = {
    ...group,
    startDate: '2026-09-17T00:00:00.000Z',
    endDate: '2026-09-20T00:00:00.000Z',
    settlements: [],
    expenses: [
      expense('booking', '2026-08-30T00:00:00.000Z', 60000),
      expense('eve', '2026-09-16T21:00:00.000Z', 303),
      expense('first', '2026-09-17T00:00:00.000Z', 1001),
      expense('late', '2026-09-20T22:30:00.000Z', 2002),
      expense('refund', '2026-09-23T00:00:00.000Z', 404),
    ],
  };
  const places = (statement: ReturnType<typeof buildStatement>) =>
    Object.fromEntries(statement.currencies[0].expenses.map((row) => [row.id, row.outsideTrip]));

  /** The same Expenses as the Trip summary reads them. */
  const tripExpense = (row: BackupExpenseInput): TripExpense => {
    const money = (rows: BackupExpenseInput['paidBy']) =>
      rows.map((entry) => ({
        user: entry.userId,
        amount: entry.amountMinor / 100,
        amountMinor: entry.amountMinor,
      }));
    return {
      id: row.id,
      description: row.description,
      currency: row.currency,
      date: row.date,
      moneyVersion: 1,
      amount: row.amountMinor / 100,
      amountMinor: row.amountMinor,
      paidBy: money(row.paidBy),
      splitBetween: money(row.splitBetween),
      tag: { id: null, name: row.tag },
    };
  };

  it('counts them in Spent, and names them Before the trip and After the trip', () => {
    const statement = buildStatement(ferry, { timeZone: 'UTC', wholeTrip: true });
    const bucket = statement.currencies[0];
    expect(bucket.spentMinor).toBe(63710);
    expect(bucket.expenseCount).toBe(5);
    expect(bucket.beforeTrip).toEqual({ spentMinor: 60303, expenseCount: 2 });
    expect(bucket.afterTrip).toEqual({ spentMinor: 404, expenseCount: 1 });
    expect(places(statement)).toEqual({
      booking: 'before',
      eve: 'before',
      first: null,
      late: null,
      refund: 'after',
    });
    // Paid and Share still each add up to Spent, outside days included.
    const total = (key: 'paidMinor' | 'shareMinor') =>
      bucket.people.reduce((sum, person) => sum + person[key], 0);
    expect([total('paidMinor'), total('shareMinor')]).toEqual([63710, 63710]);
  });

  it('reads the days in the viewer’s zone: late on the eve is the first day in Kolkata', () => {
    const statement = buildStatement(ferry, { timeZone: 'Asia/Kolkata', wholeTrip: true });
    expect(places(statement)).toEqual({
      booking: 'before',
      eve: null,
      first: null,
      late: 'after',
      refund: 'after',
    });
  });

  it('names the same Expenses, with the same totals, as the Trip summary in any zone', () => {
    const variants: Array<Pick<BackupGroupInput, 'startDate' | 'endDate'>> = [
      { startDate: ferry.startDate, endDate: ferry.endDate },
      { startDate: ferry.startDate, endDate: null },
      { startDate: null, endDate: ferry.endDate },
      // Stored the wrong way round: read as one span by both.
      { startDate: ferry.endDate, endDate: ferry.startDate },
    ];
    const zones = [
      'UTC',
      'Asia/Kolkata',
      'Pacific/Kiritimati',
      'Pacific/Pago_Pago',
      'Pacific/Tongatapu',
      'America/New_York',
    ];
    for (const dates of variants)
      for (const timeZone of zones) {
        const trip = { ...ferry, ...dates };
        const summary = tripSummary({
          memberId: 'a',
          timeZone,
          currency: 'INR',
          startDate: trip.startDate ?? null,
          endDate: trip.endDate ?? null,
          expenses: trip.expenses.map(tripExpense),
        });
        const bucket = buildStatement(trip, { timeZone, wholeTrip: true }).currencies[0];
        const outside = (part: typeof summary.beforeTrip) =>
          part && { spentMinor: part.spentMinor, expenseCount: part.expenseCount };
        const context = `${timeZone} ${JSON.stringify(dates)}`;
        expect(bucket.spentMinor, context).toBe(summary.spentMinor);
        expect(bucket.expenseCount, context).toBe(summary.expenseCount);
        expect(bucket.beforeTrip, context).toEqual(outside(summary.beforeTrip));
        expect(bucket.afterTrip, context).toEqual(outside(summary.afterTrip));
        const alice = bucket.people.find((person) => person.id === 'a')!;
        expect([alice.paidMinor, alice.shareMinor], context).toEqual([
          summary.youPaidMinor,
          summary.yourShareMinor,
        ]);
      }
  });

  it('names nothing outside a whole-trip statement', () => {
    const statement = buildStatement(ferry, {
      timeZone: 'UTC',
      from: '2026-08-01',
      to: '2026-09-30',
    });
    const bucket = statement.currencies[0];
    expect(bucket.expenseCount).toBe(5);
    expect([bucket.beforeTrip, bucket.afterTrip]).toEqual([null, null]);
    expect(Object.values(places(statement))).toEqual([null, null, null, null, null]);
  });
});
