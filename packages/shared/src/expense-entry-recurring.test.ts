import { expect, it } from 'vitest';
import { readExpenseEntry } from './expense-entry';
import { entries, alex, sam, savedFor } from './test-support/expense-entry-cases';

it('reads a blank recurring split amount as zero', () => {
  const entry = entries.find((entry) => entry.id === 'amounts-partly-blank')!;
  expect(readExpenseEntry(entry, { kind: 'new' }).result).toMatchObject({
    kind: 'ready',
    money: { splitBetween: [{ amountMinor: 10000 }, { amountMinor: 0 }] },
  });
});

it.each(['unreadable-share', 'unreadable-percentage'])(
  'refuses the unreadable recurring box in %s',
  (id) => {
    const entry = entries.find((entry) => entry.id === id)!;
    expect(readExpenseEntry(entry, { kind: 'new' }).result).toMatchObject({
      kind: 'refused',
    });
  },
);

it('returns the template figures separately from its allocated preview without changing the method', () => {
  const entry = entries.find((entry) => entry.id === 'shares')!;
  const reading = readExpenseEntry(entry, { kind: 'new' });
  expect(reading.result).toMatchObject({
    kind: 'ready',
    figures: {
      amount: 100,
      currency: 'INR',
      paidBy: [{ user: alex, amount: 100 }],
      splitMethod: 'shares',
      splitBetween: [
        { user: alex, shares: 2 },
        { user: sam, shares: 1 },
      ],
    },
    money: { splitBetween: [{ amountMinor: 6667 }, { amountMinor: 3333 }] },
  });
});

it('reports an unreadable total before an over-precise split amount in a template', () => {
  const entry = {
    ...entries[0],
    amount: 'word',
    splitMethod: 'exact' as const,
    splitValues: { [alex]: '0.005', [sam]: '0' },
  };
  expect(readExpenseEntry(entry, { kind: 'new' }).result).toMatchObject({
    kind: 'refused',
    problems: [{ field: 'amount', message: 'Use digits and one decimal point, such as 250.50.' }],
  });
});

it('keeps the recurring whole-currency precision refusal verbatim', () => {
  expect(
    readExpenseEntry({ ...entries[0], currency: 'JPY', amount: '1.5' }, { kind: 'new' }).result,
  ).toMatchObject({
    kind: 'refused',
    problems: [
      { field: 'amount', message: 'Yen has no smaller unit. Enter a whole amount, like ¥2,500.' },
    ],
  });
});
it('keeps submitted participant order separately from an unchanged historical preview', () => {
  const original = entries[0];
  const entry = { ...original, participantIds: [sam, alex] };
  expect(readExpenseEntry(entry, { kind: 'edit', saved: savedFor(original) }).result).toMatchObject(
    {
      kind: 'ready',
      figures: { splitBetween: [{ user: sam }, { user: alex }] },
      money: { splitBetween: [{ user: alex }, { user: sam }] },
    },
  );
});

it('counts a blank recurring split amount as zero (#1117 decision 3)', () => {
  const entry = entries.find((row) => row.id === 'amounts-partly-blank')!;
  expect(readExpenseEntry(entry, { kind: 'new' }).result).toMatchObject({
    kind: 'ready',
    figures: {
      splitBetween: [
        { user: alex, amount: 100 },
        { user: sam, amount: 0 },
      ],
    },
  });
});

it.each(['unreadable-share', 'unreadable-percentage', 'shares-fractional'])(
  'refuses %s instead of completing a recurring entry (#1117 decisions 4–5)',
  (id) => {
    const read = readExpenseEntry(entries.find((row) => row.id === id)!, { kind: 'new' });
    expect(read.result.kind).toBe('refused');
    expect(Object.keys(read.split.errors)).toHaveLength(1);
  },
);
