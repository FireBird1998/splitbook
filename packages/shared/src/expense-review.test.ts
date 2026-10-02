import { describe, expect, it } from 'vitest';
import {
  expenseDifferences,
  rebaseExpenseEntries,
  resolveExpenseReview,
  type ExpenseEntries,
  type ExpenseReviewEntries,
} from './expense-review';

// Fictional member ids only.
const alex = 'a00000000000000000000001';
const sam = 'a00000000000000000000002';
const priya = 'a00000000000000000000003';

/** The saved Expense an edit began from: ₹30.00 dinner Alex paid, split equally three ways. */
const start: ExpenseEntries = {
  amount: '30',
  currency: 'INR',
  description: 'Dinner',
  date: '2026-09-17',
  payerId: alex,
  multiPayer: false,
  payers: [{ user: alex, amount: '30' }],
  splitMethod: 'equal',
  splitValues: { [alex]: '10', [sam]: '10', [priya]: '10' },
  participantIds: [alex, sam, priya],
  tagId: 'tag-food',
  category: 'food',
  notes: '',
};
const entries = (changes: Partial<ExpenseReviewEntries> = {}): ExpenseReviewEntries => ({
  ...start,
  ...changes,
});

describe('comparing two versions of an Expense', () => {
  it('finds nothing between equal versions', () => {
    expect(expenseDifferences(start, entries())).toEqual([]);
  });

  it('lists the changed fields in screen order', () => {
    expect(
      expenseDifferences(
        start,
        entries({ notes: 'Tip included', amount: '45', description: 'Late dinner' }),
      ),
    ).toEqual(['amount', 'description', 'notes']);
  });

  it('compares money by its exact units, not by how it was typed', () => {
    expect(expenseDifferences(start, entries({ amount: '30.00' }))).toEqual([]);
    expect(expenseDifferences(start, entries({ amount: '30.01' }))).toEqual(['amount']);
    expect(expenseDifferences(start, entries({ currency: 'USD' }))).toEqual(['amount']);
  });

  it('with one payer, compares only who paid', () => {
    expect(expenseDifferences(start, entries({ payers: [] }))).toEqual([]);
    expect(expenseDifferences(start, entries({ payerId: sam }))).toEqual(['payers']);
  });

  it('with several payers, compares each payer’s amount in any order', () => {
    const shared = entries({
      multiPayer: true,
      payers: [
        { user: alex, amount: '20' },
        { user: sam, amount: '10' },
      ],
    });
    const reordered = {
      ...shared,
      payers: [
        { user: sam, amount: '10.00' },
        { user: alex, amount: '20' },
      ],
    };
    expect(expenseDifferences(shared, reordered)).toEqual([]);
    expect(
      expenseDifferences(shared, {
        ...shared,
        payers: [
          { user: alex, amount: '15' },
          { user: sam, amount: '15' },
        ],
      }),
    ).toEqual(['payers']);
  });

  it('compares the split by who shares it and, unless equal, each share', () => {
    // An equal split ignores leftover share values, and member order.
    expect(
      expenseDifferences(start, entries({ splitValues: {}, participantIds: [priya, sam, alex] })),
    ).toEqual([]);
    expect(expenseDifferences(start, entries({ participantIds: [alex, sam] }))).toEqual(['split']);
    const shares = entries({
      splitMethod: 'shares',
      splitValues: { [alex]: '2', [sam]: '1', [priya]: '1' },
    });
    expect(
      expenseDifferences(shares, { ...shares, splitValues: { ...shares.splitValues, [sam]: '2' } }),
    ).toEqual(['split']);
    // Unequal and exact are both amounts, compared in exact units.
    const unequal = entries({
      splitMethod: 'unequal',
      splitValues: { [alex]: '15', [sam]: '10', [priya]: '5' },
    });
    expect(
      expenseDifferences(unequal, {
        ...unequal,
        splitMethod: 'exact',
        splitValues: { [alex]: '15.00', [sam]: '10', [priya]: '5.0' },
      }),
    ).toEqual([]);
  });
});

describe('keeping the member’s version for review against the latest saved Expense', () => {
  // Someone else saved a new description, Category, notes and amount.
  const saved = entries({
    description: 'Their dinner',
    category: 'travel',
    notes: 'Their notes',
    amount: '36',
    payers: [{ user: alex, amount: '36' }],
    splitValues: { [alex]: '12', [sam]: '12', [priya]: '12' },
  });

  it('takes the saved values for every field the member didn’t change', () => {
    const rebased = rebaseExpenseEntries(entries({ date: '2026-09-18' }), start, saved);
    expect(rebased).toMatchObject({
      description: 'Their dinner',
      category: 'travel',
      notes: 'Their notes',
      date: '2026-09-18',
    });
  });

  it('keeps the member’s changes, even to fields the saved Expense changed too', () => {
    const rebased = rebaseExpenseEntries(
      entries({ notes: 'My notes', participantIds: [alex, sam] }),
      start,
      saved,
    );
    expect(rebased).toMatchObject({
      notes: 'My notes',
      description: 'Their dinner',
      participantIds: [alex, sam],
    });
  });

  it('never merges money: a saved money change waits for the member’s choice', () => {
    const rebased = rebaseExpenseEntries(entries({ notes: 'My notes' }), start, saved);
    // The member didn't touch the amount, yet the saved one isn't taken silently either.
    expect(rebased).toMatchObject({ amount: '30', review: ['amount'] });
  });

  it('asks nothing about money only the member changed', () => {
    const rebased = rebaseExpenseEntries(
      entries({ participantIds: [alex, sam] }),
      start,
      entries({ notes: 'Their notes' }),
    );
    expect(rebased.review).toBeUndefined();
    expect(rebased.participantIds).toEqual([alex, sam]);
  });

  it('asks nothing about money the member already changed to the saved value', () => {
    const rebased = rebaseExpenseEntries(entries({ amount: '36.00' }), start, saved);
    expect(rebased.review).toBeUndefined();
  });

  it('keeps an earlier open choice while it still differs from the saved value', () => {
    const first = rebaseExpenseEntries(entries({ notes: 'My notes' }), start, saved);
    const again = rebaseExpenseEntries(first, saved, entries({ ...saved, date: '2026-09-19' }));
    expect(again).toMatchObject({ amount: '30', date: '2026-09-19', review: ['amount'] });
    // Once the member's entry matches the saved value, there is nothing left to choose.
    const matched = rebaseExpenseEntries({ ...first, amount: '36' }, saved, saved);
    expect(matched.review).toBeUndefined();
  });

  it('carries the caller’s own fields through', () => {
    const draft = { ...entries({ notes: 'My notes' }), original: { id: 'saved-1' } };
    expect(rebaseExpenseEntries(draft, start, saved).original).toEqual({ id: 'saved-1' });
  });
});

describe('choosing a money field under review', () => {
  const saved = entries({ amount: '36', currency: 'INR' });
  const draft = entries({ review: ['amount', 'split'] });

  it('takes the saved entries for that field when the member chooses the saved one', () => {
    expect(resolveExpenseReview(draft, 'amount', 'saved', saved)).toEqual({
      amount: '36',
      currency: 'INR',
      review: ['split'],
    });
  });

  it('keeps the member’s entries when they choose their own', () => {
    expect(resolveExpenseReview(draft, 'amount', 'mine', saved)).toEqual({ review: ['split'] });
  });

  it('closes the review with the last choice', () => {
    expect(resolveExpenseReview(entries({ review: ['amount'] }), 'amount', 'mine', saved)).toEqual({
      review: undefined,
    });
  });

  it('changes no entries without a saved Expense to take them from', () => {
    expect(resolveExpenseReview(draft, 'amount', 'saved', null)).toEqual({ review: ['split'] });
  });
});
