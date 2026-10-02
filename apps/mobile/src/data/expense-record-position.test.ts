import { describe, expect, it } from 'vitest';
import { calculateSplitAmountsMinor } from '@splitbook/shared/exact-money';
import { expenseRecordPosition } from './expense-record-position';

// Fictional people only.
const you = 'a00000000000000000000001';
const sam = 'a00000000000000000000002';
const priya = 'a00000000000000000000003';

const rows = (allocations: [string, number][]) =>
  allocations.map(([user, amountMinor]) => ({ user, amountMinor }));
/** An equal split from the shared calculator, so its rounding is the ledger's own. */
const equally = (amountMinor: number, people: string[]) =>
  calculateSplitAmountsMinor(
    'equal',
    amountMinor,
    people.map((user) => ({ user })),
  ).map(({ user, amountMinor: share }) => [user, share] as [string, number]);

describe('a member’s position on a saved Expense', () => {
  it('owes the one payer their share, keeping the leftover unit where the split put it', () => {
    const bill = {
      paidBy: rows([[sam, 286000]]),
      splitBetween: rows(equally(286000, [you, sam, priya])),
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
      paidBy: rows([[you, 240000]]),
      splitBetween: rows(equally(240000, [you, sam, priya])),
    };
    expect(expenseRecordPosition(dinner, you)).toEqual({
      kind: 'lent',
      amountMinor: 160000,
      counterpartyId: null,
    });
    const taxi = { paidBy: rows([[you, 1000]]), splitBetween: rows([[sam, 1000]]) };
    expect(expenseRecordPosition(taxi, you)).toEqual({
      kind: 'lent',
      amountMinor: 1000,
      counterpartyId: sam,
    });
  });

  it('names nobody when the member owes several payers', () => {
    const villa = {
      paidBy: rows([
        [sam, 150000],
        [priya, 150000],
      ]),
      splitBetween: rows(equally(300000, [you, sam, priya])),
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
      paidBy: rows([
        [you, 1000],
        [sam, 2000],
      ]),
      splitBetween: rows([
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
      paidBy: rows([[sam, 1000]]),
      splitBetween: rows([
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
