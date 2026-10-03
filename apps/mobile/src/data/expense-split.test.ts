import { describe, expect, it } from 'vitest';
import type { ExpenseDraft } from './expense-draft';
import { previewSplit, roundingNote } from './expense-split';

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
const note = (value: ExpenseDraft) => {
  const { status } = previewSplit(value);
  return status.kind === 'adds-up' && status.leftover
    ? roundingNote(status.leftover, (id) => names[id], money)
    : null;
};
const entryError = (splitMethod: ExpenseDraft['splitMethod'], value: string, currency = 'INR') =>
  previewSplit(draft({ amount: '1000', currency, splitMethod, splitValues: { [you]: value } }))
    .errors[you];
const problem = (value: ExpenseDraft) => {
  const { status } = previewSplit(value);
  return status.kind === 'problem' ? status.message : status.kind;
};

// The split arithmetic is tested with the shared rules; this is only how its results read.
describe('rounding note', () => {
  it('names who got the leftover from Shares', () => {
    const shares = draft({
      splitMethod: 'shares',
      splitValues: { [you]: '2', [sam]: '1', [priya]: '1' },
    });
    expect(note(shares)).toBe('The leftover ₹0.01 goes to Sam Chen so the total is exact.');
  });

  it('names everyone who got part of the leftover, including you', () => {
    expect(note(draft({ amount: '100' }))).toBe(
      'The leftover ₹0.01 goes to you so the total is exact.',
    );
    expect(note(draft({ amount: '0.02' }))).toBe(
      'The leftover ₹0.02 goes to you and Sam Chen so the total is exact.',
    );
    expect(
      roundingNote({ amountMinor: 3, users: [you, sam, priya] }, (id) => names[id], money),
    ).toBe('The leftover ₹0.03 goes to you, Sam Chen and Priya Shah so the total is exact.');
  });
});

describe('split preview', () => {
  it('says why each entry can’t be used, without rounding', () => {
    expect(entryError('unequal', '1000.005')).toBe(
      'INR amounts can have at most 2 decimal places. Nothing is rounded for you.',
    );
    expect(entryError('exact', '1.5', 'JPY')).toBe(
      'JPY amounts can’t include decimal places. Nothing is rounded for you.',
    );
    expect(entryError('unequal', '99999999999999999999')).toBe(
      'That’s more than the Expense total.',
    );
    expect(entryError('unequal', '1.2.3')).toBe(
      'Use digits and one decimal point, such as 250.50.',
    );
    expect(entryError('unequal', '1.2.3', 'JPY')).toBe('Use digits only, such as 250.');
    expect(entryError('unequal', '-5')).toBe('Amounts can’t be negative.');
    expect(entryError('percentage', '33.333')).toBe(
      'Percentages can have at most 2 decimal places. Nothing is rounded for you.',
    );
    expect(entryError('percentage', '120')).toBe('A percentage can be at most 100.');
    expect(entryError('percentage', '99999999999999999999')).toBe(
      'A percentage can be at most 100.',
    );
    expect(entryError('percentage', '1,5')).toBe('Use digits and one decimal point, such as 33.5.');
    expect(entryError('percentage', '-5')).toBe('Percentages can’t be negative.');
    expect(entryError('shares', '1.5')).toBe('Use a whole number of shares.');
    expect(entryError('shares', '-1')).toBe('Shares can’t be negative.');
  });

  it('says what keeps the split from adding up', () => {
    expect(problem(draft({ splitMethod: 'unequal', splitValues: { [you]: '-5' } }))).toBe(
      'Correct the entry marked above.',
    );
    expect(
      problem(draft({ splitMethod: 'unequal', splitValues: { [you]: '1000.005', [sam]: '-5' } })),
    ).toBe('Correct the entries marked above.');
    expect(problem(draft({ participantIds: [] }))).toBe(
      'Choose at least one person to share this Expense.',
    );
    expect(problem(draft({ splitMethod: 'shares', splitValues: { [you]: '0' } }))).toBe(
      'Give at least one person a share.',
    );
    // The money rules' own message, when they refuse the split for another reason.
    expect(problem(draft({ participantIds: [you, you] }))).toBe('Each person can appear only once');
  });
});
