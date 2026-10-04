import { describe, expect, it } from 'vitest';
import { normalizeExpenseMoney, parseDecimalUnits, toMajorAmount } from './exact-money';
import { decideExpenseMoneyEdit, type StoredExpenseMoney } from './expense-money-edit';
import {
  splitBreakdown,
  splitChoiceOf,
  splitEntryProblem,
  splitLeftover,
  splitMethodFor,
  type SplitEntries,
} from './expense-split';

const [you, sam, priya] = [
  'a00000000000000000000001',
  'a00000000000000000000002',
  'a00000000000000000000003',
];
const entries = (patch: Partial<SplitEntries> = {}): SplitEntries => ({
  amount: '1249.50',
  currency: 'INR',
  multiPayer: false,
  splitMethod: 'equal',
  splitValues: {},
  participantIds: [you, sam, priya],
  ...patch,
});
/** The money command an app sends: `you` paid, unless other payers are given. */
const moneyInput = (value: SplitEntries, paidBy = [{ user: you, amount: value.amount }]) => ({
  amount: value.amount,
  currency: value.currency,
  paidBy,
  splitMethod: value.splitMethod,
  splitBetween: value.participantIds.map((user) => {
    const entry = value.splitValues[user] || '0';
    return {
      user,
      ...(value.splitMethod === 'unequal' || value.splitMethod === 'exact'
        ? { amount: entry }
        : value.splitMethod === 'percentage'
          ? { percentage: parseDecimalUnits(entry, 2) / 100 }
          : value.splitMethod === 'shares'
            ? { shares: parseDecimalUnits(entry, 0) }
            : {}),
    };
  }),
});
const allocation = (value: SplitEntries) => normalizeExpenseMoney(moneyInput(value));
const breakdown = (value: SplitEntries) => splitBreakdown(value, () => allocation(value));
const leftover = (value: SplitEntries) => splitLeftover(value.splitMethod, allocation(value));
const saved: StoredExpenseMoney = {
  amount: 10,
  currency: 'INR',
  amountMinor: 1000,
  moneyVersion: 1,
  splitMethod: 'exact',
  paidBy: [{ user: you, amount: 10, amountMinor: 1000 }],
  splitBetween: [
    { user: you, amount: 6, amountMinor: 600 },
    { user: sam, amount: 4, amountMinor: 400 },
  ],
};

describe('split method mapping', () => {
  it('shows unequal and exact as Amounts', () => {
    expect(splitChoiceOf('unequal')).toBe('amounts');
    expect(splitChoiceOf('exact')).toBe('amounts');
    expect(splitChoiceOf('equal')).toBe('equal');
    expect(splitChoiceOf('percentage')).toBe('percentage');
    expect(splitChoiceOf('shares')).toBe('shares');
  });

  it('sends Amounts on a new Expense as unequal', () => {
    expect(splitMethodFor('amounts', 'equal')).toBe('unequal');
    expect(splitMethodFor('amounts', 'shares')).toBe('unequal');
    expect(splitMethodFor('percentage', 'equal')).toBe('percentage');
  });

  it('keeps an exact Expense exact unless another method is chosen', () => {
    expect(splitMethodFor('amounts', 'exact', 'exact')).toBe('exact');
    expect(splitMethodFor('equal', 'exact', 'exact')).toBe('equal');
    expect(splitMethodFor('amounts', 'equal', 'exact')).toBe('exact');
    expect(splitMethodFor('amounts', 'equal', 'shares')).toBe('unequal');
  });

  it('changes nothing when the current method is chosen again', () => {
    expect(splitMethodFor('amounts', 'exact')).toBe('exact');
    expect(splitMethodFor('amounts', 'unequal', 'exact')).toBe('unequal');
    expect(splitMethodFor('equal', 'equal')).toBe('equal');
  });
});

describe('rounding leftover', () => {
  it('names who got the leftover from Shares', () => {
    const shares = entries({
      splitMethod: 'shares',
      splitValues: { [you]: '2', [sam]: '1', [priya]: '1' },
    });
    expect(allocation(shares).splitBetween.map((row) => row.amountMinor)).toEqual([
      62475, 31238, 31237,
    ]);
    expect(leftover(shares)).toEqual({ amountMinor: 1, users: [sam] });
  });

  it('names everyone who got part of the leftover, including you', () => {
    expect(leftover(entries({ amount: '100' }))).toEqual({ amountMinor: 1, users: [you] });
    expect(leftover(entries({ amount: '0.02' }))).toEqual({ amountMinor: 2, users: [you, sam] });
  });

  it('follows the largest remainder for Percentage', () => {
    const percentage = entries({
      amount: '10',
      splitMethod: 'percentage',
      splitValues: { [you]: '33.33', [sam]: '33.33', [priya]: '33.34' },
    });
    expect(leftover(percentage)).toEqual({ amountMinor: 1, users: [priya] });
  });

  it('says nothing when the total divides exactly or is entered by Amounts', () => {
    expect(leftover(entries({ amount: '1249.50', participantIds: [you, sam] }))).toBeNull();
    expect(
      leftover(
        entries({
          amount: '1000',
          splitMethod: 'shares',
          splitValues: { [you]: '2', [sam]: '1', [priya]: '1' },
        }),
      ),
    ).toBeNull();
    expect(
      leftover(
        entries({
          amount: '10',
          splitMethod: 'unequal',
          splitValues: { [you]: '3.33', [sam]: '3.33', [priya]: '3.34' },
        }),
      ),
    ).toBeNull();
  });

  it('explains nothing when historical weights cannot be read', () => {
    expect(
      splitLeftover('percentage', {
        amountMinor: 1000,
        splitBetween: [{ user: you, amountMinor: 1000, percentage: 33.333 }],
      }),
    ).toBeNull();
  });
});

describe('split entry problems', () => {
  it('tells each kind of entry problem apart, without rounding', () => {
    expect(splitEntryProblem('shares', '1.5', 'INR')).toBe('not-whole');
    expect(splitEntryProblem('shares', '1,5', 'INR')).toBe('not-whole');
    expect(splitEntryProblem('shares', '-1', 'INR')).toBe('negative');
    expect(splitEntryProblem('percentage', '33.333', 'INR')).toBe('too-precise');
    expect(splitEntryProblem('percentage', '120', 'INR')).toBe('too-large');
    expect(splitEntryProblem('percentage', '99999999999999999999', 'INR')).toBe('too-large');
    expect(splitEntryProblem('percentage', '1,5', 'INR')).toBe('invalid');
    expect(splitEntryProblem('percentage', '-5', 'INR')).toBe('negative');
    expect(splitEntryProblem('amounts', '1000.005', 'INR')).toBe('too-precise');
    expect(splitEntryProblem('amounts', '1.5', 'JPY')).toBe('too-precise');
    expect(splitEntryProblem('amounts', '99999999999999999999', 'INR')).toBe('too-large');
    expect(splitEntryProblem('amounts', '1.2.3', 'INR')).toBe('invalid');
    expect(splitEntryProblem('amounts', '-5', 'INR')).toBe('negative');
  });

  it('refuses an Amounts entry above the largest Expense amount, in each currency’s precision', () => {
    // #187: a safe integer that exact money can't display once the entries are summed.
    expect(splitEntryProblem('amounts', '88888888888888.01', 'INR')).toBe('too-large');
    expect(splitEntryProblem('amounts', '10000000.01', 'INR')).toBe('too-large');
    expect(splitEntryProblem('amounts', '10000000.00', 'INR')).toBeUndefined();
    expect(splitEntryProblem('amounts', '10000001', 'JPY')).toBe('too-large');
    expect(splitEntryProblem('amounts', '10000000', 'JPY')).toBeUndefined();
  });

  it('accepts 0, 100% and blank entries, and never checks Equal', () => {
    expect(splitEntryProblem('amounts', '0', 'INR')).toBeUndefined();
    expect(splitEntryProblem('percentage', '100', 'INR')).toBeUndefined();
    expect(splitEntryProblem('shares', '', 'INR')).toBeUndefined();
    expect(splitEntryProblem('amounts', ' 5 ', 'INR')).toBeUndefined();
    expect(splitEntryProblem('equal', 'abc', 'INR')).toBeUndefined();
  });

  it('checks an entry of only spaces like any other text, as saving would', () => {
    // Saving reads it as typed and refuses it, so it isn't blank.
    expect(splitEntryProblem('amounts', ' ', 'INR')).toBe('invalid');
    expect(splitEntryProblem('percentage', '  ', 'INR')).toBe('invalid');
    expect(splitEntryProblem('shares', '\t', 'INR')).toBe('not-whole');
  });
});

describe('split preview', () => {
  it('shows each share and the leftover once the split adds up', () => {
    expect(
      breakdown(
        entries({ splitMethod: 'shares', splitValues: { [you]: '2', [sam]: '1', [priya]: '1' } }),
      ),
    ).toEqual({
      total: 124950,
      shares: { [you]: 62475, [sam]: 31238, [priya]: 31237 },
      problems: {},
      status: { kind: 'adds-up', leftover: { amountMinor: 1, users: [sam] } },
    });
  });

  it('reports how much of the total is still to assign by Amounts', () => {
    const preview = breakdown(
      entries({ splitMethod: 'unequal', splitValues: { [you]: '1000', [sam]: '200' } }),
    );
    expect(preview.shares).toEqual({ [you]: 100000, [sam]: 20000, [priya]: 0 });
    expect(preview.status).toEqual({
      kind: 'remaining',
      unit: 'amount',
      entered: 120000,
      target: 124950,
    });
    expect(
      breakdown(entries({ splitMethod: 'unequal', splitValues: { [you]: '1300' } })).status,
    ).toMatchObject({ kind: 'remaining', entered: 130000, target: 124950 });
  });

  it('reports the percentage still to assign without rounding entries', () => {
    const preview = breakdown(
      entries({ splitMethod: 'percentage', splitValues: { [you]: '50', [sam]: '33.33' } }),
    );
    expect(preview.status).toEqual({
      kind: 'remaining',
      unit: 'percent',
      entered: 8333,
      target: 10000,
    });
    expect(preview.shares).toEqual({ [you]: 62475, [sam]: 41645, [priya]: 0 });
  });

  it('marks an entry that needs correcting instead of using it', () => {
    const preview = breakdown(
      entries({ splitMethod: 'unequal', splitValues: { [you]: '1000.005', [sam]: '-5' } }),
    );
    expect(preview.problems).toEqual({ [you]: 'too-precise', [sam]: 'negative' });
    expect(preview.shares).toEqual({ [priya]: 0 });
    expect(preview.status).toEqual({ kind: 'problem', reason: 'marked-entries' });
    const percentage = breakdown(
      entries({ splitMethod: 'percentage', splitValues: { [you]: '120' } }),
    );
    expect(percentage.problems).toEqual({ [you]: 'too-large' });
    expect(percentage.status).toEqual({ kind: 'problem', reason: 'marked-entry' });
  });

  it('never gives a share above the largest Expense amount, so every sum stays displayable', () => {
    const huge = breakdown(
      entries({ splitMethod: 'unequal', splitValues: { [you]: '88888888888888.01', [sam]: '5' } }),
    );
    expect(huge.problems).toEqual({ [you]: 'too-large' });
    expect(huge.shares).toEqual({ [sam]: 500, [priya]: 0 });
    expect(huge.status).toEqual({ kind: 'problem', reason: 'marked-entry' });
    // Entries at the bound still add up to a sum exact money can show.
    const most = breakdown(
      entries({
        splitMethod: 'unequal',
        splitValues: { [you]: '10000000', [sam]: '10000000', [priya]: '10000000' },
      }),
    );
    expect(most.problems).toEqual({});
    expect(most.status).toEqual({
      kind: 'remaining',
      unit: 'amount',
      entered: 3_000_000_000,
      target: 124950,
    });
    expect(toMajorAmount(3_000_000_000, 'INR')).toBe(30_000_000);
  });

  it('marks an entry of only spaces to correct instead of reading it', () => {
    for (const [splitMethod, problem] of [
      ['unequal', 'invalid'],
      ['percentage', 'invalid'],
      ['shares', 'not-whole'],
    ] as const) {
      const preview = breakdown(entries({ splitMethod, splitValues: { [you]: ' ', [sam]: '1' } }));
      expect(preview.problems).toEqual({ [you]: problem });
      expect(preview.status).toEqual({ kind: 'problem', reason: 'marked-entry' });
    }
  });

  it('explains missing participants and an empty set of shares', () => {
    expect(breakdown(entries({ participantIds: [] })).status).toEqual({
      kind: 'problem',
      reason: 'no-participants',
    });
    expect(
      breakdown(entries({ splitMethod: 'shares', splitValues: { [you]: '0' } })).status,
    ).toEqual({ kind: 'problem', reason: 'no-shares' });
  });

  it('passes on what the money rules say when they refuse a split', () => {
    expect(breakdown(entries({ participantIds: [you, you] })).status).toEqual({
      kind: 'problem',
      reason: 'refused',
      message: 'Each person can appear only once',
    });
    expect(
      splitBreakdown(entries(), () => {
        throw 'not an Error';
      }).status,
    ).toEqual({ kind: 'problem', reason: 'unexplained' });
  });

  it('waits for a valid amount, still showing entered Amounts', () => {
    expect(
      breakdown(entries({ amount: '12.345', splitMethod: 'unequal', splitValues: { [you]: '5' } })),
    ).toMatchObject({ total: null, shares: { [you]: 500 }, status: { kind: 'no-amount' } });
  });

  it('keeps a payer problem out of the split', () => {
    const payers = entries({ multiPayer: true });
    const allocate = (multiPayer: boolean) =>
      normalizeExpenseMoney(
        moneyInput(payers, multiPayer ? [{ user: you, amount: '1000' }] : undefined),
      );
    expect(() => allocate(true)).toThrow('Payer amounts must add up to the expense amount');
    expect(splitBreakdown(payers, allocate)).toMatchObject({
      shares: { [you]: 41650, [sam]: 41650, [priya]: 41650 },
      status: { kind: 'adds-up', leftover: null },
    });
    // With one payer there is nothing to set aside, so the refusal stays with the split.
    const asked: boolean[] = [];
    const refuse = (multiPayer: boolean): never => {
      asked.push(multiPayer);
      throw new Error('Each person can appear only once');
    };
    expect(splitBreakdown(entries(), refuse).status).toEqual({
      kind: 'problem',
      reason: 'refused',
      message: 'Each person can appear only once',
    });
    expect(asked).toEqual([false]);
  });

  it('keeps an unchanged edit’s historical allocation', () => {
    const edit = entries({
      amount: '10',
      splitMethod: 'exact',
      splitValues: { [you]: '6', [sam]: '4' },
      participantIds: [you, sam],
    });
    const preview = splitBreakdown(
      edit,
      () => decideExpenseMoneyEdit(saved, moneyInput(edit)).money,
    );
    expect(preview.shares).toEqual({ [you]: 600, [sam]: 400 });
    expect(preview.status).toEqual({ kind: 'adds-up', leftover: null });
  });
});
