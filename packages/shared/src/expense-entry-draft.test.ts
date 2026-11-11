import { recording } from './test-support/expense-entry-recording';
import { expect, it } from 'vitest';
import { draftForExpenseEntry, entryForExpenseDraft } from './expense-entry-draft';
import { entries, alex, sam } from './test-support/expense-entry-cases';

it('omits unpaid people and a blank share when an entry is set aside', () => {
  const entry = {
    ...entries.find((row) => row.id === 'payers-zero')!,
    splitMethod: 'shares' as const,
    splitValues: { [alex]: '2', [sam]: '' },
  };
  expect(draftForExpenseEntry(entry)).toMatchObject({
    amount: 100,
    paidBy: [{ user: alex, amount: 100 }],
    splitBetween: [{ user: alex, shares: 2 }, { user: sam }],
  });
  expect(draftForExpenseEntry(entry).splitBetween![1]).not.toHaveProperty('shares');
});

it('leaves a Draft’s missing choices and figures not given in the entry', () => {
  expect(
    entryForExpenseDraft({
      description: 'Lunch',
      paidBy: [{ user: alex }],
      splitBetween: [{ user: sam }],
    }),
  ).toMatchObject({
    amount: '',
    currency: '',
    category: '',
    splitMethod: '',
    payers: [{ user: alex, amount: '' }],
    splitValues: { [sam]: '' },
  });
});

it('changes a note without inventing omitted facts or losing a retained Tag name and item', () => {
  const from = {
    description: 'Lunch',
    tag: 'Food',
    predefinedItem: 'Coffee',
    paidBy: [{ user: alex }],
    splitBetween: [{ user: sam }],
  };
  const entry = { ...entryForExpenseDraft(from), notes: 'Receipt checked' };
  expect(draftForExpenseEntry(entry, { from, changed: { notes: true } })).toEqual({
    ...from,
    notes: 'Receipt checked',
  });
});

it('keeps unedited split facts for both field and sheet edits', () => {
  const from = {
    amount: 100,
    currency: 'INR',
    splitMethod: 'shares' as const,
    splitBetween: [
      { user: alex, amount: 50, percentage: 50, shares: 1 },
      { user: sam, amount: 50, percentage: 50, shares: 1 },
    ],
  };
  const entry = { ...entryForExpenseDraft(from), splitValues: { [alex]: '2', [sam]: '1' } };
  expect(
    draftForExpenseEntry(entry, { from, changed: { splitValues: true } }).splitBetween,
  ).toEqual([
    { user: alex, amount: 50, percentage: 50, shares: 2 },
    { user: sam, amount: 50, percentage: 50, shares: 1 },
  ]);
  expect(
    draftForExpenseEntry(entry, { from, changed: { splitValues: true } }).splitBetween,
  ).toEqual([
    { user: alex, amount: 50, percentage: 50, shares: 2 },
    { user: sam, amount: 50, percentage: 50, shares: 1 },
  ]);
});
it('uses one later-value box for a repeated person on both clients', () => {
  const from = {
    paidBy: [
      { user: alex, amount: 40 },
      { user: alex, amount: 60 },
    ],
  };
  expect(entryForExpenseDraft(from).payers).toEqual([{ user: alex, amount: '60' }]);
  expect(entryForExpenseDraft(from).payers).toEqual([{ user: alex, amount: '60' }]);
});

it('keeps an unreadable saved amount visible for correction instead of throwing while opening', () => {
  expect(entryForExpenseDraft({ amount: 0 }).amount).toBe('0');
});

it('leaves an omitted split method to the caller’s explicit choice', () => {
  const from = { description: 'Lunch' };
  const entry = { ...entryForExpenseDraft(from), participantIds: [alex] };
  expect(draftForExpenseEntry(entry, { from, changed: { participantIds: true } })).toEqual({
    description: 'Lunch',
    splitBetween: [{ user: alex }],
  });
});

it('keeps existing row positions when a field unticks and reticks a participant', () => {
  const from = { splitMethod: 'equal' as const, splitBetween: [{ user: alex }, { user: sam }] };
  const entry = { ...entryForExpenseDraft(from), participantIds: [sam, alex] };
  expect(
    draftForExpenseEntry(entry, { from, changed: { participantIds: true } }).splitBetween,
  ).toEqual([{ user: alex }, { user: sam }]);
});

it('requires a Tag identity in every new entry (#1117 decision 12)', () => {
  const entry = { ...entries[0], tagId: 'Food' };
  expect(() => draftForExpenseEntry(entry)).toThrow('tagId: Invalid Tag identity');
  expect(() => draftForExpenseEntry(entry)).toThrow('tagId: Invalid Tag identity');
});

it('retains assistant split facts a sheet did not edit (#1117 decision 10)', () => {
  const from = {
    splitMethod: 'shares' as const,
    splitBetween: [
      { user: alex, amount: 50, percentage: 50, shares: 1 },
      { user: sam, amount: 50, percentage: 50, shares: 1 },
    ],
  };
  const entry = { ...entryForExpenseDraft(from), splitValues: { [alex]: '2', [sam]: '1' } };
  expect(
    draftForExpenseEntry(entry, { from, changed: { splitValues: true } }).splitBetween,
  ).toEqual([
    { user: alex, amount: 50, percentage: 50, shares: 2 },
    { user: sam, amount: 50, percentage: 50, shares: 1 },
  ]);
});

it('shows a repeated person once using the later facts without rewriting the source Draft (#1117 decision 11)', () => {
  const from = {
    paidBy: [
      { user: alex, amount: 40 },
      { user: alex, amount: 60 },
    ],
    splitMethod: 'shares' as const,
    splitBetween: [
      { user: alex, shares: 1 },
      { user: alex, shares: 3 },
    ],
  };
  const before = JSON.stringify(from);
  expect(entryForExpenseDraft(from)).toMatchObject({
    payers: [{ user: alex, amount: '60' }],
    participantIds: [alex],
    splitValues: { [alex]: '3' },
  });
  expect(JSON.stringify(from)).toBe(before);
});

it('records identity-only new entries, including the former name-classification path', async () => {
  const refused = () => {
    try {
      draftForExpenseEntry({ ...entries[0], tagId: 'Food' });
      return { kind: 'draft' };
    } catch (error) {
      return { kind: 'refused', message: (error as Error).message };
    }
  };
  await expect(await recording({ tagId: refused(), tag: refused() })).toMatchFileSnapshot(
    '../../../test/expense-entry-readings/supplemental/tag-reference.json',
  );
});

it('keeps the entered several-payer mode when duplicate rows become one box (#1117 decision 11)', () => {
  expect(
    entryForExpenseDraft({
      amount: 100,
      paidBy: [
        { user: alex, amount: 40 },
        { user: alex, amount: 60 },
      ],
    }),
  ).toMatchObject({ multiPayer: true, payers: [{ user: alex, amount: '60' }] });
});

it('omits unpaid people from Finish later and from a later note edit (#1117 decision 2)', () => {
  const entry = entries.find((row) => row.id === 'payers-zero')!;
  expect(draftForExpenseEntry(entry).paidBy).toEqual([{ user: alex, amount: 100 }]);
  const from = {
    paidBy: [
      { user: alex, amount: 100 },
      { user: sam, amount: 0 },
    ],
  };
  expect(
    draftForExpenseEntry(
      { ...entryForExpenseDraft(from), notes: 'Checked' },
      { from, changed: { notes: true } },
    ).paidBy,
  ).toEqual([{ user: alex, amount: 100 }]);
});

it.each([0, undefined])(
  'does not infer a whole payment after a note edit drops an unpaid duplicate (%s, #1117 decisions 2 and 11)',
  (amount) => {
    const from = {
      ...draftForExpenseEntry(entries[0]),
      paidBy: [
        { user: alex, amount: 100 },
        { user: alex, ...(amount === undefined ? {} : { amount }) },
      ],
    };
    const entry = { ...entryForExpenseDraft(from), notes: 'Checked the receipt' };
    expect(entry.multiPayer).toBe(true);
    const kept = draftForExpenseEntry(entry, { from, changed: { notes: true } });
    expect(kept).not.toHaveProperty('paidBy');
    expect(from.paidBy).toHaveLength(2);
  },
);
