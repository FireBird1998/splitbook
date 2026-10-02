import { describe, expect, it } from 'vitest';
import { draftFromExpense, expenseMoney, type ExpenseDraft } from './expense-draft';
import { expenseRecordSchema } from './expense-record';
import {
  previewSplit,
  roundingNote,
  splitChoiceOf,
  splitLeftover,
  splitMethodFor,
} from './expense-split';

const [you, sam, priya] = [
  'a00000000000000000000001',
  'a00000000000000000000002',
  'a00000000000000000000003',
];
const names: Record<string, string> = { [you]: 'you', [sam]: 'Sam Chen', [priya]: 'Priya Shah' };
const money = (minor: number) => `₹${(minor / 100).toFixed(2)}`;
const draft = (patch: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  amount: '1249.50',
  currency: 'INR',
  description: 'Weekly groceries',
  date: '2026-09-30',
  payerId: you,
  multiPayer: false,
  payers: [],
  splitMethod: 'equal',
  splitValues: {},
  participantIds: [you, sam, priya],
  category: 'food',
  tagId: '',
  notes: '',
  ...patch,
});
const iso = '2026-09-28T10:00:00.000Z';
const exactExpense = expenseRecordSchema.parse({
  _id: 'a00000000000000000000030',
  group: 'a00000000000000000000010',
  revision: 2,
  description: 'Rent',
  amount: 10,
  currency: 'INR',
  amountMinor: 1000,
  moneyVersion: 1,
  splitMethod: 'exact',
  paidBy: [{ user: { _id: you, name: 'Alex' }, amount: 10, amountMinor: 1000 }],
  splitBetween: [
    { user: { _id: you, name: 'Alex' }, amount: 6, amountMinor: 600 },
    { user: { _id: sam, name: 'Sam Chen' }, amount: 4, amountMinor: 400 },
  ],
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  category: 'other',
  isDeleted: false,
});
const note = (value: ExpenseDraft) => {
  const leftover = splitLeftover(value.splitMethod, expenseMoney(value));
  return leftover && roundingNote(leftover, (id) => names[id], money);
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
    expect(splitMethodFor('amounts', draft())).toBe('unequal');
    expect(splitMethodFor('amounts', draft({ splitMethod: 'shares' }))).toBe('unequal');
    expect(splitMethodFor('percentage', draft())).toBe('percentage');
  });

  it('keeps an exact Expense exact unless another method is chosen', () => {
    const edit = draftFromExpense(exactExpense);
    expect(edit.splitMethod).toBe('exact');
    expect(splitMethodFor('amounts', edit)).toBe('exact');
    expect(splitMethodFor('equal', edit)).toBe('equal');
    expect(splitMethodFor('amounts', { ...edit, splitMethod: 'equal' })).toBe('exact');
  });

  it('changes nothing when the current method is chosen again', () => {
    expect(splitMethodFor('amounts', draft({ splitMethod: 'exact' }))).toBe('exact');
    expect(splitMethodFor('amounts', draft({ splitMethod: 'unequal' }))).toBe('unequal');
    expect(splitMethodFor('equal', draft())).toBe('equal');
  });
});

describe('rounding note', () => {
  it('names who got the leftover from Shares', () => {
    const shares = draft({
      splitMethod: 'shares',
      splitValues: { [you]: '2', [sam]: '1', [priya]: '1' },
    });
    expect(expenseMoney(shares).splitBetween.map((row) => row.amountMinor)).toEqual([
      62475, 31238, 31237,
    ]);
    expect(splitLeftover('shares', expenseMoney(shares))).toEqual({ amountMinor: 1, users: [sam] });
    expect(note(shares)).toBe('The leftover ₹0.01 goes to Sam Chen so the total is exact.');
  });

  it('names everyone who got part of the leftover, including you', () => {
    expect(note(draft({ amount: '100' }))).toBe(
      'The leftover ₹0.01 goes to you so the total is exact.',
    );
    expect(note(draft({ amount: '0.02' }))).toBe(
      'The leftover ₹0.02 goes to you and Sam Chen so the total is exact.',
    );
  });

  it('follows the largest remainder for Percentage', () => {
    const percentage = draft({
      amount: '10',
      splitMethod: 'percentage',
      splitValues: { [you]: '33.33', [sam]: '33.33', [priya]: '33.34' },
    });
    expect(note(percentage)).toBe('The leftover ₹0.01 goes to Priya Shah so the total is exact.');
  });

  it('says nothing when the total divides exactly or is entered by Amounts', () => {
    expect(note(draft({ amount: '1249.50', participantIds: [you, sam] }))).toBeNull();
    expect(
      note(
        draft({
          amount: '1000',
          splitMethod: 'shares',
          splitValues: { [you]: '2', [sam]: '1', [priya]: '1' },
        }),
      ),
    ).toBeNull();
    expect(
      note(
        draft({
          amount: '10',
          splitMethod: 'unequal',
          splitValues: { [you]: '3.33', [sam]: '3.33', [priya]: '3.34' },
        }),
      ),
    ).toBeNull();
  });
});

describe('split preview', () => {
  it('shows each share and the leftover once the split adds up', () => {
    expect(
      previewSplit(
        draft({ splitMethod: 'shares', splitValues: { [you]: '2', [sam]: '1', [priya]: '1' } }),
      ),
    ).toEqual({
      total: 124950,
      shares: { [you]: 62475, [sam]: 31238, [priya]: 31237 },
      errors: {},
      status: { kind: 'adds-up', leftover: { amountMinor: 1, users: [sam] } },
    });
  });

  it('reports how much of the total is still to assign by Amounts', () => {
    const preview = previewSplit(
      draft({ splitMethod: 'unequal', splitValues: { [you]: '1000', [sam]: '200' } }),
    );
    expect(preview.shares).toEqual({ [you]: 100000, [sam]: 20000, [priya]: 0 });
    expect(preview.status).toEqual({
      kind: 'remaining',
      unit: 'amount',
      entered: 120000,
      target: 124950,
    });
    expect(
      previewSplit(draft({ splitMethod: 'unequal', splitValues: { [you]: '1300' } })).status,
    ).toMatchObject({ kind: 'remaining', entered: 130000, target: 124950 });
  });

  it('reports the percentage still to assign without rounding entries', () => {
    const preview = previewSplit(
      draft({ splitMethod: 'percentage', splitValues: { [you]: '50', [sam]: '33.33' } }),
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
    const preview = previewSplit(
      draft({ splitMethod: 'unequal', splitValues: { [you]: '1000.005', [sam]: '-5' } }),
    );
    expect(preview.errors).toEqual({
      [you]: 'INR amounts can have at most 2 decimal places. Nothing is rounded for you.',
      [sam]: 'Amounts can’t be negative.',
    });
    expect(preview.status).toEqual({
      kind: 'problem',
      message: 'Correct the entries marked above.',
    });
    expect(
      previewSplit(draft({ splitMethod: 'percentage', splitValues: { [you]: '120' } })).errors,
    ).toEqual({ [you]: 'A percentage can be at most 100.' });
  });

  it('explains missing participants and an empty set of shares', () => {
    expect(previewSplit(draft({ participantIds: [] })).status).toEqual({
      kind: 'problem',
      message: 'Choose at least one person to share this Expense.',
    });
    expect(
      previewSplit(draft({ splitMethod: 'shares', splitValues: { [you]: '0' } })).status,
    ).toEqual({ kind: 'problem', message: 'Give at least one person a share.' });
  });

  it('waits for a valid amount, still showing entered Amounts', () => {
    expect(
      previewSplit(
        draft({ amount: '12.345', splitMethod: 'unequal', splitValues: { [you]: '5' } }),
      ),
    ).toMatchObject({ total: null, shares: { [you]: 500 }, status: { kind: 'no-amount' } });
  });

  it('keeps a payer problem out of the split', () => {
    const payers = draft({ multiPayer: true, payers: [{ user: you, amount: '1000' }] });
    expect(() => expenseMoney(payers)).toThrow('Payer amounts must add up to the expense amount');
    expect(previewSplit(payers)).toMatchObject({
      shares: { [you]: 41650, [sam]: 41650, [priya]: 41650 },
      status: { kind: 'adds-up', leftover: null },
    });
  });

  it('keeps an unchanged edit’s historical allocation', () => {
    const preview = previewSplit(draftFromExpense(exactExpense));
    expect(preview.shares).toEqual({ [you]: 600, [sam]: 400 });
    expect(preview.status).toEqual({ kind: 'adds-up', leftover: null });
  });
});
