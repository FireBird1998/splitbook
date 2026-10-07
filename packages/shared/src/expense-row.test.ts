import { describe, expect, it } from 'vitest';
import type { ExpenseRead } from './expense-page-read';
import { expensePayerSummary, expenseSplitSummary, listedExpensePosition } from './expense-row';

// Fictional members and figures only.
const you = { _id: 'a00000000000000000000001', name: 'Alex Rivera', image: null };
const sam = { _id: 'a00000000000000000000002', name: 'Sam Chen', image: null };
const priya = { _id: 'a00000000000000000000003', name: 'Priya Shah', image: null };
const iso = '2026-09-27T10:00:00.000Z';

type Row = [person: ExpenseRead['paidBy'][number]['user'], amountMinor: number];

/** A stored Expense in exact minor units, as the page read returns it. */
function stored(paidBy: Row[], splitBetween: Row[], extra: Partial<ExpenseRead> = {}): ExpenseRead {
  const rows = (list: Row[]) =>
    list.map(([user, amountMinor]) => ({ user, amount: amountMinor / 100, amountMinor }));
  const total = paidBy.reduce((sum, [, amountMinor]) => sum + amountMinor, 0);
  return {
    _id: 'c00000000000000000000001',
    group: 'b00000000000000000000001',
    description: 'Electricity bill',
    currency: 'INR',
    amount: total / 100,
    amountMinor: total,
    moneyVersion: 1,
    date: iso,
    createdAt: iso,
    updatedAt: iso,
    category: 'housing',
    tag: 'Utilities',
    paidBy: rows(paidBy),
    splitBetween: rows(splitBetween),
    splitMethod: 'equal',
    ...extra,
  };
}

/** ₹2,860.00 paid by Sam, split equally: 953.34 + 953.33 + 953.33. */
const electricity = stored(
  [[sam, 286000]],
  [
    [sam, 95334],
    [you, 95333],
    [priya, 95333],
  ],
);

describe('a listed Expense’s position', () => {
  it('is what the member owes, exactly, from the stored shares', () => {
    expect(listedExpensePosition(electricity, you._id)).toEqual({
      kind: 'owe',
      amountMinor: 95333,
      amount: 953.33,
    });
  });

  it('is what the payer lent, exactly: everyone else’s share, never a rounded third', () => {
    expect(listedExpensePosition(electricity, sam._id)).toEqual({
      kind: 'lent',
      amountMinor: 190666,
      amount: 1906.66,
    });
  });

  it('adds up without floating-point error where decimal arithmetic would drift', () => {
    // 0.1 + 0.2 in floating point is 0.30000000000000004; minor units keep it 0.30.
    const tea = stored(
      [
        [you, 10],
        [sam, 20],
      ],
      [[priya, 30]],
    );
    expect(listedExpensePosition(tea, priya._id)).toEqual({
      kind: 'owe',
      amountMinor: 30,
      amount: 0.3,
    });
  });

  it('reads a legacy Expense without minor units, tolerating the old calculator’s binary tails', () => {
    const legacy = stored([[you, 100]], [[sam, 100]]);
    delete legacy.moneyVersion;
    delete legacy.amountMinor;
    legacy.amount = 1;
    legacy.paidBy = [{ user: you, amount: 1 }];
    legacy.splitBetween = [
      { user: sam, amount: 0.30000000000000004 },
      { user: priya, amount: 0.7 },
    ];
    expect(listedExpensePosition(legacy, you._id)).toEqual({
      kind: 'lent',
      amountMinor: 100,
      amount: 1,
    });
    expect(listedExpensePosition(legacy, sam._id)).toEqual({
      kind: 'owe',
      amountMinor: 30,
      amount: 0.3,
    });
  });

  it('is null when the member paid exactly their share, or isn’t part of it', () => {
    const even = stored(
      [
        [you, 5000],
        [sam, 5000],
      ],
      [
        [you, 5000],
        [sam, 5000],
      ],
    );
    expect(listedExpensePosition(even, you._id)).toBeNull();
    expect(listedExpensePosition(even, priya._id)).toBeNull();
  });

  it('counts a former member’s row for no one', () => {
    const left = stored(
      [[null, 3000]],
      [
        [null, 1500],
        [you, 1500],
      ],
    );
    expect(listedExpensePosition(left, you._id)).toMatchObject({ kind: 'owe', amount: 15 });
  });

  it('is null, never a guess, when the stored money can’t be read exactly', () => {
    const broken = stored([[you, 100]], [[sam, 100]]);
    broken.paidBy[0].amount = 2;
    expect(listedExpensePosition(broken, you._id)).toBeNull();
  });

  it('uses the Expense’s own currency', () => {
    const yen = stored(
      [[you, 3000]],
      [
        [you, 1000],
        [sam, 2000],
      ],
      { currency: 'JPY' },
    );
    yen.amount = 3000;
    yen.paidBy = [{ user: you, amount: 3000, amountMinor: 3000 }];
    yen.splitBetween = [
      { user: you, amount: 1000, amountMinor: 1000 },
      { user: sam, amount: 2000, amountMinor: 2000 },
    ];
    expect(listedExpensePosition(yen, you._id)).toEqual({
      kind: 'lent',
      amountMinor: 2000,
      amount: 2000,
    });
  });
});

describe('how a listed Expense is split', () => {
  it('names the method and how many people share it', () => {
    expect(expenseSplitSummary(electricity)).toBe('Equally · 3');
    expect(expenseSplitSummary({ ...electricity, splitMethod: 'shares' })).toBe('By shares · 3');
    expect(expenseSplitSummary({ ...electricity, splitMethod: 'percentage' })).toBe(
      'By percentage · 3',
    );
    expect(expenseSplitSummary({ ...electricity, splitMethod: 'exact' })).toBe('By amounts · 3');
    expect(expenseSplitSummary({ ...electricity, splitMethod: 'unequal' })).toBe('By amounts · 3');
  });

  it('leaves out someone named with a share of nothing', () => {
    const shares = stored(
      [[you, 3000]],
      [
        [you, 3000],
        [sam, 0],
      ],
      { splitMethod: 'shares' },
    );
    expect(expenseSplitSummary(shares)).toBe('By shares · 1');
  });
});

describe('who paid a listed Expense', () => {
  it('is "You" for the member, and others by name', () => {
    expect(expensePayerSummary(electricity, you._id)).toEqual({
      label: 'Sam Chen',
      personId: sam._id,
      name: 'Sam Chen',
    });
    expect(expensePayerSummary(electricity, sam._id)).toEqual({
      label: 'You',
      personId: sam._id,
      name: 'Sam Chen',
    });
  });

  it('counts several payers', () => {
    const villa = stored(
      [
        [you, 200000],
        [sam, 100000],
      ],
      [[priya, 300000]],
    );
    expect(expensePayerSummary(villa, you._id)).toEqual({
      label: '2 people',
      personId: null,
      name: null,
    });
  });

  it('names a payer whose account is gone as a former member', () => {
    const gone = stored([[null, 100]], [[you, 100]]);
    expect(expensePayerSummary(gone, you._id)).toEqual({
      label: 'Former member',
      personId: null,
      name: null,
    });
  });
});
