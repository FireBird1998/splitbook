import { describe, expect, it } from 'vitest';
import { calculateSplitAmountsMinor } from './exact-money';
import {
  expensePosition,
  expenseRecordPosition,
  type ExpensePositionInput,
} from './expense-position';

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

/** Payer or share rows as the API stores them, by user. */
const byUser = (allocations: [unknown, number][]) =>
  allocations.map(([user, amountMinor]) => ({ user, amountMinor }));

describe('a member’s position on a saved Expense', () => {
  it('owes the one payer their share, keeping the leftover unit where the split put it', () => {
    const bill = {
      paidBy: byUser([[sam, 286000]]),
      splitBetween: byUser(equally(286000, [you, sam, priya])),
    };
    // The leftover ₹0.01 went to one person; the others owe ₹953.33 each.
    expect(bill.splitBetween.map((row) => row.amountMinor).sort()).toEqual([95333, 95333, 95334]);
    expect(expenseRecordPosition(bill, you)).toEqual({
      kind: 'owe',
      amountMinor: bill.splitBetween.find((row) => row.user === you)!.amountMinor,
      counterpartyId: sam,
    });
  });

  it('lent everyone else’s share, naming the person only when one owes', () => {
    const dinner = {
      paidBy: byUser([[you, 240000]]),
      splitBetween: byUser(equally(240000, [you, sam, priya])),
    };
    expect(expenseRecordPosition(dinner, you)).toEqual({
      kind: 'lent',
      amountMinor: 160000,
      counterpartyId: null,
    });
    const taxi = { paidBy: byUser([[you, 1000]]), splitBetween: byUser([[sam, 1000]]) };
    expect(expenseRecordPosition(taxi, you)).toEqual({
      kind: 'lent',
      amountMinor: 1000,
      counterpartyId: sam,
    });
  });

  it('names nobody when the member owes several payers', () => {
    const villa = {
      paidBy: byUser([
        [sam, 150000],
        [priya, 150000],
      ]),
      splitBetween: byUser(equally(300000, [you, sam, priya])),
    };
    expect(expenseRecordPosition(villa, you)).toEqual({
      kind: 'owe',
      amountMinor: 100000,
      counterpartyId: null,
    });
    // Sam lent ₹500.00, and only the member owes.
    expect(expenseRecordPosition(villa, sam)).toMatchObject({ kind: 'lent', counterpartyId: you });
  });

  it('is even for a member who paid exactly their share, and none for one left out', () => {
    const groceries = {
      paidBy: byUser([
        [you, 1000],
        [sam, 2000],
      ]),
      splitBetween: byUser([
        [you, 1000],
        [sam, 1000],
        [priya, 1000],
      ]),
    };
    expect(expenseRecordPosition(groceries, you)).toEqual({
      kind: 'even',
      amountMinor: 0,
      counterpartyId: null,
    });
    const shares = {
      paidBy: byUser([[sam, 1000]]),
      splitBetween: byUser([
        [sam, 1000],
        [you, 0],
      ]),
    };
    expect(expenseRecordPosition(shares, you)).toMatchObject({ kind: 'none' });
    expect(expenseRecordPosition(groceries, 'a00000000000000000000009')).toMatchObject({
      kind: 'none',
    });
  });

  it('reads people the API populated', () => {
    const populated = {
      paidBy: [{ user: { _id: sam, name: 'Sam' }, amountMinor: 1000 }],
      splitBetween: [
        { user: { _id: you, name: 'You' }, amountMinor: 334 },
        { user: { _id: sam, name: 'Sam' }, amountMinor: 333 },
        { user: { _id: priya, name: 'Priya' }, amountMinor: 333 },
      ],
    };
    expect(expenseRecordPosition(populated, you)).toEqual({
      kind: 'owe',
      amountMinor: 334,
      counterpartyId: sam,
    });
  });
});
