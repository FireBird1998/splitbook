import { describe, expect, it } from 'vitest';
import {
  getDefaultExpenseTag,
  getStoredExpenseMoneyFields,
  getSelectableExpenseTags,
  isAdvancedSplit,
  resolveExpenseCategory,
  resolvePredefinedTag,
} from './expense-form-helpers';

const tags = [
  { _id: '1', name: 'General', isArchived: false },
  { _id: '2', name: 'Food', isArchived: false },
  { _id: '3', name: 'OldTag', isArchived: true },
];

describe('expense form helpers', () => {
  it('defaults to General when present', () => {
    expect(getDefaultExpenseTag(tags)).toBe('1');
  });

  it('falls back to the first active tag', () => {
    expect(
      getDefaultExpenseTag([
        { name: 'Food', isArchived: false },
        { name: 'Stay', isArchived: false },
      ]),
    ).toBe('Food');
  });

  it('keeps an archived current tag selectable for edit', () => {
    const options = getSelectableExpenseTags(tags, 'OldTag');
    expect(options.map((tag) => tag.name)).toEqual(['General', 'Food', 'OldTag']);
  });

  it('keeps an unknown current tag selectable when unchanged', () => {
    const options = getSelectableExpenseTags(tags, 'RenamedAway');
    expect(options.some((tag) => tag.name === 'RenamedAway')).toBe(true);
  });

  it('detects advanced split vs fast-path defaults', () => {
    expect(
      isAdvancedSplit({
        splitMethod: 'equal',
        selectedMemberCount: 3,
        memberCount: 3,
        multiPayerMode: false,
        primaryPayerId: 'u1',
        currentUserId: 'u1',
      }),
    ).toBe(false);

    expect(
      isAdvancedSplit({
        splitMethod: 'unequal',
        selectedMemberCount: 3,
        memberCount: 3,
        multiPayerMode: false,
        primaryPayerId: 'u1',
        currentUserId: 'u1',
      }),
    ).toBe(true);
  });

  it('resolves predefined item tags against active group tags', () => {
    expect(resolvePredefinedTag(tags, 'food')).toBe('2');
    expect(resolvePredefinedTag(tags, 'taxi')).toBeNull();
  });

  it('derives the category from a quick-pick id', () => {
    expect(resolveExpenseCategory('restaurant')).toBe('food');
    expect(resolveExpenseCategory('flight')).toBe('travel');
    expect(resolveExpenseCategory('rent')).toBe('housing');
  });

  it("falls back to 'other' when no quick-pick is selected", () => {
    expect(resolveExpenseCategory(null)).toBe('other');
  });

  it("falls back to 'other' for an unknown quick-pick id", () => {
    expect(resolveExpenseCategory('not-a-real-item')).toBe('other');
  });
});

describe('stored expense form money', () => {
  const legacy = {
    currency: 'INR',
    amount: 0.6000000000000001,
    paidBy: [
      { user: 'one', amount: 0.30000000000000004 },
      { user: 'two', amount: 0.3 },
    ],
    splitBetween: [
      { user: 'one', amount: 0.1 },
      { user: 'two', amount: 0.5000000000000001 },
    ],
  };

  it('prefills root, multiple payers and exact allocations from legacy minor values', () => {
    expect(getStoredExpenseMoneyFields(legacy)).toEqual({
      amount: '0.6',
      paidBy: ['0.3', '0.3'],
      splitBetween: ['0.1', '0.5'],
    });
  });

  it('prefills canonical whole-yen values, including a zero allocation', () => {
    expect(
      getStoredExpenseMoneyFields({
        currency: 'JPY',
        moneyVersion: 1,
        amountMinor: 1,
        paidBy: [{ user: 'one', amountMinor: 1 }],
        splitBetween: [
          { user: 'one', amountMinor: 0 },
          { user: 'two', amountMinor: 1 },
        ],
      }),
    ).toEqual({ amount: '1', paidBy: ['1'], splitBetween: ['0', '1'] });
  });

  it('refuses true sub-minor precision instead of rounding it for editing', () => {
    expect(() => getStoredExpenseMoneyFields({ ...legacy, amount: 0.601 })).toThrow(
      /decimal places/,
    );
  });

  it('refuses inconsistent canonical rows instead of substituting their major values', () => {
    expect(() =>
      getStoredExpenseMoneyFields({
        currency: 'INR',
        moneyVersion: 1,
        amount: 1,
        amountMinor: 100,
        paidBy: [{ user: 'one', amount: 1, amountMinor: 99 }],
        splitBetween: [{ user: 'two', amount: 1, amountMinor: 100 }],
      }),
    ).toThrow('Stored amounts disagree');
  });

  it('refuses unbalanced stored participants', () => {
    expect(() =>
      getStoredExpenseMoneyFields({
        ...legacy,
        paidBy: [{ user: 'one', amount: 0.5 }],
      }),
    ).toThrow('Stored allocations do not equal the Expense amount');
  });
});
