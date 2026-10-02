import { describe, expect, it } from 'vitest';
import { calculateSplitAmountsMinor } from '@splitbook/shared/split-calculation';
import { expensePosition } from './expense-position';
import type { MobileExpense } from './types';

// Fictional people only.
const you = { id: 'a00000000000000000000001', name: 'Alex Rivera', image: null };
const sam = { id: 'a00000000000000000000002', name: 'Sam Chen', image: null };
const priya = { id: 'a00000000000000000000003', name: 'Priya Shah', image: null };
type Person = typeof you;

const rows = (allocations: [Person, number][]) =>
  allocations.map(([user, amountMinor]) => ({ user, amountMinor, amount: amountMinor / 100 }));
/** An equal split from the shared calculator, so its rounding is the ledger's own. */
const equally = (amountMinor: number, people: Person[]) =>
  calculateSplitAmountsMinor(
    'equal',
    amountMinor,
    people.map((user) => ({ user: user.id })),
  ).map(({ amountMinor: share }, index) => [people[index], share] as [Person, number]);
const expense = (
  paidBy: [Person, number][],
  splitBetween: [Person, number][],
  currency = 'INR',
): Pick<MobileExpense, 'currency' | 'paidBy' | 'splitBetween'> => ({
  currency,
  paidBy: rows(paidBy),
  splitBetween: rows(splitBetween),
});

describe('what a member lent or owes on one Expense', () => {
  it('a single payer lent everyone else’s share', () => {
    const groceries = expense([[you, 124950]], equally(124950, [you, sam, priya]));
    expect(expensePosition(groceries, you.id)).toEqual({
      kind: 'lent',
      amountMinor: 83300,
      amount: 833,
    });
    expect(expensePosition(groceries, sam.id)).toEqual({
      kind: 'owe',
      amountMinor: 41650,
      amount: 416.5,
    });
  });

  it('with several payers, each lent or owes what they paid minus their share', () => {
    const villa = expense(
      [
        [you, 200000],
        [sam, 100000],
      ],
      equally(300000, [you, sam, priya]),
    );
    expect(expensePosition(villa, you.id)).toMatchObject({ kind: 'lent', amount: 1000 });
    // Paid exactly their share: nothing either way.
    expect(expensePosition(villa, sam.id)).toBeNull();
    expect(expensePosition(villa, priya.id)).toMatchObject({ kind: 'owe', amount: 1000 });
  });

  it('is nothing for a member who neither paid nor shares it', () => {
    const lunch = expense([[sam, 50000]], equally(50000, [sam, priya]));
    expect(expensePosition(lunch, you.id)).toBeNull();
  });

  it('follows the split’s rounding exactly, whoever takes the leftover', () => {
    // ₹2,860.00 three ways: one share carries the leftover paisa.
    const shares = equally(286000, [you, sam, priya]);
    expect(shares.map(([, share]) => share)).toEqual([95334, 95333, 95333]);
    const bill = expense([[sam, 286000]], shares);
    expect(expensePosition(bill, you.id)).toEqual({
      kind: 'owe',
      amountMinor: 95334,
      amount: 953.34,
    });
    expect(expensePosition(bill, priya.id)).toEqual({
      kind: 'owe',
      amountMinor: 95333,
      amount: 953.33,
    });
    expect(expensePosition(bill, sam.id)).toEqual({
      kind: 'lent',
      amountMinor: 190667,
      amount: 1906.67,
    });
  });

  it('uses the Expense’s own currency precision', () => {
    const dinner = expense([[you, 1001]], equally(1001, [you, sam]), 'JPY');
    expect(expensePosition(dinner, you.id)).toEqual({
      kind: 'lent',
      amountMinor: 500,
      amount: 500,
    });
  });
});
