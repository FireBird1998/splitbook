import { describe, expect, it } from 'vitest';
import { normalizeExpenseMoney, parseDecimalUnits } from './exact-money';
import { splitChoiceOf, splitLeftover, splitMethodFor } from './expense-split';
import type { ExpenseEntry } from './expense-entry';
type SplitEntries = Pick<
  ExpenseEntry,
  'amount' | 'currency' | 'multiPayer' | 'splitMethod' | 'splitValues' | 'participantIds'
>;

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
const leftover = (value: SplitEntries) => splitLeftover(value.splitMethod, allocation(value));

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

describe('leftover and breakdown paths the suite missed (#471)', () => {
  it('reads a percentage left out as 0 when explaining the leftover', () => {
    // 1,000 paise at 50% and 50%, with a third person at no percentage: nothing is rounded.
    expect(
      splitLeftover('percentage', {
        amountMinor: 1000,
        splitBetween: [
          { user: you, amountMinor: 500, percentage: 50 },
          { user: sam, amountMinor: 500, percentage: 50 },
          { user: priya, amountMinor: 0 },
        ],
      }),
    ).toBeNull();
  });

  it('reads shares left out as 0, and gives the leftover paisa to the person who got it', () => {
    // 1,000 paise by shares 1:2 is 333.33… and 666.66…: 334 + 666, so you got the extra paisa.
    expect(
      splitLeftover('shares', {
        amountMinor: 1000,
        splitBetween: [
          { user: you, amountMinor: 334, shares: 1 },
          { user: sam, amountMinor: 666, shares: 2 },
          { user: priya, amountMinor: 0 },
        ],
      }),
    ).toEqual({ amountMinor: 1, users: [you] });
  });

  it('explains nothing when no one has a share', () => {
    expect(
      splitLeftover('shares', {
        amountMinor: 1000,
        splitBetween: [
          { user: you, amountMinor: 0, shares: 0 },
          { user: sam, amountMinor: 0 },
        ],
      }),
    ).toBeNull();
  });
});
