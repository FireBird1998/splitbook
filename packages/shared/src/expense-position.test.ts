import { describe, expect, it } from 'vitest';
import { calculateSplitAmountsMinor } from './exact-money';
import { expensePosition, type ExpensePositionInput } from './expense-position';

// Fictional member ids only.
const you = 'a00000000000000000000001';
const sam = 'a00000000000000000000002';
const priya = 'a00000000000000000000003';

const rows = (allocations: [string, number][]) =>
  allocations.map(([userId, amountMinor]) => ({ userId, amountMinor }));
/** An equal split from the shared calculator, so its rounding is the ledger's own. */
const equally = (amountMinor: number, people: string[]) =>
  calculateSplitAmountsMinor(
    'equal',
    amountMinor,
    people.map((user) => ({ user })),
  ).map(({ amountMinor: share }, index) => [people[index], share] as [string, number]);
const expense = (
  paidBy: [string, number][],
  splitBetween: [string, number][],
  currency = 'INR',
): ExpensePositionInput => ({
  currency,
  paidBy: rows(paidBy),
  splitBetween: rows(splitBetween),
});

describe('what a member lent or owes on one Expense', () => {
  it('a single payer lent everyone else’s share', () => {
    const groceries = expense([[you, 124950]], equally(124950, [you, sam, priya]));
    expect(expensePosition(groceries, you)).toEqual({
      kind: 'lent',
      amountMinor: 83300,
      amount: 833,
    });
    expect(expensePosition(groceries, sam)).toEqual({
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
    expect(expensePosition(villa, you)).toMatchObject({ kind: 'lent', amount: 1000 });
    // Paid exactly their share: nothing either way.
    expect(expensePosition(villa, sam)).toBeNull();
    expect(expensePosition(villa, priya)).toMatchObject({ kind: 'owe', amount: 1000 });
  });

  it('is nothing for a member who neither paid nor shares it', () => {
    const lunch = expense([[sam, 50000]], equally(50000, [sam, priya]));
    expect(expensePosition(lunch, you)).toBeNull();
  });

  it('counts a row whose member can’t be identified for no one', () => {
    const tickets: ExpensePositionInput = {
      currency: 'INR',
      paidBy: [{ userId: null, amountMinor: 60000 }],
      splitBetween: [
        { userId: you, amountMinor: 30000 },
        { userId: null, amountMinor: 30000 },
      ],
    };
    expect(expensePosition(tickets, you)).toEqual({
      kind: 'owe',
      amountMinor: 30000,
      amount: 300,
    });
  });

  it('follows the split’s rounding exactly, whoever takes the leftover', () => {
    // ₹2,860.00 three ways: one share carries the leftover paisa.
    const shares = equally(286000, [you, sam, priya]);
    expect(shares.map(([, share]) => share)).toEqual([95334, 95333, 95333]);
    const bill = expense([[sam, 286000]], shares);
    expect(expensePosition(bill, you)).toEqual({
      kind: 'owe',
      amountMinor: 95334,
      amount: 953.34,
    });
    expect(expensePosition(bill, priya)).toEqual({
      kind: 'owe',
      amountMinor: 95333,
      amount: 953.33,
    });
    expect(expensePosition(bill, sam)).toEqual({
      kind: 'lent',
      amountMinor: 190667,
      amount: 1906.67,
    });
  });

  it('adds every row a member has on either side', () => {
    const taxi = expense(
      [
        [you, 300],
        [you, 450],
      ],
      [
        [you, 250],
        [sam, 250],
        [you, 250],
      ],
    );
    expect(expensePosition(taxi, you)).toEqual({ kind: 'lent', amountMinor: 250, amount: 2.5 });
  });

  it('uses the Expense’s own currency precision', () => {
    const dinner = expense([[you, 1001]], equally(1001, [you, sam]), 'JPY');
    expect(expensePosition(dinner, you)).toEqual({
      kind: 'lent',
      amountMinor: 500,
      amount: 500,
    });
  });
});
