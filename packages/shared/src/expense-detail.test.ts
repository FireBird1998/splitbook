import { format } from 'date-fns';
import { describe, expect, it } from 'vitest';
import {
  expenseHistory,
  expenseLeftover,
  expenseShareRows,
  leftoverNote,
  listNames,
  nextRecurringDate,
  ordinal,
  repeatsLabel,
  type ExpenseLeftover,
  type StoredExpenseSplit,
} from './expense-detail';
import { expenseDateForPeriod } from './recurring-due-periods';
import type { ExpenseSplitMethod } from './split-calculation';

// Fictional members and figures only. Ids order the members: you, then Sam, then Priya.
const you = { _id: 'a00000000000000000000001', name: 'Alex Rivera' };
const sam = { _id: 'a00000000000000000000002', name: 'Sam Chen' };
const priya = { _id: 'a00000000000000000000003', name: 'Priya Shah' };
const NAMES: Record<string, string> = {
  [you._id]: 'you',
  [sam._id]: 'Sam Chen',
  [priya._id]: 'Priya Shah',
};
const name = (id: string) => NAMES[id];

type Row = [
  person: unknown,
  amountMinor: number,
  weight?: { percentage?: number; shares?: number },
];

/** A stored Expense in exact minor units, as the Expense reads return it. */
function stored(
  splitMethod: ExpenseSplitMethod,
  paidBy: Row[],
  splitBetween: Row[],
): StoredExpenseSplit {
  const rows = (list: Row[]) =>
    list.map(([user, amountMinor, weight]) => ({
      user,
      amount: amountMinor / 100,
      amountMinor,
      ...weight,
    }));
  const total = paidBy.reduce((sum, [, amountMinor]) => sum + amountMinor, 0);
  return {
    currency: 'INR',
    moneyVersion: 1,
    amount: total / 100,
    amountMinor: total,
    splitMethod,
    paidBy: rows(paidBy),
    splitBetween: rows(splitBetween),
  };
}

/** ₹1,000.00 paid by Sam, split equally as shared money splits it: you get the leftover paisa. */
const equal = stored(
  'equal',
  [[sam, 100000]],
  [
    [sam, 33333],
    [you, 33334],
    [priya, 33333],
  ],
);

describe('who paid and who owes what', () => {
  it('lists the payer first, then everyone else in split order, with exact Paid and Share', () => {
    expect(expenseShareRows(equal)).toEqual([
      { userId: sam._id, user: sam, paidMinor: 100000, shareMinor: 33333 },
      { userId: you._id, user: you, paidMinor: 0, shareMinor: 33334 },
      { userId: priya._id, user: priya, paidMinor: 0, shareMinor: 33333 },
    ]);
  });

  it('keeps each payer, someone who paid without a share, and leaves out a share of nothing', () => {
    const expense = stored(
      'shares',
      [
        [priya, 30000],
        [you, 10000],
      ],
      [
        [sam, 26667, { shares: 2 }],
        [you, 13333, { shares: 1 }],
        [priya, 0, { shares: 0 }],
      ],
    );
    expect(
      expenseShareRows(expense)!.map((row) => [name(row.userId!), row.paidMinor, row.shareMinor]),
    ).toEqual([
      ['Priya Shah', 30000, 0],
      ['you', 10000, 13333],
      ['Sam Chen', 0, 26667],
    ]);
  });

  it('reads legacy rows from their amounts, and keeps a former member as nobody in particular', () => {
    const legacy: StoredExpenseSplit = {
      currency: 'INR',
      amount: 90,
      splitMethod: 'equal',
      paidBy: [{ user: null, amount: 90 }],
      splitBetween: [
        { user: sam._id, amount: 45 },
        { user: null, amount: 45 },
      ],
    };
    expect(expenseShareRows(legacy)).toEqual([
      { userId: null, user: null, paidMinor: 9000, shareMinor: 0 },
      { userId: sam._id, user: sam._id, paidMinor: 0, shareMinor: 4500 },
      { userId: null, user: null, paidMinor: 0, shareMinor: 4500 },
    ]);
  });

  it('shows nothing rather than a wrong figure when stored money can’t be read exactly', () => {
    expect(
      expenseShareRows({ ...equal, paidBy: [{ user: sam, amount: 999, amountMinor: 100000 }] }),
    ).toBeNull();
  });
});

describe('where a leftover went', () => {
  it('equal shares tie, so the fixed member order chose: the first member by id', () => {
    expect(expenseLeftover(equal)).toEqual({ amountMinor: 1, userIds: [you._id], reason: 'tie' });
    const twoLeft = stored(
      'equal',
      [[priya, 84500]],
      [
        [priya, 28166],
        [sam, 28167],
        [you, 28167],
      ],
    );
    expect(expenseLeftover(twoLeft)).toEqual({
      amountMinor: 2,
      userIds: [sam._id, you._id],
      reason: 'tie',
    });
  });

  it('by Shares, it went to the shares rounded down the most, with no tie to settle', () => {
    // ₹10.00 in 1 : 2 : 4 shares is 142.86, 285.71 and 571.43 paise before rounding down.
    const expense = stored(
      'shares',
      [[priya, 1000]],
      [
        [priya, 143, { shares: 1 }],
        [sam, 286, { shares: 2 }],
        [you, 571, { shares: 4 }],
      ],
    );
    expect(expenseLeftover(expense)).toEqual({
      amountMinor: 2,
      userIds: [priya._id, sam._id],
      reason: 'remainder',
    });
  });

  it('by Percentage, an even half each is a tie', () => {
    const expense = stored(
      'percentage',
      [[sam, 101]],
      [
        [sam, 50, { percentage: 50 }],
        [you, 51, { percentage: 50 }],
      ],
    );
    expect(expenseLeftover(expense)).toEqual({ amountMinor: 1, userIds: [you._id], reason: 'tie' });
  });

  it('an older allocation the rule wouldn’t give today is shown as stored, never recalculated', () => {
    const older = stored(
      'equal',
      [[sam, 100000]],
      [
        [sam, 33334],
        [you, 33333],
        [priya, 33333],
      ],
    );
    expect(expenseLeftover(older)).toEqual({
      amountMinor: 1,
      userIds: [sam._id],
      reason: 'stored',
    });
  });

  it('has none when the split divides exactly, is by amounts, or can’t be read', () => {
    const exact = stored(
      'equal',
      [[sam, 90000]],
      [
        [sam, 30000],
        [you, 30000],
        [priya, 30000],
      ],
    );
    expect(expenseLeftover(exact)).toBeNull();
    expect(expenseLeftover({ ...equal, splitMethod: 'unequal' })).toBeNull();
    expect(expenseLeftover({ ...equal, amountMinor: 99999 })).toBeNull();
  });
});

describe('the leftover in words', () => {
  const notes = (leftover: ExpenseLeftover) => leftoverNote(leftover, 'INR', name);

  it('says who got it and why, by the rule', () => {
    expect(notes({ amountMinor: 1, userIds: [you._id], reason: 'tie' })).toBe(
      'The leftover ₹0.01 went to you, so the total is exact. It goes to the shares rounded ' +
        'down the most, and a fixed member order settles a tie.',
    );
    expect(notes({ amountMinor: 2, userIds: [sam._id, priya._id], reason: 'remainder' })).toBe(
      'The leftover ₹0.02 went to Sam Chen and Priya Shah, whose shares were rounded down the ' +
        'most, so the total is exact.',
    );
    expect(notes({ amountMinor: 1, userIds: [sam._id], reason: 'remainder' })).toContain(
      'whose share was rounded down the most',
    );
    expect(notes({ amountMinor: 1, userIds: [sam._id], reason: 'stored' })).toBe(
      'The leftover ₹0.01 went to Sam Chen, so the total is exact.',
    );
  });

  it('never puts it down to who paid', () => {
    for (const reason of ['remainder', 'tie', 'stored'] as const)
      expect(notes({ amountMinor: 1, userIds: [sam._id], reason })).not.toMatch(/pa(id|yer)/i);
  });

  it('lists names as a sentence does', () => {
    expect(listNames([])).toBe('');
    expect(listNames(['you'])).toBe('you');
    expect(listNames(['you', 'Sam'])).toBe('you and Sam');
    expect(listNames(['you', 'Sam', 'Priya'])).toBe('you, Sam and Priya');
  });
});

describe('an Expense’s history', () => {
  const at = (day: number) => `2026-09-${String(day).padStart(2, '0')}T15:40:00.000Z`;
  const history = (...edits: Array<Record<string, { old?: unknown; new?: unknown }>>) =>
    expenseHistory({
      currency: 'INR',
      createdAt: at(1),
      createdBy: sam,
      editHistory: edits.map((changes, index) => ({
        editedBy: index % 2 ? you : priya,
        editedAt: at(index + 2),
        changes,
      })),
    });

  it('lists the edits newest first, then who added it', () => {
    const entries = history(
      { amount: { old: 2680, new: 2860 }, amountMinor: { old: 268000, new: 286000 } },
      { notes: { old: '', new: 'August–September meter cycle' } },
    );
    expect(entries).toEqual([
      { by: you, at: at(3), action: 'changed the notes', change: null },
      {
        by: priya,
        at: at(2),
        action: 'changed the amount',
        change: { kind: 'amount', before: '₹2,680.00', after: '₹2,860.00' },
      },
      { by: sam, at: at(1), action: 'added this Expense', change: null },
    ]);
  });

  it('names a new description, and lists every field an edit changed', () => {
    const [entry] = history({
      description: { old: 'Groceries', new: 'Weekly groceries' },
      notes: { old: '', new: 'Same shop' },
      tagId: { old: 'd1', new: 'd2' },
      tag: { old: 'General', new: 'Groceries' },
      date: { old: at(1), new: at(2) },
    });
    expect(entry.action).toBe('changed the description, date, Tag and notes');
    expect(entry.change).toEqual({
      kind: 'description',
      before: '“Groceries”',
      after: '“Weekly groceries”',
    });
  });

  it('counts a new amount’s rewritten rows as the payer or split only when they really changed', () => {
    const rows = (user: string, amount: number) => [{ user, amount, amountMinor: amount * 100 }];
    const amountOnly = {
      amount: { old: 90, new: 120 },
      paidBy: { old: rows(sam._id, 90), new: rows(sam._id, 120) },
      splitBetween: { old: rows(sam._id, 90), new: rows(sam._id, 120) },
    };
    expect(history(amountOnly)[0].action).toBe('changed the amount');
    const newPayer = { ...amountOnly, paidBy: { old: rows(sam._id, 90), new: rows(you._id, 120) } };
    expect(history(newPayer)[0].action).toBe('changed the amount and who paid');
    const shares = (count: number) => [{ user: sam._id, amount: 90, shares: count }];
    expect(history({ splitBetween: { old: shares(1), new: shares(2) } })[0].action).toBe(
      'changed the split',
    );
    expect(history({ splitMethod: { old: 'equal', new: 'shares' } })[0].action).toBe(
      'changed the split',
    );
    expect(history({ predefinedItem: { old: null, new: 'taxi' } })[0].action).toBe(
      'edited this Expense',
    );
  });

  it('is only who added it when nothing was edited', () => {
    expect(expenseHistory({ currency: 'INR', createdAt: at(1) })).toEqual([
      { by: null, at: at(1), action: 'added this Expense', change: null },
    ]);
  });
});

describe('how a recurring Expense repeats', () => {
  // The recurring rules work in UTC Months; the next day is shown in the viewer's own zone,
  // as the Expense table shows the Expense it adds, so the expected label uses that formatter.
  const day = (period: string, dayOfMonth: number) =>
    format(expenseDateForPeriod(period, dayOfMonth), 'd MMM');
  const now = new Date(Date.UTC(2026, 8, 30, 12));
  const wifi = {
    dayOfMonth: 28,
    startsOn: '2026-01-01T00:00:00.000Z',
    endsOn: null,
    isPaused: false,
    lastGeneratedFor: '2026-09',
  };

  it('says the day of the month and the next date it adds an Expense', () => {
    expect(repeatsLabel(wifi, { now })).toBe(`Monthly on the 28th · next ${day('2026-10', 28)}`);
    expect(nextRecurringDate(wifi, now)?.toISOString()).toBe('2026-10-28T00:00:00.000Z');
  });

  it('keeps to a short month’s last day, and starts no earlier than the first date', () => {
    const late = { ...wifi, dayOfMonth: 31, lastGeneratedFor: '2026-10' };
    expect(nextRecurringDate(late, now)?.toISOString()).toBe('2026-11-30T00:00:00.000Z');
    const later = { ...wifi, startsOn: '2027-02-15T00:00:00.000Z', lastGeneratedFor: null };
    expect(nextRecurringDate(later, now)?.toISOString()).toBe('2027-02-28T00:00:00.000Z');
    const firstDay = { ...later, dayOfMonth: 10 };
    expect(nextRecurringDate(firstDay, now)?.toISOString()).toBe('2027-03-10T00:00:00.000Z');
  });

  it('says when it is paused or has ended', () => {
    expect(repeatsLabel({ ...wifi, isPaused: true }, { now })).toBe('Monthly on the 28th · paused');
    const ended = { ...wifi, endsOn: '2026-10-15T00:00:00.000Z' };
    expect(repeatsLabel(ended, { now })).toBe('Monthly on the 28th · ended');
  });

  it('says only Monthly while the schedule is unknown, and Stopped once it was deleted', () => {
    expect(repeatsLabel(null)).toBe('Monthly');
    expect(repeatsLabel(undefined, { deleted: true })).toBe('Stopped');
  });

  it('writes the day as an ordinal', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 28, 31].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '28th',
      '31st',
    ]);
  });
});
