import { format } from 'date-fns';
import { describe, expect, it } from 'vitest';
import {
  expenseEditLineText,
  expenseEdits,
  expenseHistory,
  expenseLeftover,
  expenseShareRows,
  leftoverNote,
  listNames,
  memberMoneyLabel,
  nextRecurringDate,
  ordinal,
  repeatsLabel,
  type ExpenseLeftover,
  type StoredExpenseSplit,
} from './expense-detail';
import { moneyParticipantId } from './exact-money';
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
  const people = new Map([you, sam, priya].map((person) => [person._id, person.name]));
  /** Members by name, and the viewer (you) as "Your". */
  const names = {
    name: (person: unknown) => people.get(moneyParticipantId(person)) ?? 'Former member',
    viewer: you._id,
  };
  const history = (...edits: Array<Record<string, { old?: unknown; new?: unknown }>>) =>
    expenseHistory(
      {
        currency: 'INR',
        createdAt: at(1),
        createdBy: sam,
        editHistory: edits.map((changes, index) => ({
          editedBy: index % 2 ? you : priya,
          editedAt: at(index + 2),
          changes,
        })),
      },
      names,
    );
  /** Each line of the newest edit, as both clients read it. */
  const lines = (...edits: Array<Record<string, { old?: unknown; new?: unknown }>>) =>
    history(...edits)[0].lines.map(expenseEditLineText);

  const row = (user: unknown, minor: number) => ({ user, amount: minor / 100, amountMinor: minor });

  it('says an amount the payer and the split only followed in one line (#515)', () => {
    // The Tester’s edit: ₹900.00 shared equally by three, paid by Priya, became ₹1,200.00.
    const [edit] = history({
      amount: { old: 900, new: 1200 },
      amountMinor: { old: 90000, new: 120000 },
      paidBy: { old: [row(priya._id, 90000)], new: [row(priya._id, 120000)] },
      splitBetween: {
        old: [row(you._id, 30000), row(sam._id, 30000), row(priya._id, 30000)],
        new: [row(you._id, 40000), row(sam._id, 40000), row(priya._id, 40000)],
      },
    });
    expect(edit.action).toBe('edited this Expense');
    expect(edit.lines.map(expenseEditLineText)).toEqual(['Amount ₹900.00 → ₹1,200.00']);
    expect(edit.lines[0].money).toEqual({ before: true, after: true });
  });

  it('gives each changed fact its own line, never repeating the notes (#515)', () => {
    // The Tester’s other edit: the description, date, Tag and notes, in one save.
    expect(
      lines({
        description: { old: 'Groceries', new: 'Weekly groceries' },
        date: { old: '2026-10-16T00:00:00.000Z', new: '2026-10-17T00:00:00.000Z' },
        tagId: { old: 'c00000000000000000000001', new: 'c00000000000000000000002' },
        tag: { old: 'Food', new: 'Travel' },
        notes: { old: '', new: 'Same shop as last week' },
      }),
    ).toEqual([
      'Description “Groceries” → “Weekly groceries”',
      'Date 16 Oct → 17 Oct',
      'Tag Food → Travel',
      'Notes changed',
    ]);
  });

  it('lists the edits newest first, then who added it', () => {
    const entries = history(
      { amount: { old: 2680, new: 2860 }, amountMinor: { old: 268000, new: 286000 } },
      { notes: { old: '', new: 'August–September meter cycle' } },
    );
    expect(entries.map((entry) => [entry.by, entry.at, entry.action])).toEqual([
      [you, at(3), 'edited this Expense'],
      [priya, at(2), 'edited this Expense'],
      [sam, at(1), 'added this Expense'],
    ]);
    expect(entries.map((entry) => entry.lines.map(expenseEditLineText))).toEqual([
      ['Notes changed'],
      ['Amount ₹2,680.00 → ₹2,860.00'],
      [],
    ]);
  });

  it('lists each member whose payment or share the edit itself changed (#456)', () => {
    // Wi-Fi went from ₹999.00 paid by Priya and shared three ways to ₹1,200.00 paid by Sam and
    // shared by you and Sam; nobody's amount left the record unexplained.
    const [edit] = history({
      amount: { old: 999, new: 1200 },
      amountMinor: { old: 99900, new: 120000 },
      paidBy: { old: [row(priya._id, 99900)], new: [row(sam._id, 120000)] },
      splitBetween: {
        old: [row(you._id, 33300), row(sam._id, 33300), row(priya._id, 33300)],
        new: [row(you._id, 60000), row(sam._id, 60000)],
      },
    });
    expect(edit.lines.map(expenseEditLineText)).toEqual([
      'Amount ₹999.00 → ₹1,200.00',
      'Sam Chen’s payment ₹0.00 → ₹1,200.00',
      'Priya Shah’s payment ₹999.00 → ₹0.00',
      'Your share ₹333.00 → ₹600.00',
      'Sam Chen’s share ₹333.00 → ₹600.00',
      'Priya Shah’s share ₹333.00 → Not included',
    ]);
    // "Not included" is a word, so only the amounts are set in the money face.
    expect(edit.lines.at(-1)!.money).toEqual({ before: true, after: false });
  });

  it('counts money moved between the same people with a new amount as their own change', () => {
    expect(
      lines({
        amount: { old: 10, new: 12 },
        amountMinor: { old: 1000, new: 1200 },
        paidBy: {
          old: [row(sam._id, 500), row(priya._id, 500)],
          new: [row(sam._id, 200), row(priya._id, 1000)],
        },
        splitBetween: {
          old: [row(sam._id, 500), row(priya._id, 500)],
          new: [row(sam._id, 200), row(priya._id, 1000)],
        },
      }),
    ).toEqual([
      'Amount ₹10.00 → ₹12.00',
      'Sam Chen’s payment ₹5.00 → ₹2.00',
      'Priya Shah’s payment ₹5.00 → ₹10.00',
      'Sam Chen’s share ₹5.00 → ₹2.00',
      'Priya Shah’s share ₹5.00 → ₹10.00',
    ]);
  });

  it('names only the payers when only they changed', () => {
    expect(lines({ paidBy: { old: [row(sam._id, 9000)], new: [row(priya._id, 9000)] } })).toEqual([
      'Priya Shah’s payment ₹0.00 → ₹90.00',
      'Sam Chen’s payment ₹90.00 → ₹0.00',
    ]);
  });

  it('names a member’s payment or share, with the viewer as "Your" by id beside a namesake', () => {
    const namesake = { ...you, _id: 'a00000000000000000000009' };
    const nameOf = (person: unknown) =>
      (person as { name?: string } | null)?.name ?? 'Former member';
    const change = (person: unknown, part: 'payment' | 'share') => ({
      person,
      part,
      before: '₹0.00',
      after: '₹1.00',
    });
    expect(memberMoneyLabel(change(you, 'share'), nameOf, you._id)).toBe('Your share');
    expect(memberMoneyLabel(change(namesake, 'payment'), nameOf, you._id)).toBe(
      'Alex Rivera’s payment',
    );
    expect(memberMoneyLabel(change(null, 'share'), nameOf, you._id)).toBe('Former member’s share');
  });

  it('shows an edit made before a currency change in the currency it had then', () => {
    const entries = expenseHistory(
      {
        currency: 'INR',
        createdAt: at(1),
        editHistory: [
          {
            editedBy: sam,
            editedAt: at(2),
            changes: {
              amount: { old: 10, new: 12 },
              amountMinor: { old: 1000, new: 1200 },
              paidBy: { old: [row(sam._id, 1000)], new: [row(priya._id, 1200)] },
            },
          },
          { editedBy: priya, editedAt: at(3), changes: { currency: { old: 'USD', new: 'INR' } } },
        ],
      },
      names,
    );
    expect(entries[1].lines.map(expenseEditLineText)).toEqual([
      'Amount $10.00 → $12.00',
      'Priya Shah’s payment $0.00 → $12.00',
      'Sam Chen’s payment $10.00 → $0.00',
    ]);
  });

  it('says a new currency beside the amount, each amount in its own currency', () => {
    expect(
      lines({
        amount: { old: 10, new: 900 },
        amountMinor: { old: 1000, new: 90000 },
        currency: { old: 'USD', new: 'INR' },
      }),
    ).toEqual(['Amount $10.00 → ₹900.00', 'Currency USD → INR']);
  });

  it('says a new split method, and each share it moved', () => {
    expect(
      lines({
        splitMethod: { old: 'equal', new: 'shares' },
        splitBetween: {
          old: [row(you._id, 600), row(sam._id, 600)],
          new: [
            { ...row(you._id, 400), shares: 1 },
            { ...row(sam._id, 800), shares: 2 },
          ],
        },
      }),
    ).toEqual([
      'Split Equally → By shares',
      'Your share ₹6.00 → ₹4.00',
      'Sam Chen’s share ₹6.00 → ₹8.00',
    ]);
  });

  it('lists no shares for a new split method whose shares only followed a new amount', () => {
    const equal = (minor: number) => [row(you._id, minor), row(sam._id, minor)];
    const byShares = (minor: number) => equal(minor).map((share) => ({ ...share, shares: 1 }));
    expect(
      lines({
        amount: { old: 900, new: 1200 },
        amountMinor: { old: 90000, new: 120000 },
        splitMethod: { old: 'equal', new: 'shares' },
        splitBetween: { old: equal(45000), new: byShares(60000) },
      }),
    ).toEqual(['Amount ₹900.00 → ₹1,200.00', 'Split Equally → By shares']);
  });

  it('says the split changed when its shares changed but nobody’s amount did', () => {
    const shares = (count: number) => [
      { user: sam._id, amount: 90, amountMinor: 9000, shares: count },
    ];
    expect(lines({ splitBetween: { old: shares(1), new: shares(2) } })).toEqual(['Split changed']);
  });

  it('has no line for rows stored again in another order, which changed nothing', () => {
    const rows = [row(you._id, 600), row(sam._id, 600)];
    expect(
      lines({
        paidBy: { old: rows, new: [...rows].reverse() },
        splitBetween: { old: rows, new: [...rows].reverse() },
      }),
    ).toEqual([]);
  });

  it('names a Tag recorded only by its id from the Group’s Tags, or says it changed', () => {
    const tagId = { old: 'c00000000000000000000001', new: 'c00000000000000000000002' };
    const tags = new Map([
      [tagId.old, 'Food'],
      [tagId.new, 'Travel'],
    ]);
    const [edit] = expenseEdits(
      { currency: 'INR', editHistory: [{ editedBy: sam, editedAt: at(2), changes: { tagId } }] },
      { ...names, tagName: (id) => tags.get(String(id)) },
    );
    expect(edit.lines.map(expenseEditLineText)).toEqual(['Tag Food → Travel']);
    expect(lines({ tagId })).toEqual(['Tag changed']);
  });

  it('says what happened to the Category, the receipt, the item, and anything else', () => {
    expect(
      lines({
        moneyVersion: { old: undefined, new: 1 },
        category: { old: 'food', new: 'transport' },
        receiptUrl: { old: null, new: 'https://receipts.example/r1.jpg' },
        predefinedItem: { old: null, new: 'taxi' },
        location: { old: 'Pune', new: 'Goa' },
      }),
    ).toEqual([
      'Category Food & Drink → Transport',
      'Receipt added',
      'Item changed',
      'Other details changed',
    ]);
    const receipt = (old: string | null, now: string | null) =>
      lines({ receiptUrl: { old, new: now } });
    expect(receipt('https://receipts.example/r1.jpg', 'https://receipts.example/r2.jpg')).toEqual([
      'Receipt replaced',
    ]);
    expect(receipt('https://receipts.example/r1.jpg', null)).toEqual(['Receipt removed']);
  });

  it('shows the years only for a date moved to another year, and no line for the same day', () => {
    expect(
      lines({ date: { old: '2025-12-30T00:00:00.000Z', new: '2026-01-02T00:00:00.000Z' } }),
    ).toEqual(['Date 30 Dec 2025 → 2 Jan 2026']);
    // An older date stored at another time of the same day, stored again at its midnight.
    expect(
      lines({ date: { old: '2026-10-16T09:30:00.000Z', new: '2026-10-16T00:00:00.000Z' } }),
    ).toEqual([]);
  });

  it('keeps rows without a member id apart, as former members', () => {
    expect(
      lines({
        splitBetween: {
          old: [row({ name: 'Gone' }, 500), row({ name: 'Also gone' }, 500)],
          new: [row({ name: 'Gone' }, 400), row({ name: 'Also gone' }, 600)],
        },
      }),
    ).toEqual(['Former member’s share ₹5.00 → ₹4.00', 'Former member’s share ₹5.00 → ₹6.00']);
  });

  it('is only who added it when nothing was edited', () => {
    expect(expenseHistory({ currency: 'INR', createdAt: at(1) }, names)).toEqual([
      { by: null, at: at(1), action: 'added this Expense', lines: [] },
    ]);
  });
});

describe('how a recurring Expense repeats', () => {
  // The next day is the calendar day the Expense it adds is dated, in every zone (#437).
  const day = (period: string, dayOfMonth: number) =>
    format(new Date(Number(period.slice(0, 4)), Number(period.slice(5)) - 1, dayOfMonth), 'd MMM');
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
